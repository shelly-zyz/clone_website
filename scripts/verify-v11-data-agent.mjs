import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.DATA_AGENT_VERIFY_URL ?? "http://127.0.0.1:3000";
const token = process.env.DATA_AGENT_TOKEN;
const authorization = token ? { Authorization: `Bearer ${token}` } : {};

async function run(body, status = 200) {
  const response = await fetch(new URL("/api/data-agent", base), {
    method: "POST",
    headers: { ...authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}

const catalog = await run({ action: "catalog" });
assert.deepEqual(catalog.datasets.map(({ topic }) => topic).sort(), ["carbon", "meteo", "power"]);

const powerQuery = { topic: "power", start_date: "2025-01-01", end_date: "2025-03-31" };
const [power, meteo, carbon] = await Promise.all([
  run({ action: "query", query: powerQuery }),
  run({ action: "query", query: { topic: "meteo", limit: 3 } }),
  run({ action: "query", query: { topic: "carbon", limit: 3 } }),
]);

assert.deepEqual(power.rows.map(({ value }) => value), [null, null, "7780.2"]);
assert.equal(power.data_ref.quality.missing_rows, 2);
assert.equal(power.data_ref.units.value, "亿千瓦时");
assert.equal(meteo.data_ref.units.value, "°C");
assert.ok(meteo.rows.length > 0 && meteo.rows.every((row) => row.issue_time === meteo.query.issue_time && row.source_ref.payload_sha256));
assert.equal(carbon.data_ref.units.value, "kgC/h");
assert.ok(carbon.rows.length > 0 && carbon.rows.every((row) => row.source_ref.archive_sha256 && row.issue_time === null));

const replay = await run({ action: "query", query: power.query });
assert.deepEqual(replay.data_ref, power.data_ref);
assert.deepEqual(replay.rows, power.rows);
const explicitDefault = await run({ action: "query", query: { ...powerQuery, metric_code: power.metric.metric_code } });
assert.deepEqual(explicitDefault, power);
await run({ action: "query", query: { topic: "carbon", version: power.data_ref.version } }, 404);
await run({ action: "query", query: { topic: "power", sql: "drop table anything" } }, 400);
const empty = await run({ action: "query", query: { topic: "carbon", end_date: "1900-01-01" } });
assert.equal(empty.status, "empty");
assert.deepEqual(empty.rows, []);

const march = { topic: "power", start_date: "2025-03-01", end_date: "2025-03-31" };
const lastCarbonDay = { topic: "carbon", start_date: "2026-07-31", end_date: "2026-07-31" };
const samples = [
  [{ topic: "meteo", metric_code: "grid_wind_speed_100m_mean", limit: 1 }, "m/s", "wind100m"],
  [{ ...march, metric_code: "electricity_generation_cumulative" }, "亿千瓦时", "electricity", "22698.7"],
  [{ ...march, metric_code: "electricity_generation_yoy" }, "%", "electricity", "1.8"],
  [{ ...march, metric_code: "natural_gas_production_current" }, "亿立方米", "natural-gas", "226.8"],
  [{ ...lastCarbonDay, metric_code: "global_grid_nonzero_cell_count" }, "格点", "Power", "34045"],
  [{ ...lastCarbonDay, metric_code: "global_grid_total_cell_count" }, "格点", "Power", "6480000"],
];
const results = [];
for (const [query, unit, series, expected] of samples) {
  const result = await run({ action: "query", query });
  const dataset = catalog.datasets.find(({ topic }) => topic === query.topic);
  assert.ok(dataset.metrics.some(({ metric_code, series_codes }) => metric_code === query.metric_code && series_codes.includes(series)));
  assert.equal(result.status, "ok");
  assert.equal(result.metric.metric_code, query.metric_code);
  assert.equal(result.data_ref.units.value, unit);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].series_code, series);
  if (expected !== undefined) assert.equal(result.rows[0].value, expected);
  assert.deepEqual(await run({ action: "query", query: result.query }), result);
  results.push(result);
}
assert.notEqual(results[1].data_ref.query_hash, results[2].data_ref.query_hash);
const unsupportedMetric = await run({ action: "query", query: { ...march, metric_code: "grid_temperature_mean" } }, 422);
assert.equal(unsupportedMetric.code, "INVALID_METRIC");
const unsupportedSeries = await run({ action: "query", query: { ...samples[2][0], product: "wind-power" } }, 422);
assert.equal(unsupportedSeries.code, "INVALID_SERIES");

const mcp = new Client({ name: "verify-v11-data-agent", version: "1.0.0" });
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL("/api/mcp/data-agent", base), { requestInit: { headers: authorization } }));
  const tools = await mcp.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), ["list_published_catalog", "query_published_data"]);
  const directory = await mcp.callTool({ name: "list_published_catalog", arguments: {} });
  assert.deepEqual(directory.structuredContent, catalog);
  const result = await mcp.callTool({ name: "query_published_data", arguments: { query: samples[2][0] } });
  assert.deepEqual(result.structuredContent, results[2]);
} finally {
  await mcp.close();
}

for (const dataset of catalog.datasets) {
  console.log(`${dataset.topic} ${dataset.dataset_id} ${dataset.metrics.length} metrics ${dataset.row_count} rows ${dataset.version.slice(0, 12)}`);
}
console.log("PASS: metric selection, units, missing values, version replay, topic isolation and MCP parity");

if (process.argv.includes("--pi")) {
  const examples = [
    ["meteo", "查最新已入库 GFS 起报的全球格点平均气温。", "grid_temperature_mean", "°C"],
    ["power", "查国家统计局 2025 年 3 月全国发电量本期值。", "electricity_generation_current", "亿千瓦时", "7780.2"],
    ["carbon", "查 GRACED Power 2026 年 7 月 31 日全球日帧格点排放速率合计。", "global_grid_emission_rate_sum", "kgC/h"],
    ["meteo", "查最新已入库 GFS 起报的全球 100 米风速格点平均值，只要一个有效时刻。", "grid_wind_speed_100m_mean", "m/s"],
    ["power", "查国家统计局 2025 年 3 月全国发电量本期同比增长。", "electricity_generation_yoy", "%", "1.8"],
    ["carbon", "查 GRACED Power 2026 年 7 月 31 日全球日帧非零格点数。", "global_grid_nonzero_cell_count", "格点", "34045"],
  ];
  for (const [topic, question, metricCode, unit, expected] of examples) {
    const result = await run({ action: "ask", topic, question });
    assert.equal(result.mode, "pi");
    assert.equal(result.status, "ok");
    assert.equal(result.metric.metric_code, metricCode);
    assert.equal(result.data_ref.units.value, unit);
    assert.ok(result.trace.includes("search_semantic_catalog") && result.trace.includes("query_approved_metric"));
    if (expected !== undefined) assert.deepEqual(result.rows.map(({ value }) => value), [expected]);
    console.log(`PASS: ${topic} Pi catalogue + ${metricCode}`);
  }
}
