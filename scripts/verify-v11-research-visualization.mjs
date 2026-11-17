import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = process.env.DATA_AGENT_VERIFY_URL ?? "http://127.0.0.1:3000";
const token = process.env.DATA_AGENT_TOKEN;
const authorization = token ? { Authorization: "Bearer " + token } : {};
const artifacts = process.env.OGW_VIZ_VERIFY_ARTIFACTS;
const path = "/api/visualization/workspace";
const fixture = (topic, metric_code, rest = {}) => ({ kind: "published", query: { topic, metric_code, limit: 120, ...rest } });
const nbs = (product) => fixture("power", "electricity_generation_current",
  { product, start_date: "2024-03-01", end_date: "2025-10-31" });
const gfs = fixture("meteo", "grid_temperature_mean");
const wind = fixture("meteo", process.env.OGW_VIZ_VERIFY_WIND_METRIC ?? "grid_wind_speed_100m_mean");
const graced = fixture("carbon", "global_grid_emission_rate_sum", { start_date: "2025-08-01", end_date: "2025-08-31" });
const wdi = { kind: "economy", metric: "real-growth", country: "CHN", start_year: 2015, end_year: 2025 };
const gep = { kind: "economy", metric: "growth-outlook", country: "CHN", start_year: 2026, end_year: 2028 };
const windSolar = [nbs("wind-power"), nbs("solar-power")];
const job = (datasets, extras = {}) => ({ task_id: randomUUID(), configuration: { datasets, ...extras } });

async function post(body, project, expected = 200, url = path, binary = false, base = origin) {
  const response = await fetch(new URL(url, base), { method: "POST", signal: AbortSignal.timeout(50_000),
    headers: { ...authorization, "Content-Type": "application/json", ...(project ? {
      "X-Data-Project-Id": project.project_id, "X-Data-Project-Key": project.project_key,
    } : {}) }, body: JSON.stringify(body) });
  if (response.status !== expected) {
    const error = await response.json().catch(() => ({}));
    assert.equal(response.status, expected, JSON.stringify({ action: body.action, code: error.code, error: error.error }));
  }
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}

async function mcp(project, run) {
  const client = new Client({ name: "opengridworks-research-verifier", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/api/mcp/visualization", origin), {
    requestInit: { headers: { ...authorization, "X-Data-Project-Key": project.project_key } },
  });
  try {
    await client.connect(transport);
    await run(client, async (name, args, expectedError) => {
      const response = await client.callTool({ name, arguments: { project_id: project.project_id, ...args } });
      const value = response.structuredContent ?? JSON.parse(response.content[0].text);
      assert.equal(Boolean(response.isError), Boolean(expectedError), name + " " + (value.error ?? ""));
      if (expectedError) assert.equal(value.code, expectedError);
      return value;
    });
  } finally { await client.close(); }
}

async function exported(project, figure, format, filename) {
  const bytes = await post({ action: "export", artifact_id: figure.artifact_id, format }, project, 200, path, true);
  assert.ok(bytes.length > 100);
  if (filename && artifacts) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, filename), bytes);
  }
  return bytes;
}

