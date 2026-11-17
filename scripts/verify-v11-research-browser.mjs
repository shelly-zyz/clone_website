import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const base = new URL(process.env.DATA_AGENT_VERIFY_URL ?? "http://127.0.0.1:3000");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname), "Browser verification uses a local test preview");
const profile = await mkdtemp(join(tmpdir(), "ogw-browser-"));
const evidence = process.env.OGW_VIZ_VERIFY_ARTIFACTS ?? join(tmpdir(), "ogw-viz-browser");
await mkdir(evidence, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
["--headless=new", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
let socket;
let startupError;
chrome.once("error", error => { startupError = error; });
try {
  let port;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (startupError) throw startupError;
    port = (await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "")).split("\n")[0];
    if (port) break;
    await delay(100);
  }
  assert.ok(port, "Chrome debugging did not start");
  const tabs = await fetch("http://127.0.0.1:" + port + "/json/list").then(reply => reply.json());
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const pending = new Map();
  const exceptions = [];
  const frameContexts = new Map();
  let sequence = 0;
  socket.addEventListener("message", event => {
    const reply = JSON.parse(event.data);
    if (reply.method === "Runtime.exceptionThrown") {
      exceptions.push(reply.params.exceptionDetails.exception?.description ?? reply.params.exceptionDetails.text);
    }
    if (reply.method === "Runtime.executionContextCreated" && reply.params.context.auxData?.isDefault) {
      const { id, auxData } = reply.params.context;
      frameContexts.set(auxData.frameId, id);
    }
    const call = pending.get(reply.id);
    if (!call) return;
    pending.delete(reply.id);
    if (reply.error) call.reject(new Error(reply.error.message));
    else call.resolve(reply.result);
  });

  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function js(expression) {
    const reply = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  }

  async function until(expression, description, duration = 26_000) {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      if (await js("Boolean(" + expression + ")").catch(() => false)) return;
      await delay(140);
    }
    assert.fail(description + " · " + await js("document.querySelector('[aria-labelledby=research-title] [role=alert]')?.innerText ?? document.title").catch(() => ""));
  }

  function activate(text) {
    return js(`[...document.querySelectorAll('[aria-labelledby=research-title] button')].find(button=>button.textContent.trim()===${JSON.stringify(text)})?.click()`);
  }

  async function screenshot(name) {
    const clip = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(join(evidence, name), Buffer.from(clip.data, "base64"));
  }

  const dimensions = (width, height) => cdp("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: width < 700,
  });

  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: evidence });
  await dimensions(1500, 1030);
  const location = "/visualization/economy/custom";
  const navigate = () => cdp("Page.navigate", { url: new URL(location, base).href });
  await navigate();
  await until("document.readyState==='complete' && document.getElementById('research-title')", "research entry");
  const stage = step => until("document.querySelector('[aria-label=分步制图]')?.dataset.step === '" + step + "'", "wizard step " + step);
  async function field(label, value) {
    const expression = `[...document.querySelectorAll('[aria-label=分步制图] select,[aria-label=分步制图] input')].find(el=>el.labels[0]?.textContent.startsWith(${JSON.stringify(label)}))`;
    await until(expression + " && !" + expression + ".disabled", "field " + label);
    await js(`(() => {
      const el = ${expression};
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles:true }));
    })()`);
  }
  async function metric(id) {
    await until("Boolean(document.querySelector('[aria-label=分步制图] option[value=" + JSON.stringify(id) + "]'))", "metric " + id);
    await field("数据指标", id);
  }
  async function selection(structure) {
    await activate("下一步");
    await stage(2);
    await js(`document.querySelector('button[data-structure="${structure}"]').click()`);
  }
  async function choose(kind) {
    await activate("查看参考图");
    await stage(3);
    const selector = JSON.stringify('[aria-label="推荐图样"] button[data-chart="' + kind + '"]');
    await until("document.querySelector(" + selector + ")?.disabled === false", "chart choice " + kind);
    assert.ok(await js("Boolean(document.querySelector(" + selector + ").querySelector('svg'))"));
    await js("document.querySelector(" + selector + ").click()");
    await until("document.querySelector(" + selector + ").getAttribute('aria-pressed') === 'true'", "selected chart " + kind);
  }
  await stage(1);
  assert.equal(await js("Boolean(document.querySelector('[aria-label=推荐图样]'))"), false);
  await metric("economy:real-growth");
  await metric("economy:growth-outlook");
  await selection("forecast");
  await choose("forecast");
  await activate("生成图件");
  await until("document.querySelector('[aria-labelledby=research-title] canvas')", "ECharts canvas");
  await until("document.querySelector('[aria-labelledby=research-title] aside').innerText.includes('预测值')", "written insights");
  await screenshot("workspace-desktop.png");
  await activate("保存图件");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('修订 1')", "first saved figure");
  await activate("填入示例");
  await activate("提交修改");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('修改已应用')", "natural-language style edit");
  assert.ok(await js("[...document.querySelectorAll('header p')].some(el=>el.textContent.includes('实值与预测 · echarts'))"));
  await activate("保存图件");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('修订 2')", "second saved figure");

  await activate("PNG");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('下载已就绪')", "PNG export");
  await activate("SVG");
  const downloadReady = Date.now() + 6_000;
  let downloads = [];
  while (Date.now() < downloadReady) {
    downloads = (await readdir(evidence)).filter(name => /^opengridworks-.*\.(png|svg)$/.test(name));
    if (downloads.some(file => file.endsWith(".png")) && downloads.some(file => file.endsWith(".svg"))) break;
    await delay(100);
  }
  assert.ok(downloads.some(file => file.endsWith(".png")));
  assert.ok(downloads.some(file => file.endsWith(".svg")));

  const previousPage = await js("performance.timeOrigin");
  await cdp("Page.reload");
  await until("performance.timeOrigin !== " + previousPage +
    " && document.readyState==='complete' && document.getElementById('research-title')", "reloaded workspace");
  await until("Boolean(document.querySelector('[aria-label=分步制图] option[value=\"economy:real-growth\"]'))", "reloaded workspace hydrated");
  await activate("图件库");
  await until("document.querySelector('[aria-label=已保存的图件] button')", "saved project listing");
  await js("document.querySelector('[aria-label=已保存的图件] button').click()");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('修订 2')", "opened figure");
  await js(`(() => {
    const revision=[...document.querySelectorAll('[aria-labelledby=research-title] select')].find(el=>el.labels[0]?.textContent.startsWith("修订"));
    revision.value="1";revision.dispatchEvent(new Event("change",{bubbles:true}));
  })()`);
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('修订 1')", "opened earlier revision");
  await dimensions(390, 845);
  await until("document.querySelector('[aria-labelledby=research-title] [data-compact=true] canvas')", "mobile chart");
  assert.ok(await js("document.documentElement.scrollWidth <= innerWidth + 1"), "mobile layout must not overflow");
  await js("document.getElementById('research-title').scrollIntoView({block:'center'})");
  await screenshot("workspace-mobile.png");
  await dimensions(1500, 1030);
  async function reset(path = location) {
    const previous = await js("performance.timeOrigin");
    await cdp("Page.navigate", { url: new URL(path, base).href });
    await until("performance.timeOrigin !== " + previous + " && document.readyState==='complete' && document.getElementById('research-title')", "reset workspace");
    await stage(1);
  }
  async function generated(label) {
    await activate("生成图件");
    await until("Boolean(document.querySelector('[aria-labelledby=research-title] canvas')) && " +
      "[...document.querySelectorAll('header p')].some(el=>el.textContent.includes(" + JSON.stringify(label + " · echarts") + "))", label + " chart", 38_000);
  }
  await reset("/visualization/power/custom");
  await metric("annual-capacity");
  await selection("composition");
  await choose("ring");
  await generated("双层环图");
  await until("document.querySelector('[aria-label=数据覆盖]').innerText.includes('6 条有效')", "annual capacity composition");
  await js("document.getElementById('research-title').scrollIntoView({block:'start'})");
  await screenshot("capacity-ring.png");

  await reset("/visualization/power/custom");
  await metric("published:electricity_generation_current");
  await selection("categories");
  await field("对比月份", "2025-12");
  await until("!Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='查看参考图')?.disabled", "confirmed month");
  await choose("rank");
  await generated("排序点图");
  await until("document.querySelector('[aria-label=数据覆盖]').innerText.includes('31 条有效')", "31 province observations");
  await activate("DRAWIO");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('下载已就绪')", "editable drawio download");
  const drawing = (await readdir(evidence)).find(name => name.endsWith(".drawio"));
  const xml = await readFile(join(evidence, drawing), "utf8");
  assert.match(xml, /<mxGraphModel/);
  assert.match(xml, /内蒙古/);
  assert.match(xml, /<mxCell[^>]*vertex="1"/);
  assert.match(xml, /<object label="" tooltip=/);
  assert.doesNotMatch(xml, /<svg|data:image/);
  await screenshot("province-rank.png");

  if (process.env.OGW_VERIFY_LOCAL_DRAWIO === "true") {
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      if (location.origin !== 'http://127.0.0.1:6002' || location.pathname !== '/drawio/index.html') return;
      const poll = setInterval(() => {
        const prototype = window.EditorUi?.prototype;
        if (!prototype) return;
        clearInterval(poll);
        for (const [source, method] of [[prototype, 'updateActionStates'], [window.App?.prototype, 'fileLoaded']]) {
          const original = source?.[method];
          if (!original) continue;
          source[method] = function (...args) {
            if (this.editor?.graph) window.ogwTestGraph = this.editor.graph;
            return original.apply(this, args);
          };
        }
      }, 10);
      setTimeout(() => clearInterval(poll), 15000);
    })()` });
    await activate("在本机 Draw.io 打开");
    await until("document.querySelector('dialog[open] iframe') && !document.querySelector('dialog[open] [role=status]')", "local drawio connected");
    const tree = await cdp("Page.getFrameTree");
    const child = tree.frameTree.childFrames.find(item => item.frame.url.includes(":6002/drawio/index.html"));
    assert.ok(child, "drawio editor iframe");
    const contextId = frameContexts.get(child.frame.id);
    assert.ok(contextId, "editor page default context");
    let rendered = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await cdp("Runtime.evaluate", { contextId, returnByValue: true,
        expression: "Boolean(window.ogwTestGraph) && document.body.textContent.includes('内蒙古')" });
      if (result.result.value) { rendered = true; break; }
      await delay(150);
    }
    assert.ok(rendered, "native Draw.io graph rendered province labels");
    const editor = await cdp("Runtime.evaluate", { contextId, returnByValue: true, expression: `(() => {
      const graph = window.ogwTestGraph;
      const cell = graph.getModel().getCell('2');
      if (!graph.isCellEditable(cell)) return false;
      graph.startEditingAtCell(cell);
      const label = graph.cellEditor.textarea;
      if (!label) return false;
      label.textContent = '各省发电量 · 编辑副本';
      label.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: label.textContent }));
      return graph.isEditing() && label.textContent.includes('各省发电量 · 编辑副本');
    })()` });
    assert.equal(editor.result.value, true, "draw.io modified the editable title");
    await activate("下载编辑稿");
    let edited;
    for (let attempt = 0; attempt < 75; attempt++) {
      edited = (await readdir(evidence)).find(name => name.endsWith("-edited.drawio"));
      if (edited) break;
      await delay(150);
    }
    assert.ok(edited, "edited copy downloaded from the local editor");
    const editedXml = await readFile(join(evidence, edited), "utf8");
    assert.match(editedXml, /<mxfile/);
    assert.ok(editedXml.includes("各省发电量 · 编辑副本"), "the edited title survived .drawio export");
    await screenshot("drawio-local.png");
    await activate("关闭");
  }
  for (const [path, id, structure, chartKind, label, period] of [
    ["/visualization/weather/custom", "replay-grid:rain", "grid", "grid", "空间热图", null],
    ["/visualization/carbon/custom", "published:global_grid_emission_rate_sum", "timeline", "calendar", "日历热图", ["2025-08-01", "2025-08-31"]],
  ]) {
    await reset(path);
    await metric(id);
    if (period) { await field("起始日期", period[0]); await field("结束日期", period[1]); }
    await selection(structure);
    await choose(chartKind);
    await generated(label);
    await screenshot(chartKind + ".png");
  }
  assert.equal(exceptions.length, 0, exceptions[0]);
  console.log("PASS Chrome desktop and mobile, indicator wizard, four topics, saved versions, editable Draw.io and PNG/SVG downloads");
} finally {
  socket?.close();
  if (chrome.exitCode === null && !startupError) {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill();
    await Promise.race([exited, delay(2500)]);
  }
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
