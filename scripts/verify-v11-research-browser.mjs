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
  let sequence = 0;
  socket.addEventListener("message", event => {
    const reply = JSON.parse(event.data);
    if (reply.method === "Runtime.exceptionThrown") {
      exceptions.push(reply.params.exceptionDetails.exception?.description ?? reply.params.exceptionDetails.text);
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
  await activate("生成当前图件");
  await until("document.querySelector('[aria-labelledby=research-title] canvas')", "ECharts canvas");
  await until("document.querySelector('[aria-labelledby=research-title] aside').innerText.includes('预测值')", "written insights");
  await screenshot("workspace-desktop.png");
  await activate("保存图件");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('修订 1')", "first saved figure");
  await activate("填入示例");
  await activate("提交修改");
  await until("document.querySelector('[aria-labelledby=research-title] [role=status]')?.textContent.includes('修改已应用')", "natural-language style edit");
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

  await cdp("Page.reload");
  await until("document.readyState==='complete' && document.getElementById('research-title')", "reloaded workspace");
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
  assert.equal(exceptions.length, 0, exceptions[0]);
  console.log("PASS Chrome desktop and mobile, authorized render, written insight, edit, save/reload/version switch and PNG/SVG download");
} finally {
  socket?.close();
  if (chrome.exitCode === null && !startupError) {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill();
    await Promise.race([exited, delay(2500)]);
  }
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
