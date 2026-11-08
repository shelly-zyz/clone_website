import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAssistantMessageEventStream, createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

const fixtures = {
  topics: new Map(), results: new Map(), sessions: new Map(), jobs: new Map(),
  steps: [], output: [], lastQuery: undefined,
};

const models = createModels();
models.setProvider(deepseekProvider());
const model = models.getModel("deepseek", "deepseek-flash");
fixtures.pi = {
  model,
  models: {
    streamSimple(currentModel, context) {
      fixtures.output = context.messages.filter(message => message.role === "toolResult")
        .map(message => JSON.parse(message.content[0].text));
      const step = fixtures.steps.shift();
      const stopReason = step ? "toolUse" : "stop";
      const message = {
        role: "assistant", content: step ? [{ type: "toolCall", id: randomUUID(), name: step[0], arguments: step[1] }] : [],
        api: currentModel.api, provider: currentModel.provider, model: currentModel.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason, timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: stopReason, message });
      stream.end();
      return stream;
    },
  },
};

const modules = {
  "server-only": "",
  "@/lib/data-agent/database.server": `
    export class DataAgentError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    export function runDataAgentWrite() { throw new Error("Unexpected database call in fixture"); }
    export function readDataAgent() { throw new Error("Unexpected database call in fixture"); }`,
  "@/lib/data-agent/pi.server": `export function getPiModel() { return globalThis.xiaoyunFixture.pi; }`,
  "@/lib/agent-runtime/store": `
    import { randomUUID } from "node:crypto";
    const f = globalThis.xiaoyunFixture;
    export async function createAgentSession(project_id, kind) {
      const session_id = randomUUID();
      const snapshot = { session_id, project_id, revision: 0 };
      f.sessions.set(session_id, { ...snapshot, kind, recent: [], summary: {} });
      return snapshot;
    }
    export async function getAgentSession(project, id, kind) {
      const value = f.sessions.get(id);
      if (value?.project_id === project && value.kind === kind) return structuredClone(value);
    }
    export async function advanceAgentSession(session, kind, summary, turn, task) {
      const old = f.sessions.get(session.session_id);
      if (old.revision !== session.revision || old.kind !== kind) return { status: "conflict" };
      const revision = old.revision + 1;
      const job_id = task && (task.job_id || randomUUID());
      if (task) {
        f.jobs.set(job_id, { project: session.project_id, job_id, data_ref: task.data_ref, plan: task.plan, status: "queued",
          analysis_session_id: task.input.analysis_session_id });
      }
      f.sessions.set(session.session_id, { ...old, revision, summary: { ...summary, job_id }, recent: [...old.recent, turn].slice(-4) });
      return { status: "saved", revision, job_id };
    }
    export async function getAnalysisJob(project, id) {
      const job = f.jobs.get(id);
      if (job?.project === project) return job;
    }`,
  "@/lib/data-agent/state.server": `
    const f = globalThis.xiaoyunFixture;
    function match(project, key) {
      const state = [...f.topics.values()].find(item => item.scope.project_id === project && item.scope.project_key === key);
      if (!state) throw new Error("Unauthorized fixture project");
      return state;
    }
    export async function readDataSession(project, session, key) {
      const state = match(project, key);
      if (state.scope.session_id !== session) throw new Error("Unauthorized fixture session");
      return structuredClone(state.data);
    }
    export async function assertDataProject(project, key) { match(project, key); }
    export async function resolveDataResult(project, id, key) {
      const state = match(project, key);
      const entry = f.results.get(id);
      if (state.data.topic !== entry.query.topic) throw new Error("Unauthorized fixture result");
      return entry;
    }
    export async function askDataSession(topic, question, scope, key, signal, options) {
      const state = match(scope.project_id, key);
      if (state.data.topic !== topic || state.data.revision !== scope.revision) throw new Error("Invalid fixture scope");
      f.lastQuery = { question, options };
      const revision = ++state.data.revision;
      if (state.clarifyNext) {
        state.clarifyNext = false;
        const message = "请确认本期值还是累计值。";
        state.data.xiaoyun_pending = { ...options, question, clarification: message, revision };
        return { status: "needs_clarification", issue: "clarify", message, revision };
      }
      state.data.xiaoyun_pending = null;
      const id = state.nextResult;
      state.data.last_result_id = id;
      return { ...f.results.get(id), result_id: id, revision };
    }
    export function createDataProject() { throw new Error("Unexpected fixture project creation"); }
    export function createDataSession() { throw new Error("Unexpected fixture session creation"); }`,
};

