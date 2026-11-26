import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.DATA_AGENT_VERIFY_URL ?? "http://127.0.0.1:3000";
const token = process.env.DATA_AGENT_TOKEN;
const authorization = token ? { Authorization: `Bearer ${token}` } : {};

async function run(body, status = 200) {
  return runWithKey(body, status);
}

async function runWithKey(body, status, projectKey) {
  const response = await fetch(new URL("/api/data-agent", base), {
    method: "POST",
    headers: { ...authorization, "Content-Type": "application/json", ...(projectKey ? { "X-Data-Project-Key": projectKey } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}

const catalog = await run({ action: "catalog" });
const expanded = process.argv.includes("--supplemental");
const era5 = process.argv.includes("--era5");
const topics = new Set(catalog.datasets.map(({ topic }) => topic));
for (const topic of ["carbon", "meteo", "power", ...(expanded ? ["economy"] : [])]) assert.ok(topics.has(topic), topic);

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

if (era5) {
  const dataset = catalog.datasets.find(entry => entry.dataset_id === "meteo_era5_city_history");
  assert.equal(dataset?.row_count, 2160);
  const query = { topic: "meteo", location_code: "shanghai", start_date: "2026-10-20", end_date: "2026-10-20" };
  for (const [metric_code, unit, value] of [
    ["era5_air_temperature_2m", "°C", "23.2"], ["era5_wind_speed_10m", "m/s", "1.79"], ["era5_precipitation_1h", "mm", "0"],
  ]) {
    const result = await run({ action: "query", query: { ...query, metric_code } });
    assert.equal(result.metric.data_identity, "reanalysis");
    assert.equal(result.metric.unit, unit);
    assert.equal(result.metric.coverage.start, "2026-10-20T00:00:00Z");
    assert.equal(result.metric.coverage.end, "2026-11-18T23:00:00Z");
    assert.equal(result.rows.length, 24);
    assert.equal(result.rows[0].value, value);
    assert.equal(result.rows[0].source_ref.source_sha256, "683cdf85bf7435290f2d5cf5eb850d7b831dc9effb0ec09801dbd96b85fc5170");
    assert.ok(result.rows.every(row => row.entity_code === "shanghai" && row.issue_time === null && row.quality_flag === 0));
    assert.deepEqual(await run({ action: "query", query: result.query }), result);
  }
  await run({ action: "query", query: { ...query, location_code: "beijing" } }, 422);
  await run({ action: "query", query: { ...query, issue_time: "2026-10-20T00:00:00Z" } }, 400);
  assert.equal(meteo.data_ref.dataset_id, "meteo_gfs_forecast");
}

const replay = await run({ action: "query", query: power.query });
assert.deepEqual(replay.data_ref, power.data_ref);
assert.deepEqual(replay.rows, power.rows);
const explicitDefault = await run({ action: "query", query: { ...powerQuery, metric_code: power.metric.metric_code } });
assert.deepEqual(explicitDefault, power);
await run({ action: "query", query: { topic: "carbon", version: power.data_ref.version } }, 404);
await run({ action: "query", query: { topic: "power", sql: "drop table anything" } }, 400);
await run({ action: "query", query: { topic: "power", start_date: "0000-01-01" } }, 400);
await run({ action: "query", query: { topic: "power", region_code: "999999999999" } }, 422);
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

if (expanded) {
  const samples = [
    [{ topic: "power", city_code: "110000", start_date: "2019-01-01", end_date: "2019-12-31" }, "464", "research_estimate"],
    [{ topic: "carbon", city_code: "110000", start_date: "2019-01-01", end_date: "2019-12-31" }, "2639.232", "research_estimate"],
    [{ topic: "economy", economy_code: "CHN", start_date: "2024-01-01", end_date: "2024-12-31" }, "18729668435848", "official_statistics"],
    [{ topic: "economy", economy_code: "CHN", metric_code: "wdi_population_total", start_date: "2024-01-01", end_date: "2024-12-31" },
      "1408975000", "official_statistics"],
  ];
  for (const [query, expected, identity] of samples) {
    const response = await run({ action: "query", query });
    assert.deepEqual(response.rows.map(({ value }) => value), [expected]);
    assert.equal(response.metric.data_identity, identity);
    assert.equal(response.metric.rules.missing, "preserve_null");
    assert.deepEqual(await run({ action: "query", query: response.query }), response);
  }
  await run({ action: "query", query: { topic: "economy" } }, 400);
  await run({ action: "query", query: { topic: "carbon", metric_code: "city_power_co2_annual" } }, 422);
  await run({ action: "query", query: { topic: "power", city_code: "999999" } }, 422);
  const open = new URL("/api/data-agent/open/city?city_code=110000&metric=co2&year=2019", base);
  const response = await fetch(open, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const publicData = await response.json();
  assert.equal(publicData.source.license, "CC BY 4.0");
  assert.deepEqual(publicData.rows.map(row => row.value), ["2639.232"]);
  open.searchParams.set("format", "csv");
  const download = await fetch(open, { signal: AbortSignal.timeout(10000) });
  assert.match(download.headers.get("content-type"), /^text\/csv/);
  assert.match(await download.text(), /2639\.232.*research_estimate.*CC BY 4\.0/);
  open.searchParams.set("metric", "raw");
  assert.equal((await fetch(open, { signal: AbortSignal.timeout(10000) })).status, 400);

  const publicEconomy = new URL("/api/data-agent/open/economy?economy_code=CHN&metric=gdp&year=2024", base);
  const gdp = await fetch(publicEconomy, { signal: AbortSignal.timeout(10000) });
  assert.equal(gdp.status, 200);
  const published = await gdp.json();
  assert.deepEqual(published.rows, [{ economy_code: "CHN", year: "2024", value: "18729668435848", quality_flag: 0 }]);
  assert.match(published.source.terms_url, /worldbank.org/);
  publicEconomy.searchParams.set("metric", "population");
  publicEconomy.searchParams.set("format", "csv");
  const population = await fetch(publicEconomy, { signal: AbortSignal.timeout(10000) });
  assert.match(population.headers.get("content-type"), /^text\/csv/);
  assert.match(await population.text(), /1408975000.*World Development Indicators.*CC BY 4\.0.*terms-conditions\/datasets/);
  publicEconomy.searchParams.set("dataset_id", "internal");
  assert.equal((await fetch(publicEconomy, { signal: AbortSignal.timeout(10000) })).status, 400);
}

const mcp = new Client({ name: "verify-v11-data-agent", version: "1.0.0" });
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL("/api/mcp/data-agent", base), { requestInit: { headers: authorization } }));
  const tools = await mcp.listTools();
  const names = new Set(tools.tools.map(({ name }) => name));
  for (const name of ["list_published_catalog", "query_published_data", "resolve_project_result"]) assert.ok(names.has(name));
  if (expanded) {
    const metadata = await mcp.callTool({ name: "list_supplemental_catalog", arguments: {} });
    assert.equal(metadata.structuredContent.datasets.length, 25);
    const metrics = metadata.structuredContent.metrics;
    assert.equal(new Set(metrics.map(metric => metric.topic_id)).size, 4);
    assert.equal(new Set(metrics.map(metric => metric.source_sha256)).size, 16);
    assert.ok(metrics.every(metric => metric.aggregation && metric.missing && metric.entity_type && metric.unit));
    const cities = await mcp.callTool({ name: "list_published_entities", arguments: {
      topic: "carbon", dataset_id: "carbon_research_city_annual", search: "Beijing",
    } });
    assert.deepEqual(cities.structuredContent.entities, [{ code: "110000", name: "Beijing" }]);
  }
  const directory = await mcp.callTool({ name: "list_published_catalog", arguments: {} });
  assert.deepEqual(directory.structuredContent, catalog);
  const result = await mcp.callTool({ name: "query_published_data", arguments: { query: samples[2][0] } });
  assert.deepEqual(result.structuredContent, results[2]);
  if (era5) {
    const history = await mcp.callTool({ name: "query_published_data", arguments: {
      query: { topic: "meteo", location_code: "shanghai", start_date: "2026-10-20", end_date: "2026-10-20" },
    } });
    assert.equal(history.structuredContent?.data_ref.dataset_id, "meteo_era5_city_history");
    assert.equal(history.structuredContent.rows.length, 24);
  }
  const badArguments = await mcp.callTool({ name: "list_published_catalog", arguments: { unknown: true } });
  assert.equal(badArguments.isError, true);
} finally {
  await mcp.close();
}

if (process.argv.includes("--sessions")) {
  const project = await run({ action: "create_project", topic: "power", name: "V11 问数验收" });
  const key = project.project_key;
  const projectId = project.project_id;
  const session = await runWithKey({ action: "create_session", project_id: projectId }, 200, key);
  const scope = { project_id: projectId, session_id: session.session_id, revision: 0 };
  const ask = (question, revision) => ({ action: "ask", topic: "power", question, session: { ...scope, revision } });
  const first = await runWithKey(ask("查国家统计局 2025 年 3 月全国发电量本期值。", 0), 200, key);
  assert.equal(first.status, "ok");
  assert.equal(first.revision, 1);
  assert.deepEqual(first.rows.map(({ value }) => value), ["7780.2"]);
  const second = await runWithKey(ask("把上一条的地区换成湖北，其他条件保持一样。", 1), 200, key);
  assert.equal(second.status, "ok");
  assert.equal(second.revision, 2);
  assert.equal(second.query.region_code, "420000000000");
  assert.equal(second.data_ref.version, first.data_ref.version);
  assert.equal(second.query.start_date, first.query.start_date);
  assert.equal(second.metric.metric_code, first.metric.metric_code);
  await runWithKey(ask("重复上一条。", 1), 409, key);

  const getSession = { action: "get_session", project_id: projectId, session_id: scope.session_id };
  const restored = await runWithKey(getSession, 200, key);
  assert.equal(restored.summary.region_code, "420000000000");
  assert.equal(restored.turns.length, 2);
  const ref = { project_id: projectId, result_id: second.result_id };
  const resolved = await runWithKey({ action: "resolve_result", ...ref }, 200, key);
  assert.deepEqual(resolved.data_ref, second.data_ref);
  assert.deepEqual(resolved.rows, second.rows);
  await run({ action: "resolve_result", ...ref }, 404);
  await run(getSession, 404);

  const other = await runWithKey({ action: "create_session", project_id: projectId }, 200, key);
  const otherState = await runWithKey({ ...getSession, session_id: other.session_id }, 200, key);
  assert.equal(otherState.summary, null);
  assert.deepEqual(otherState.turns, []);
  const business = new Client({ name: "verify-project-result", version: "1.0.0" });
  try {
    await business.connect(new StreamableHTTPClientTransport(new URL("/api/mcp/data-agent", base), {
      requestInit: { headers: { ...authorization, "X-Data-Project-Key": key } },
    }));
    const result = await business.callTool({ name: "resolve_project_result", arguments: ref });
    assert.deepEqual(result.structuredContent, resolved);
  } finally {
    await business.close();
  }
  console.log("PASS: persisted Pi follow-up, session isolation, revision conflict and MCP result resolution");
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
  if (expanded) examples.push(
    ["power", "北京 2019 年的城市发电量估算是多少？", "city_power_generation_annual", "亿千瓦时", "464"],
    ["carbon", "北京 2019 年的电力部门碳排放估算是多少？", "city_power_co2_annual", "万吨 CO₂", "2639.232"],
    ["economy", "世界银行 WDI 的中国 2024 年现价美元 GDP 是多少？", "wdi_gdp_current_usd", "美元", "18729668435848"],
  );
  if (era5) examples.push(
    ["meteo", "查上海 2026 年 10 月 20 日 UTC 的 ERA5 逐小时 2 米历史气温。", "era5_air_temperature_2m", "°C"],
  );
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
