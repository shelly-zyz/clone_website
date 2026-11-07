import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.DATA_AGENT_VERIFY_URL ?? "http://127.0.0.1:3000";
const token = process.env.DATA_AGENT_TOKEN;
const authorization = token ? { Authorization: `Bearer ${token}` } : {};
const api = { data: "/api/data-agent", analysis: "/api/analysis", visual: "/api/visualization" };

async function post(route, body, key, expected = 200) {
  const response = await fetch(new URL(route, base), {
    method: "POST", headers: { ...authorization, "Content-Type": "application/json", ...(key ? { "X-Data-Project-Key": key } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(35_000),
  });
  const json = await response.json();
  assert.equal(response.status, expected, JSON.stringify({ route, action: body.action, response: json }));
  return json;
}

async function withMcp(path, key, run) {
  const client = new Client({ name: "verify-v11-business-agents", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(path, base),
    { requestInit: { headers: { ...authorization, "X-Data-Project-Key": key } } });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
  }
}

const { project_id, project_key: key } = await post(api.data, { action: "create_project", topic: "carbon", name: "V11 业务 Agent 联调验收" });
const querySession = await post(api.data, { action: "create_session", project_id }, key);
const data = await post(api.data, { action: "ask", topic: "carbon", session: querySession,
  question: "查 GRACED Power 2026 年 7 月 1 日至 31 日每天的全球日帧格点排放速率合计，返回 31 天。" }, key);
assert.equal(data.status, "ok");
assert.equal(data.rows.length, 31);
const result_id = data.result_id;
const chartRequest = { project_id, result_id, chart: "line" };
const charts = {};
await withMcp("/api/mcp/visualization", key, async client => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ["build_power_globe_scene", "render_antv", "render_echarts", "render_vchart"]);
  for (const renderer of ["echarts", "vchart", "antv"]) {
    const reply = await client.callTool({ name: `render_${renderer}`, arguments: chartRequest });
    assert.ok(!reply.isError, JSON.stringify(reply));
    assert.deepEqual(reply.structuredContent.data_ref, data.data_ref);
    charts[renderer] = reply.structuredContent;
  }
});
const scene = await post(api.visual, { action: "scene", project_id, renderer: "three", limit: 60 }, key);
assert.ok(scene.options.count > 0);
assert.equal(scene.options.positions.length, 3 * scene.options.count);
const map = await post(api.visual, { action: "scene", project_id, renderer: "maplibre" }, key);
assert.equal(map.options.style.projection.type, "globe");
console.log("PASS three chart MCP adapters and two real-source globe configurations");

const vizSession = await post(api.visual, { action: "create_session", project_id }, key);
const first = await post(api.visual, { action: "ask_session", ...vizSession, result_id, instruction: "用 ECharts 折线图画出趋势" }, key);
const second = await post(api.visual, { action: "ask_session", ...vizSession, revision: first.revision, instruction: "用 VChart 画同一张图" }, key);
assert.equal(second.renderer, "vchart");
assert.equal(second.template_id, "vchart.line.time-series");
assert.equal(second.result_id, result_id);
await post(api.visual, { action: "ask_session", ...vizSession, instruction: "重新绘图" }, key, 409);
await post(api.visual, { action: "get_session", project_id, session_id: vizSession.session_id }, null, 404);
console.log("PASS visualization Pi renderer follow-up, revision guard and project authorization");

const analysisSession = await post(api.analysis, { action: "create_session", project_id }, key);
let revision = 0;
const jobs = [];
async function submit(plan) {
  const task = await post(api.analysis, { action: "submit", ...analysisSession, revision, result_id, plan }, key, 202);
  revision = task.revision;
  jobs.push(task);
}
await withMcp("/api/mcp/analysis", key, async client => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    "cluster_series", "compare_models", "create_analysis_session", "describe_series", "read_analysis_job", "run_backtest", "run_forecast",
  ]);
  const submitted = await client.callTool({ name: "describe_series", arguments: { ...analysisSession, result_id } });
  assert.ok(!submitted.isError, JSON.stringify(submitted));
  revision = submitted.structuredContent.revision;
  jobs.push(submitted.structuredContent);
});
await submit({ operation: "cluster", clusters: 3 });
await submit({ operation: "backtest", model: "statsforecast", horizon: 3 });
const selected = await post(api.analysis, { action: "ask", ...analysisSession, revision,
  instruction: "用 TimesFM 对同一份数据做回测，留出最后 4 天，与统计基线对比。" }, key, 202);
assert.deepEqual(selected.plan, { operation: "compare", model: "timesfm", horizon: 4 });
revision = selected.revision;
jobs.push(selected);
const follow = await post(api.analysis, { action: "ask", ...analysisSession, revision, instruction: "其他参数保持，模型换成 Chronos-2。" }, key, 202);
assert.deepEqual(follow.plan, { operation: "compare", model: "chronos2", horizon: 4 });
jobs.push(follow);

const snapshot = await post(api.analysis, { action: "get_session", project_id, session_id: analysisSession.session_id }, key);
assert.equal(snapshot.recent.length, 4);
assert.equal(snapshot.summary.result_id, result_id);
assert.equal(snapshot.summary.job_id, follow.job_id);
await post(api.analysis, { action: "get_job", project_id, job_id: follow.job_id }, null, 404);
for (const task of jobs) {
  const deadline = Date.now() + 210_000;
  for (;;) {
    const job = await post(api.analysis, { action: "get_job", project_id, job_id: task.job_id }, key);
    assert.deepEqual(job.data_ref, data.data_ref);
    if (job.status === "failed") throw new Error(JSON.stringify({ plan: task.plan, error: job.error }));
    if (job.status === "succeeded") {
      if (task.plan.horizon) {
        assert.equal(job.result.points.length, task.plan.horizon);
        assert.ok(job.result.points[0].date > job.result.training_end);
        assert.ok(Number.isFinite(job.result.evaluation.mae));
        if (task.plan.operation === "compare") {
          assert.ok(Number.isFinite(job.result.baseline.mae));
          for (const { p10, p50, p90 } of job.result.points) assert.ok(p10 <= p50 && p50 <= p90);
        }
      }
      console.log("PASS Worker", task.plan.operation, task.plan.model ?? "", job.result.model?.device ?? "");
      break;
    }
    assert.ok(Date.now() < deadline, `Worker did not complete ${JSON.stringify(task.plan)}`);
    await sleep(1200);
  }
}

if (process.env.OGW_VERIFY_SPECS) {
  await writeFile(process.env.OGW_VERIFY_SPECS, JSON.stringify({ charts, scene, map }));
}