globalThis.xiaoyunFixture = fixtures;
const sourceRoot = new URL("../src/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const location = specifier.startsWith("@/") ? new URL("../src/" + specifier.slice(2), import.meta.url)
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL) : null;
    const key = location?.href.startsWith(sourceRoot) ? "@/" + location.href.slice(sourceRoot.length) : specifier;
    if (Object.hasOwn(modules, key)) {
      return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(modules[key]) };
    }
    if (location?.protocol === "file:" && existsSync(fileURLToPath(location) + ".ts")) {
      return nextResolve(pathToFileURL(fileURLToPath(location) + ".ts").href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { askXiaoyun } = await import("../src/lib/xiaoyun/supervisor.server.ts");

const context = { sessions: {} };
const selection = { topic: "power", target: "current" };
const query = ["query_data", { topic: "power", question: "查江苏每日发电量" }];
const chart = ["render_chart", { ...selection, renderer: "vchart" }];

function scope(topic) {
  const value = { project_id: randomUUID(), project_key: "x".repeat(43), session_id: randomUUID() };
  context.sessions[topic] = value;
  fixtures.topics.set(topic, { scope: value, data: { topic, revision: 0, last_result_id: null } });
}

function data(topic, name, days, grain = "day", status = "ok") {
  const id = randomUUID();
  const issue_time = grain === "forecast_frame" ? "2026-01-01T00:00:00.000Z" : null;
  const rows = days.map((day, i) => ({
    time_start: new Date(Date.UTC(2026, 0, day)).toISOString(),
    issue_time, entity_code: "test", series_code: "test", value: String(i + 1), quality_flag: 0,
    source_ref: { region_name: name, url: "https://example.test/dataset" },
  }));
  const metric = { name: "测试指标", unit: "unit", time_grain: grain, data_identity: issue_time ? "forecast" : "official_statistics",
    source_name: "固定样例", definition: "固定指标口径" };
  const ref = { version: "v".repeat(64), dataset_id: "fixture", query_hash: id, schema: [],
    time_range: { start: rows[0]?.time_start ?? null, end: rows.at(-1)?.time_start ?? null },
    quality: { returned_rows: rows.length, matched_rows: rows.length, missing_rows: 0, truncated: false } };
  fixtures.results.set(id, { status, rows, metric, query: { topic, issue_time }, data_ref: ref });
  fixtures.topics.get(topic).nextResult = id;
  return id;
}

async function turn(steps, input = {}) {
  fixtures.steps = [...steps];
  fixtures.output = [];
  const result = await askXiaoyun({ message: "固定验收", topic: "power", context, ...input }, new AbortController().signal);
  if (result.session) context.sessions[result.session.topic] = result.session.scope;
  return result;
}

await test("小云按同一 DataRef 串联查数、出图、预测和来源", async () => {
  scope("power");
  const inputId = data("power", "江苏", Array.from({ length: 14 }, (_, i) => i + 1));
  const predict = ["submit_analysis", { ...selection, plan: { operation: "forecast", horizon: 3 } }];
  const requestId = randomUUID();
  const result = await turn([query, chart, predict], { requestId });
  assert.deepEqual(result.artifacts.map(({ kind }) => kind), ["chart", "analysis"]);
  assert.equal(fixtures.output[1].result_id, inputId);
  assert.equal(fixtures.jobs.get(result.artifacts[1].jobId).data_ref.query_hash, inputId);
  const analysisSession = context.sessions.power.analysis.session_id;
  delete context.sessions.power.analysis;
  const replay = await turn([["inspect_data", selection], predict], { requestId });
  assert.equal(replay.artifacts[0].jobId, result.artifacts[1].jobId);
  assert.equal(context.sessions.power.analysis.session_id, analysisSession);
  assert.equal(fixtures.jobs.size, 1);
  const priorChart = result.artifacts[0].chartId;
  const hubeiId = data("power", "湖北", [1, 2, 3]);
  await turn([query, chart], { message: "查湖北并画图" });
  assert.notEqual(hubeiId, inputId);
  const selectedChart = { topic: "power", chart_id: priorChart };
  const oldTarget = { topic: "power", target: "chart" };
  const revised = await turn([["inspect_data", oldTarget], ["render_chart", { ...oldTarget, chart: "bar" }]], { selectedChart });
  assert.equal(fixtures.output[1].result_id, inputId);
  assert.match(revised.artifacts[0].title, /江苏/);
  assert.equal(revised.artifacts[0].renderer, "vchart");
  const sources = await turn([], { message: "展示来源", selectedChart });
  assert.equal(sources.data.result_id, inputId);
  await turn([["query_data", { topic: "power", question: "改成湖北", base: "chart" }]], { selectedChart });
  assert.equal(fixtures.lastQuery.options.baseResultId, inputId);
});

await test("GFS 预报帧可按有效时间展示，无法作为历史序列入队", async () => {
  scope("meteo");
  const id = data("meteo", "全球", [1, 2, 3, 4, 5, 6, 7, 8], "forecast_frame");
  const target = { topic: "meteo", target: "current" };
  const result = await turn([
    ["query_data", { topic: "meteo", question: "查 GFS 风速" }],
    ["render_chart", { ...target, renderer: "vchart" }],
    ["submit_analysis", { ...target, plan: { operation: "forecast", horizon: 3 } }],
  ], { topic: "meteo" });
  assert.equal(fixtures.output[0].profile.analysis.forecast, false);
  assert.equal(fixtures.output[1].result_id, id);
  assert.match(result.artifacts[0].options.title.text, /GFS 起报/);
  assert.equal(result.artifacts.length, 1);
  assert.match(result.summary, /日度或月度历史/);
  assert.equal(fixtures.jobs.size, 1);
});

await test("断档和留出训练样本不足在入队前被拒绝", async () => {
  for (const [days, operation, horizon, expected] of [
    [[1, 2, 3, 4, 5, 7, 8, 9, 10, 11], "forecast", 2, /只有 5 期连续观测/],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "backtest", 3, /当前最多留出 2 期/],
  ]) {
    data("power", "江苏", days);
    const result = await turn([query, ["submit_analysis", { ...selection, plan: { operation, horizon } }]]);
    assert.match(result.summary, expected);
    assert.equal(result.artifacts, undefined);
  }
  assert.equal(fixtures.jobs.size, 1);
});

await test("数据库澄清可恢复原任务，空结果不会沿用旧数据出图", async () => {
  fixtures.topics.get("power").clarifyNext = true;
  const message = "查江苏发电量然后画图";
  const pending = await turn([query, chart], { message });
  assert.match(pending.summary, /本期值还是累计值/);
  assert.equal(pending.artifacts, undefined);
  data("power", "江苏", [1, 2]);
  const result = await turn([
    ["query_data", { topic: "power", question: "本期值", resume: true }], chart,
  ], { message: "本期值" });
  assert.equal(fixtures.lastQuery.options.originalMessage, message);
  assert.match(fixtures.lastQuery.question, /补充条件：本期值/);
  assert.equal(result.artifacts[0].kind, "chart");

  data("power", "江苏", [], "day", "empty");
  const empty = await turn([query, chart]);
  assert.match(empty.summary, /没有记录/);
  assert.equal(empty.artifacts, undefined);
});