const catalog = await post({ action: "catalog" });
const project = await post({ action: "start", domain: "electricity" });
const other = await post({ action: "start", domain: "economy" });
const primary = job(windSolar);
const power = await post({ action: "render", job: primary }, project);
assert.equal(power.plan.engine, "echarts");
assert.equal(power.plan.renderer, "echarts");
assert.equal(power.plan.datasets.length, 2);
assert.ok(power.plan.datasets.every(source => source.unit === "亿千瓦时" && source.sample_count >= 8));
assert.deepEqual(await post({ action: "render", job: primary }, project), power);
const duplicate = await post({ action: "render", job: { ...primary, configuration: { ...primary.configuration, kind: "stack" } } }, project, 409);
assert.equal(duplicate.code, "CONFLICT");
const initial = await post({ action: "save", artifact_id: power.artifact_id }, project);
if (process.env.OGW_VIZ_VERIFY_SECOND_ORIGIN) {
  const alternate = await post({ action: "edit", task_id: randomUUID(), artifact_id: power.artifact_id, patch: { layout: "vertical" } },
    project, 200, path, false, process.env.OGW_VIZ_VERIFY_SECOND_ORIGIN);
  assert.deepEqual(alternate.plan.datasets, power.plan.datasets);
  assert.equal(alternate.plan.layout, "vertical");
  console.log("PASS scoped working previews across two Next.js processes");
}
const edit = await post({ action: "ask", domain: "electricity", task_id: randomUUID(), artifact_id: power.artifact_id, message: "换成学术黑白" }, project);
assert.equal(edit.plan.design.theme, "academic-monochrome");
assert.deepEqual(edit.plan.datasets, power.plan.datasets);
assert.deepEqual(edit.statistics, power.statistics);
assert.deepEqual(edit.insights, power.insights);
const save = { action: "save", artifact_id: edit.artifact_id, figure_id: initial.saved.figure_id, expected_revision: 1 };
const updated = await post(save, project);
assert.equal(updated.saved.revision, 2);
assert.equal((await post(save, project)).saved.revision, 2);
const conflictingEdit = await post({ action: "edit", task_id: randomUUID(), artifact_id: power.artifact_id, patch: { title: "等待并发验证" } }, project);
assert.equal((await post({ ...save, artifact_id: conflictingEdit.artifact_id }, project, 409)).code, "CONFLICT");
const first = await post({ action: "open", figure_id: initial.saved.figure_id, revision: 1 }, project);
assert.deepEqual(first.result.render, power.render);
assert.deepEqual(first.result.statistics, power.statistics);
assert.equal((await post({ action: "list" }, project)).figures[0].revision, 2);
await post({ action: "open", figure_id: initial.saved.figure_id }, other, 404);
await post({ action: "edit", task_id: randomUUID(), artifact_id: power.artifact_id, patch: { title: "隔离检查" } }, other, 404);
await post({ action: "get_session", project_id: project.project_id, session_id: initial.saved.figure_id }, project, 404, "/api/visualization");
const svg = await exported(project, edit, "svg", "electricity.svg");
const json = JSON.parse(await exported(project, edit, "json", "electricity.json"));
assert.match(svg.toString(), /<svg[\s>]/);
assert.equal(json.engine_version, "6.1.0");
assert.deepEqual(json.source_versions.map(src => src.digest), power.plan.datasets.map(src => src.digest));
console.log("PASS NBS wind and solar, local style edit, reproducibility, save CAS and project/legacy isolation");

const weather = await post({ action: "render", job: job([gfs, wind], { kind: "trend" }) }, project);
assert.equal(new Set(weather.plan.datasets.map(source => source.unit)).size, 2);
assert.equal(weather.viewport.panels, 2);
assert.ok(weather.plan.datasets.every(source => source.forecast_origin && source.forecast_horizon));
const carbon = await post({ action: "render", job: job([graced], { kind: "calendar" }) }, project);
assert.equal(carbon.plan.datasets[0].unit, "kgC/h");
assert.ok(carbon.plan.datasets[0].sample_count >= 28);
const economy = await post({ action: "render", job: job([wdi, gep]) }, project);
assert.equal(economy.plan.chart, "forecast");
assert.equal(economy.plan.datasets[0].sample_count, 11);
assert.equal(economy.plan.datasets[1].sample_count, 3);
assert.equal(economy.plan.datasets[1].interval_method, null);
assert.match(economy.plan.datasets[1].forecast_origin_period, /^\d{4}-\d{2}$/);
assert.ok(economy.plan.datasets.every(source => source.source_url.length > 0));
assert.equal((await post({ action: "plan", job: job([nbs("wind-power"), gfs], { kind: "scatter" }) }, project, 422)).code, "INCOMPATIBLE");
assert.equal((await post({ action: "profile", datasets: [{ ...wdi, start_year: 2190, end_year: 2199 }] }, project, 422)).code, "DATA_GAP");
console.log("PASS NOAA GFS, GRACED, World Bank WDI/GEP, data gap and rejection of an incompatible cross-domain join");

if (process.env.OGW_VIZ_VERIFY_GRIDS === "true") {
  for (const dataset of [{ kind: "gfs-grid", field: "temperature" },
    { kind: "replay-grid", id: "us-southeast-2026-09-26", field: "rain", archive: true }]) {
    const grid = await post({ action: "render", job: job([dataset], { kind: "grid" }) }, project);
    const profile = grid.plan.datasets[0];
    assert.equal(profile.dimensions.coordinates, "EPSG:4326");
    assert.equal(profile.grid.lon.length * profile.grid.lat.length, profile.sample_count);
    assert.equal(grid.render.option.series[0].data.length, profile.sample_count - profile.missing);
  }
  console.log("PASS real global GFS and regional satellite grids, metadata and missing-value mask");
}

