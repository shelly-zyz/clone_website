import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test, { after } from "node:test";
import ts from "typescript";
import { Vector3 } from "three";

const root = new URL("../../../", import.meta.url);
const state = { frames: new Map(), frameId: 0 };
const originals = new Map();
function install(name, value) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

class Renderer {
  constructor() { state.renderer = this; this.viewports = []; this.shadowMap = {}; }
  setClearColor() {}
  setPixelRatio() {}
  setViewport(...rect) { this.viewports.push(rect); }
  setSize() {}
  clear() {}
  clearDepth() {}
  render(scene, camera) { if (camera.far === 100) { this.camera = camera.clone(); this.scene = scene; } }
  dispose() {}
  forceContextLoss() {}
}
class Controls {
  constructor(camera) { this.camera = camera; this.target = new Vector3(); this.listeners = new Map(); state.controls = this; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  emit(name) { this.listeners.get(name)?.(); }
  update() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(); this.emit("change"); }
  dispose() {}
}
class Canvas {
  constructor(width = 1440, height = 900, shell = null) {
    this.clientWidth = width; this.clientHeight = height; this.shell = shell;
    this.classList = { toggle() {} };
  }
  getBoundingClientRect() { return rect(0, 0, this.clientWidth, this.clientHeight); }
  closest() { return this.shell; }
  addEventListener() {}
  removeEventListener() {}
  toDataURL() { return "data:image/png;base64,"; }
}
function rect(left, top, right, bottom) { return { left, top, right, bottom, width: right - left, height: bottom - top }; }
function textCanvas() {
  return { getContext: () => ({ measureText: text => ({ width: text.length * 12 }), beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {} }) };
}
state.Renderer = Renderer;
state.Controls = Controls;
install("__powerFitTest", state);
install("window", { devicePixelRatio: 1, matchMedia: () => ({ matches: true }), getComputedStyle: element => element.style ?? { display: "block", visibility: "visible" } });
install("document", { createElement: textCanvas });
install("requestAnimationFrame", callback => { const id = ++state.frameId; state.frames.set(id, callback); return id; });
install("cancelAnimationFrame", id => state.frames.delete(id));
install("ResizeObserver", class {
  constructor(callback) { state.resize = callback; this.observed = []; state.observer = this; }
  observe(element) { this.observed.push(element); }
  disconnect() {}
});
install("fetch", async () => ({ ok: false }));

