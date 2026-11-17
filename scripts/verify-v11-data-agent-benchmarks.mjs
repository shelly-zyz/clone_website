import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";

const base = process.env.DATA_AGENT_VERIFY_URL ?? "http://127.0.0.1:3000";
const token = process.env.DATA_AGENT_TOKEN;
const connectionString = process.env.DATA_AGENT_DATABASE_URL;
assert.ok(connectionString, "Set DATA_AGENT_DATABASE_URL to the published-data PostgreSQL connection.");

async function post(route, body, { key, expected = 200 } = {}) {
  const response = await fetch(new URL(`/api/${route}`, base), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { "X-Data-Project-Key": key } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${route}/${body.action ?? "ask"} returned ${response.status} ${result.code ?? ""}`);
  return result;
}

const query = (filters, expected) => post("data-agent", { action: "query", query: filters }, { expected });
const carbonMetric = "global_grid_emission_rate_sum";
const carbonRange = { start_date: "2026-07-02", end_date: "2026-07-31" };
const pg = new Client({ connectionString, connectionTimeoutMillis: 5000 });
await pg.connect();
try {
  await pg.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await pg.query("SET LOCAL ROLE green_agent_ro; SET LOCAL timezone = 'UTC'; SET LOCAL statement_timeout = '5s'");
  const { rows: [privilege] } = await pg.query(`
    SELECT current_user AS role, has_schema_privilege(current_user, 'projects', 'USAGE') AS project_access`);
  assert.deepEqual(privilege, { role: "green_agent_ro", project_access: false });

  const { rows: versions } = await pg.query("SELECT id, topic_id, version FROM catalog.dataset_version WHERE is_current");
  const version = Object.fromEntries(versions.map(row => [row.topic_id, row]));
  const powerRange = { start_date: "2025-01-01", end_date: "2025-03-31" };
  const samples = [
    { topic: "carbon", ...carbonRange, metric: carbonMetric, entity: "global", series: "Power",
      unit: "kgC/h", rule: "graced.power-rate.v1", count: 30 },
    { topic: "power", ...powerRange, metric: "electricity_generation_current", entity: "000000000000", series: "electricity",
      unit: "亿千瓦时", rule: "nbs.current.v1", expected: [null, null, "7780.2"] },
    { topic: "power", start_date: "2025-03-01", end_date: "2025-03-31", metric: "electricity_generation_cumulative",
      entity: "000000000000", series: "electricity", unit: "亿千瓦时", rule: "nbs.cumulative.v1", expected: ["22698.7"] },
    { topic: "power", start_date: "2025-03-01", end_date: "2025-03-31", metric: "electricity_generation_yoy",
      entity: "000000000000", series: "electricity", unit: "%", rule: "nbs.yoy.v1", expected: ["1.8"] },
    { topic: "power", start_date: "2025-03-01", end_date: "2025-03-31", metric: "electricity_generation_cumulative_yoy",
      entity: "000000000000", series: "electricity", unit: "%", rule: "nbs.cumulative-yoy.v1", count: 1 },
  ];
  for (const sample of samples) {
    const { topic, metric, entity, series, unit, rule, count, expected, ...dates } = sample;
    const { rows: baseline } = await pg.query(`
      SELECT to_char(time_start, 'YYYY-MM-DD') AS date, value::text, quality_flag
      FROM standard.std_data_agent_fact
      WHERE dataset_version_id = $1 AND metric_code = $2 AND entity_code = $3 AND series_code = $4
        AND time_start::date BETWEEN $5 AND $6
      ORDER BY time_start`, [version[topic].id, metric, entity, series, dates.start_date, dates.end_date]);
    const filters = { topic, version: version[topic].version, metric_code: metric, ...dates,
      ...(topic === "power" ? { product: series, region_code: entity } : {}) };
    const result = await query(filters);
    assert.equal(result.status, "ok");
    assert.equal(result.metric.metric_code, metric);
    assert.equal(result.data_ref.units.value, unit);
    assert.equal(result.data_ref.version, version[topic].version);
    assert.equal(result.metric.rules.id, rule);
    assert.equal(result.metric.rules.aggregation, "published_values_only");
    assert.ok(result.rows.every(row => row.series_code === series && row.entity_code === entity));
    assert.deepEqual(result.rows.map(({ time_start, value, quality_flag }) => ({ date: time_start.slice(0, 10), value, quality_flag })), baseline);
    if (expected) assert.deepEqual(baseline.map(row => row.value), expected);
    if (count) assert.equal(baseline.length, count);
    assert.deepEqual(await query(result.query), result);
    console.log(`PASS PostgreSQL baseline ${metric}`);
  }

  const meteo = version.meteo;
  const { rows: frames } = await pg.query(`
    SELECT time_start, issue_time, value::text FROM standard.std_data_agent_fact
    WHERE dataset_version_id=$1 AND metric_code='grid_temperature_mean' AND entity_code='global' AND series_code='temperature'
    ORDER BY issue_time DESC NULLS LAST, time_start DESC LIMIT 1`, [meteo.id]);
  assert.equal(frames.length, 1);
  const gfs = await query({ topic: "meteo", version: meteo.version, metric_code: "grid_temperature_mean", limit: 1 });
  assert.deepEqual(gfs.rows.map(({ time_start, issue_time, value }) => ({ time_start, issue_time, value })),
    frames.map(({ time_start, issue_time, value }) => ({ time_start: time_start.toISOString(), issue_time: issue_time.toISOString(), value })));
  assert.equal(gfs.data_ref.units.value, "°C");
  console.log("PASS PostgreSQL baseline GFS issue and valid time");

  const carbon = { topic: "carbon", version: version.carbon.version, metric_code: carbonMetric };
  const empty = await query({ ...carbon, end_date: "1900-01-01" });
  assert.equal(empty.status, "empty");
  assert.equal(empty.query.end_date, "1900-01-01");
  assert.deepEqual(empty.rows, []);
  const { rows: [coverage] } = await pg.query(`
    SELECT min(time_start::date)::text AS first, max(time_start::date)::text AS last
    FROM standard.std_data_agent_fact
    WHERE dataset_version_id=$1 AND metric_code='global_grid_emission_rate_sum'
      AND entity_code='global' AND series_code='Power' AND value IS NOT NULL`, [version.carbon.id]);
  assert.deepEqual(empty.diagnosis, { reason: "no_matching_rows", available_range: { start: coverage.first, end: coverage.last },
    suggested_range: { start_date: coverage.first, end_date: coverage.first } });
  const missing = await query({ topic: "power", version: version.power.version, region_code: "000000000000",
    start_date: "2025-01-01", end_date: "2025-02-28" });
  assert.equal(missing.status, "missing");
  assert.equal(missing.diagnosis.reason, "all_values_missing");
  assert.deepEqual(missing.rows.map(row => row.value), [null, null]);
  assert.equal(missing.query.end_date, "2025-02-28");
  assert.equal(missing.data_ref.quality.missing_rows, 2);
  const powerStart = missing.diagnosis.suggested_range.start_date;
  assert.ok(powerStart < missing.query.start_date || powerStart > missing.query.end_date);
  const recovered = await query({ ...missing.query, ...missing.diagnosis.suggested_range });
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.data_ref.version, missing.data_ref.version);
  assert.equal(recovered.query.region_code, missing.query.region_code);
  await query({ ...carbon, aggregation: "sum" }, 400);
  console.log("PASS empty versus missing, scoped coverage, original filters and rejection of arbitrary aggregation");
  await pg.query("COMMIT");
} finally {
  await pg.end();
}

if (process.argv.includes("--live")) {
  let context = {};
  async function xiaoyun(message) {
    const reply = await post("xiaoyun", { requestId: randomUUID(), topic: "carbon", message, context });
    if (reply.session) context = { sessions: { [reply.session.topic]: reply.session.scope }, lastTopic: reply.lastTopic, lastRoute: reply.lastRoute };
    return reply;
  }

  const empty = await xiaoyun("查 GRACED Power 在 1900 年 1 月 1 日的全球日帧格点排放速率合计，然后画折线图。");
  assert.equal(empty.data?.diagnosis?.reason, "no_matching_rows", empty.summary);
  assert.equal(empty.artifacts, undefined);
  assert.equal(empty.data.query.start_date, "1900-01-01");
  const confirmed = await xiaoyun("可以");
  assert.equal(confirmed.data?.data_ref.version, empty.data.data_ref.version, confirmed.summary);
  assert.equal(confirmed.data.query.start_date, empty.data.diagnosis.suggested_range.start_date);
  assert.ok(confirmed.artifacts?.some(artifact => artifact.kind === "chart"), confirmed.summary);
  console.log("PASS Xiaoyun diagnosis stops actions, confirmation resumes using the same version and original chart request");

  const drawn = await xiaoyun("查 GRACED Power 2026 年 7 月 2 日至 31 日每天的全球日帧格点排放速率合计，返回全部 30 天，并用 ECharts 画折线图。");
  assert.equal(drawn.route, "visualization", drawn.summary);
  assert.equal(drawn.data.data_ref.quality.returned_rows, 30);
  const scope = context.sessions.carbon;
  const { project_id, project_key: key } = scope;
  const project = { project_id };
  const chartState = await post("visualization", { action: "get_session", ...project, ...scope.visualization }, { key });
  assert.equal(chartState.summary.result_id, drawn.data.result_id);
  const task = await xiaoyun("用刚才图里的同一组数据做 StatsForecast 回测，留出最后 2 天。");
  assert.equal(task.route, "analysis", task.summary);
  const job_id = task.artifacts.find(artifact => artifact.kind === "analysis").jobId;
  const analysis = context.sessions.carbon.analysis;
  const analysisState = await post("analysis", { action: "get_session", ...project, ...analysis }, { key });
  assert.equal(analysisState.summary.result_id, drawn.data.result_id);
  const deadline = Date.now() + 120_000;
  for (;;) {
    const job = await post("analysis", { action: "get_job", ...project, job_id }, { key });
    assert.deepEqual(job.data_ref, drawn.data.data_ref);
    if (job.status === "succeeded") {
      assert.equal(job.plan.model, "statsforecast");
      assert.equal(job.result.points.length, 2);
      break;
    }
    assert.notEqual(job.status, "failed");
    assert.ok(Date.now() < deadline, "StatsForecast backtest timed out.");
    await sleep(1500);
  }

  const other = await post("data-agent", { action: "create_project", topic: "carbon", name: "V11 基准验收 · 权限隔离" });
  const ref = { action: "resolve_result", ...project, result_id: drawn.data.result_id };
  await post("data-agent", ref, { key: other.project_key, expected: 404 });
  await post("data-agent", { ...ref, project_id: other.project_id }, { key: other.project_key, expected: 404 });
  console.log("PASS Xiaoyun query, chart and backtest share the same result; cross-project access denied");

  const unsupported = await post("data-agent", { action: "ask", topic: "carbon",
    question: "把 2026 年 7 月所有 GRACED Power 的日帧速率直接相加作为 7 月总碳排放量，单位用 kgC。" });
  assert.equal(unsupported.issue, "unsupported");
  assert.equal(unsupported.data_ref, undefined);
  console.log("PASS Pi rejects converting GRACED rates into mass by summing");

  const power = await post("data-agent", { action: "create_project", topic: "power", name: "V11 基准验收 · 累计口径" });
  const powerKey = { key: power.project_key };
  const powerProject = { project_id: power.project_id };
  const powerSession = await post("data-agent", { action: "create_session", ...powerProject }, powerKey);
  const cumulative = await post("data-agent", { action: "ask", topic: "power", session: powerSession,
    question: "查统计局全国总发电量年初至本月累计值，2025 年 3 月至 12 月，逐月返回原值。" }, powerKey);
  assert.equal(cumulative.status, "ok");
  assert.equal(cumulative.metric.rules.id, "nbs.cumulative.v1");
  assert.ok(cumulative.rows.filter(row => row.value !== null).length >= 8);
  const { session_id, revision } = await post("analysis", { action: "create_session", ...powerProject }, powerKey);
  const blocked = await post("analysis", { action: "submit", ...powerProject, session_id, revision, result_id: cumulative.result_id,
    plan: { operation: "forecast", horizon: 1 } }, { ...powerKey, expected: 422 });
  assert.match(blocked.error, /跨年重置/);
  console.log("PASS cumulative series is rejected by the forecast preflight despite having sufficient observations");
}