await mcp(project, async (client, call) => {
  const { tools } = await client.listTools();
  const names = tools.map(item => item.name);
  assert.equal(names.length, 35);
  const domainCalls = [
    ["electricity.analyze_generation_mix", { datasets: windSolar }, "stack"],
    ["meteorology.analyze_wind_field", { datasets: [wind] }, weather.plan.datasets[1].sample_count - weather.plan.datasets[1].missing < 4 ? "trend" : "box"],
    ["carbon.harmonize_emission_units", { datasets: [graced], target_unit: "tCO2/h" }, null],
    ["economy.compare_forecasts", { datasets: [wdi, gep] }, "forecast"],
  ];
  for (const [name, params, kind] of domainCalls) {
    assert.ok(names.includes(name));
    const result = await call(name, params);
    assert.equal(result.recommended_chart, kind);
    if (name.startsWith("carbon.")) assert.equal(result.statistics[0].factor, 44 / 12 / 1000);
  }
  await call("electricity.analyze_market_prices", { datasets: [nbs("wind-power")] }, "DATA_GAP");
  await call("carbon.compare_scenarios", { datasets: [graced] }, "DATA_GAP");
  const made = await call("viz.render_interactive", { job: job([wdi]) });
  const validation = await call("viz.validate_chart", { job: job([wdi]) });
  assert.equal(validation.validation.status, "valid");
  assert.match(Buffer.from((await call("viz.export_chart", { artifact_id: made.artifact_id, format: "svg" })).base64, "base64").toString(), /<svg/);
  if (catalog.engines.find(engine => engine.id === "flint")?.available) {
    const flint = await call("viz.render_interactive", { job: job([wdi], { engine: "flint" }) });
    assert.equal(flint.plan.engine, "flint");
    assert.equal(flint.plan.renderer, "echarts");
    assert.deepEqual(flint.render.option.series[0].data, made.render.option.series[0].data.map(row => row[1]));
    console.log("PASS Flint MCP 1.0.1 validates and compiles identical values into a single ECharts configuration");
  }
});
console.log("PASS existing and research MCP registration, all four domain operations and blocked unreleased scenarios");

if (catalog.engines.find(engine => engine.id === "matplotlib")?.available) {
  const paper = await post({ action: "render", job: job(windSolar, { mode: "paper", kind: "trend-distribution",
    title: "风电与太阳能 · 月度发电量", style: { width_mm: 183, height_mm: 118, theme: "academic-monochrome" } }) }, project);
  assert.equal(paper.viewport.panels, 2);
  assert.equal(paper.render.kind, "image");
  for (const [format, basename, prefix] of [["svg", "paper.svg", "<?xml"], ["pdf", "paper.pdf", "%PDF-"],
    ["png", "paper.png", "\x89PNG"], ["python", "paper.py", '"""Render']]) {
    const bytes = await exported(project, paper, format, basename);
    assert.equal(bytes.subarray(0, prefix.length).toString("latin1"), prefix);
    if (format === "png") assert.ok(Math.abs(bytes.readUInt32BE(16) - 183 * 300 / 25.4) <= 1);
  }
  console.log("PASS Matplotlib multi-panel SVG, PDF, editable Python and 300 DPI PNG dimensions");
}

if (process.env.OGW_VIZ_VERIFY_PI === "true") {
  const requested = await post({ action: "ask", task_id: randomUUID(), domain: "economy",
    message: "画中国 2015 年至 2025 年实际 GDP 增速和 2026 至 2028 年世界银行展望。" }, project);
  assert.equal(requested.plan.chart, "forecast");
  const renamed = await post({ action: "ask", task_id: randomUUID(), domain: "economy", artifact_id: requested.artifact_id,
    message: "把这张图的标题设为《中国经济与增长展望》，图例放在顶部。" }, project);
  assert.equal(renamed.recipe.title.replace(/[《》]/g, ""), "中国经济与增长展望");
  assert.equal(renamed.plan.design.legend, "top");
  assert.deepEqual(renamed.plan.datasets, requested.plan.datasets);
  console.log("PASS live Pi natural-language plan and incremental revision");
}