// 仅替换浏览器资源与 React 生命周期入口；几何、相机矩阵及 scene 业务逻辑使用真实源码。
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(new URL(`src/${specifier.slice(2)}.ts`, root).href, context);
    if (specifier.startsWith(".") && !extname(specifier) && context.parentURL?.startsWith(root.href)) {
      for (const extension of [".ts", ".tsx"]) {
        const url = new URL(`${specifier}${extension}`, context.parentURL);
        if (existsSync(url)) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(root.href) && url.endsWith(".json")) {
      return { format: "module", shortCircuit: true, source: `export default ${readFileSync(new URL(url), "utf8")};` };
    }
    if (url.endsWith("PowerStatisticsMap.module.css")) return { format: "module", shortCircuit: true, source: "export default {};" };
    if (url.endsWith("GlobeLoading.tsx")) return { format: "module", shortCircuit: true, source: "export function GlobeLoading() { return null; }" };
    if (url.endsWith("power-statistics-scene.ts") || url.endsWith("PowerStatisticsMap.tsx")) {
      let source = readFileSync(new URL(url), "utf8");
      if (url.endsWith("power-statistics-scene.ts")) {
        source = source.replace("new WebGLRenderer(", "new globalThis.__powerFitTest.Renderer(")
          .replace("new OrbitControls(", "new globalThis.__powerFitTest.Controls(");
      } else {
        source = source.replace('import { useEffect, useRef, useState } from "react";', "const { useEffect, useRef, useState } = globalThis.__powerFitTest.react;")
          .replace('import { createPowerStatisticsScene } from "./power-statistics-scene";', "const createPowerStatisticsScene = globalThis.__powerFitTest.createComponentScene;");
      }
      return { format: "module", shortCircuit: true, source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    }
    return next(url, context);
  },
});
after(() => {
  hooks.deregister();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

const { chinaPowerMonthlyDemoFrame, powerDemoNotice } = await import("@/lib/china-power-statistics");
const { cumulativePowerSeries, comparisonScatter, nationalPowerCode, powerBin, powerGrowth, powerProductAmount, readEmberSeries,
  readPowerMeasure } = await import("@/lib/power-analysis");
const { carbonAtlasCamera, carbonAtlasCenter, overviewZoom } = await import("@/lib/globe-viewport");
const { readWorkspaceContext, workspaceContextHref } = await import("@/lib/workspace-context");

const geo = JSON.parse(readFileSync(new URL("public/data/china-power/provinces.geojson", root), "utf8"));
const { createPowerStatisticsScene } = await import("./power-statistics-scene.ts");
const { buildPowerGeography, powerProjection } = await import("./power-statistics-geometry.ts");
const geography = buildPowerGeography(geo);
const pixelsPerUnit = 512 / (Math.PI * 2 * powerProjection.scale());
const frame = { label: "测试", period: "固定", unit: "亿千瓦时", scaleMax: 100, regions: geography.provinces.map(({ code }) => ({ code, value: 1 })) };
function setup(canvas = new Canvas()) {
  let reported;
  const scene = createPowerStatisticsScene(canvas, geo, { onCamera: view => { reported = view; }, onHover() {}, onSelect() {} });
  scene.update(frame);
  return { scene, canvas, reported: () => reported };
}
function snapshot(scene) { scene.screenshot(); return state.renderer.camera; }
function assertProvinceVisible(scene, code, safe = null) {
  const camera = snapshot(scene);
  const part = geography.provinces.find(province => province.code === code);
  const positions = part.mesh.geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const point = new Vector3().fromBufferAttribute(positions, index).project(camera);
    assert.ok(Math.abs(point.x) <= 1 + 1e-9 && Math.abs(point.y) <= 1 + 1e-9);
    if (safe) {
      const x = (point.x + 1) * (camera.right - camera.left) / 2;
      const y = (1 - point.y) * (camera.top - camera.bottom) / 2;
      assert.ok(x >= safe.left && x <= safe.right && y >= safe.top && y <= safe.bottom);
    }
  }
  return positions.count;
}

test("scene：provinceCode 优先于固定相机，resize 自动 fit，南海独立 viewport 保留", context => {
  const { scene, canvas } = setup();
  try {
    scene.focus({ center: [116, 40], zoom: 5.25, pitch: 0, bearing: 0 }, false, "650000000000");
    const before = snapshot(scene).zoom;
    let points = assertProvinceVisible(scene, "650000000000");
    for (const [width, height] of [[390, 844], [1440, 900], [1024, 768], [900, 650]]) {
      canvas.clientWidth = width; canvas.clientHeight = height; state.resize();
      points += assertProvinceVisible(scene, "650000000000");
    }
    assert.notEqual(snapshot(scene).zoom, before);
    assert.ok(state.renderer.viewports.some(viewport => viewport[2] === 106 && viewport[3] === 120));
    assert.ok(state.renderer.viewports.some(viewport => viewport[2] === 64 && viewport[3] === 75));
    context.diagnostic(`实际 scene 相机累计验证 ${points} 个挤出/轮廓顶点，全部未裁`);
  } finally { scene.dispose(); }
});

test("scene：保存相机不受全国 zoom 限制，resize 后精确保留中心与缩放", () => {
  const { scene, canvas, reported } = setup();
  try {
    for (const zoom of [-3, 12]) {
      scene.focus({ center: [85.25, 42.8], zoom, pitch: 44, bearing: -17 }, false);
      assert.ok(Math.abs(reported().zoom - zoom) < 1e-10);
      assert.ok(Math.abs(reported().pitch - 44) < 1e-10);
      assert.ok(Math.abs(reported().bearing + 17) < 1e-10);
      assert.ok(Math.abs(reported().center[0] - 85.25) < 1e-10);
      assert.ok(Math.abs(reported().center[1] - 42.8) < 1e-10);
      const before = snapshot(scene);
      canvas.clientWidth = 390; canvas.clientHeight = 844; state.resize();
      const after = snapshot(scene);
      assert.equal(after.zoom, before.zoom);
      assert.deepEqual(after.position.toArray(), before.position.toArray());
      assert.ok(Math.abs(after.zoom - pixelsPerUnit * 2 ** zoom) < 1e-10);
    }
  } finally { scene.dispose(); }
});

test("scene：手动 pan / controls zoom / 按钮 zoom 后 resize 不强制回省；只点击不退出自动 fit", () => {
  const { scene, canvas } = setup();
  try {
    scene.focus(undefined, false, "150000000000");
    state.controls.emit("start"); state.controls.emit("end");
    canvas.clientWidth = 390; canvas.clientHeight = 844; state.resize();
    assertProvinceVisible(scene, "150000000000");
    for (const action of ["pan", "controls zoom", "button zoom"]) {
      scene.focus(undefined, false, "150000000000");
      if (action === "button zoom") scene.zoom(1.25);
      else {
        state.controls.emit("start");
        if (action === "pan") { state.controls.target.x += 2; state.controls.camera.position.x += 2; }
        else { state.controls.camera.zoom *= 1.25; state.controls.camera.updateProjectionMatrix(); }
        state.controls.emit("change"); state.controls.emit("end");
      }
      const before = snapshot(scene);
      canvas.clientWidth = canvas.clientWidth === 390 ? 900 : 390;
      state.resize();
      const after = snapshot(scene);
      assert.equal(after.zoom, before.zoom);
      assert.deepEqual(after.position.toArray(), before.position.toArray());
    }
  } finally { scene.dispose(); }
});

test("scene：全屏测量左右覆盖与舞台安全区，不重复扣除已缩进 canvas", () => {
  const stage = { getBoundingClientRect: () => rect(280, 110, 1140, 760) };
  const left = { getBoundingClientRect: () => rect(16, 12, 260, 884) };
  const right = { getBoundingClientRect: () => rect(1160, 12, 1424, 780) };
  const shell = { querySelector: () => stage, querySelectorAll: () => [left, right] };
  const { scene } = setup(new Canvas(1440, 900, shell));
  try {
    scene.focus(undefined, false, "540000000000");
    assertProvinceVisible(scene, "540000000000", rect(280, 110, 1140, 760));
    assert.ok(state.observer.observed.includes(stage));
  } finally { scene.dispose(); }
  const canvas = new Canvas(860, 650, shell);
  canvas.getBoundingClientRect = stage.getBoundingClientRect;
  const nested = setup(canvas);
  try {
    nested.scene.focus(undefined, false, "540000000000");
    assertProvinceVisible(nested.scene, "540000000000", rect(16, 16, 844, 634));
  } finally { nested.scene.dispose(); }
});

test("scene：选省抬升和聚焦，切换数据时镜头稳定，清除 focus 回全国", () => {
  const { scene } = setup();
  try {
    const beijing = "110000000000";
    const xinjiang = "650000000000";
    const before = snapshot(scene).zoom;
    scene.update(frame, beijing, [xinjiang]);
    const focused = snapshot(scene).zoom;
    assert.notEqual(focused, before);
    scene.update({
      ...frame,
      encoding: "diverging",
      regions: frame.regions.map(region => ({
        ...region, value: region.code === beijing ? 100 : region.code === xinjiang ? -50 : null,
      })),
    }, beijing, [xinjiang]);
    assert.equal(snapshot(scene).zoom, focused);
    const group = state.renderer.scene.children[0];
    assert.ok(group.children.every(object => object.geometry?.type !== "CylinderGeometry"));
    const [first, second] = [beijing, xinjiang].map(code => group.children.find(node => node.userData.code === code));
    assert.notEqual(first.material[0].color.getHexString(), second.material[0].color.getHexString());
    assert.ok(first.scale.z > second.scale.z && second.scale.z > 1);
    assert.ok(first.position.z > 0 && second.position.z > 0);
    assert.ok(first.children[0].material.opacity > group.children.find(node => node !== first && node !== second).children[0].material.opacity);
    assert.equal(state.renderer.scene.children.filter(object => object.isSprite).length, 2);
    scene.focus(undefined, false);
    for (const code of [xinjiang, "540000000000", "150000000000", "460000000000", beijing]) assertProvinceVisible(scene, code);
  } finally { scene.dispose(); }
});

state.react = {
  useRef: value => state.hooks.useRef(value),
  useEffect: callback => state.hooks.useEffect(callback),
  useState: () => state.hooks.useState(),
};
state.createComponentScene = (...args) => state.componentFactory(...args);
const { PowerStatisticsMap } = await import("./PowerStatisticsMap.tsx");

test("月度演示：可复现、总量一致且明确标注非真实统计", () => {
  const sample = chinaPowerMonthlyDemoFrame("2025-12");
  assert.deepEqual(sample, chinaPowerMonthlyDemoFrame("2025-12"));
  assert.equal(sample.demo, true);
  assert.ok(powerDemoNotice.includes("非真实统计"));
  assert.ok(sample.regions.every(row => Number.isFinite(row.value) && row.value > 0));
  assert.ok(Math.abs(sample.total - sample.regions.reduce((sum, row) => sum + row.value, 0)) < .01);
  assert.notDeepEqual(sample.regions, chinaPowerMonthlyDemoFrame("2025-07").regions);
  assert.ok(chinaPowerMonthlyDemoFrame("2025-12", "wind-power").total < sample.total);
  assert.equal(chinaPowerMonthlyDemoFrame("invalid").period, "2025-12");
});

test("碳二维：四种视口完整适配，南北移动不抬升zoom或锁定纬度", () => {
  assert.deepEqual(carbonAtlasCenter, [0, 0]);
  for (const [clientWidth, clientHeight] of [[390, 844], [1440, 900], [1024, 768], [900, 650]]) {
    const zoom = overviewZoom({ clientWidth, clientHeight }, "atlas", 0);
    assert.ok(512 * 2 ** zoom <= Math.min(clientWidth, clientHeight));
    assert.equal(carbonAtlasCamera({ lng: 0, lat: 70 }, zoom).zoom, zoom);
    assert.equal(carbonAtlasCamera({ lng: 0, lat: -70 }, zoom).center[1], -70);
  }
  assert.equal(carbonAtlasCamera({ lng: 0, lat: -100 }, 0).center[1], -85.051);
});

test("月度演示：URL仅在发电量视图启用", () => {
  const href = workspaceContextHref("power", { powerView: "generation", powerDemo: "monthly", month: "2025-12" });
  assert.equal(readWorkspaceContext(new URL(href, "http://localhost").searchParams).powerDemo, "monthly");
  for (const powerView of ["capacity", "facilities"]) {
    assert.equal(readWorkspaceContext(new URLSearchParams(`powerView=${powerView}&powerDemo=monthly`)).powerDemo, undefined);
  }
});
test("组件：初始显式相机优先；没有相机时 selected fit；加载中及后续 focus 透传 provinceCode", async () => {
  for (const scenario of ["saved", "selected", "pending", "effect"]) {
    const refs = [];
    let index = 0;
    let effects = [];
    state.hooks = {
      useRef(value) { return refs[index++] ?? (refs[index - 1] = { current: value }); },
      useEffect(callback) { effects.push(callback); },
      useState: () => ["loading", () => {}],
    };
    const calls = [];
    state.componentFactory = () => ({ update() {}, focus: (...args) => calls.push(args), dispose() {} });
    let completeFetch;
    globalThis.fetch = () => new Promise(resolve => { completeFetch = () => resolve({ ok: true, json: async () => geo }); });
    const camera = { center: [85, 43], zoom: 4.2, pitch: 0, bearing: 0 };
    const props = { frame, selected: "650000000000", initialCamera: scenario === "saved" ? camera : undefined, screenshotRequest: 0, onCamera() {}, onHover() {}, onSelect() {}, onScreenshotComplete() {} };
    PowerStatisticsMap(props);
    refs[0].current = new Canvas();
    const mountEffects = effects;
    const cleanups = mountEffects.map(effect => effect());
    const focus = { nonce: 1, camera, provinceCode: "540000000000" };
    if (scenario === "pending") {
      effects = []; index = 0; PowerStatisticsMap({ ...props, focus });
      effects[0](); effects[3]();
    }
    completeFetch();
    await new Promise(resolve => setImmediate(resolve));
    if (scenario === "saved") assert.deepEqual(calls[0], [camera, false, undefined]);
    else if (scenario === "pending") assert.deepEqual(calls[0], [camera, false, focus.provinceCode]);
    else assert.deepEqual(calls[0], [undefined, false, props.selected]);
    if (scenario === "effect") {
      effects = []; index = 0; PowerStatisticsMap({ ...props, focus });
      effects[0](); effects[3]();
      assert.deepEqual(calls[1], [camera, true, focus.provinceCode]);
    }
    cleanups.forEach(cleanup => { if (typeof cleanup === "function") cleanup(); });
  }
});

test("Ember 档案：全国与 31 省分开读取，月度累计不跨缺失月份", () => {
  const path = new URL("public/data/china-power/ember-monthly.json", root);
  const archive = JSON.parse(readFileSync(path, "utf8"));
  const months = readEmberSeries(archive);
  const code = "110000000000";
  const latest = Object.keys(months).at(-1);
  assert.equal(Object.keys(months[latest]).length, 32);
  assert.notEqual(months[latest][nationalPowerCode].total, null);
  assert.ok(months[latest][code].mix.solar >= 0);
  const full = cumulativePowerSeries(months);
  assert.ok(Math.abs(full["2026-03"][code].total
    - ["2026-01", "2026-02", "2026-03"].reduce((sum, key) => sum + months[key][code].total, 0)) < .00001);
  const partial = { ...months, "2026-02": { ...months["2026-02"], [code]: { total: null } } };
  assert.equal(cumulativePowerSeries(partial)["2026-03"][code], undefined);
});

test("可比指标：同比与双期使用各自基准；零基数与缺值不计算", () => {
  assert.equal(readPowerMeasure("growth", { total: 120 }, { total: 100 }, { total: 80 }), 20);
  assert.equal(readPowerMeasure("change", { total: 120 }, { total: 100 }, { total: 80 }), 40);
  assert.equal(powerGrowth(5, 0), null);
  assert.equal(powerProductAmount({ total: 8, mix: { wind: 0 } }, "wind-power"), 0);
  assert.equal(powerProductAmount({ total: 8 }, "wind-power"), null);
  assert.deepEqual([powerBin(-40, 40, true), powerBin(0, 40, true), powerBin(40, 40, true), powerBin(null, 40, true)], [0, 2, 4, -1]);
  assert.equal(comparisonScatter("2022").length, 31);
  assert.deepEqual(comparisonScatter("2023"), []);
});
