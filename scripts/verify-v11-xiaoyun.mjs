import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAssistantMessageEventStream, createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

const fixtures = {
  topics: new Map(), results: new Map(), sessions: new Map(), jobs: new Map(),
  steps: [], output: [], calls: [], lastQuery: undefined, capabilities: ["statsforecast", "describe", "cluster"],
};

const live = process.argv.includes("--live");
if (live && !process.env.DEEPSEEK_API_KEY?.trim()) {
  throw new Error("运行真实模型对照需要设置 DEEPSEEK_API_KEY。");
}
const baselineSource = live
  ? execFileSync("git", ["show", "a4b5b8e:src/lib/xiaoyun/supervisor.server.ts"], { encoding: "utf8" })
  : undefined;

const models = createModels();
models.setProvider(deepseekProvider());
const model = models.getModel("deepseek", (live && process.env.DATA_AGENT_PI_MODEL?.trim()) || "deepseek-flash");
assert.ok(model, "未找到配置的 DeepSeek 模型");
fixtures.pi = {
  model, apiKey: live ? process.env.DEEPSEEK_API_KEY.trim() : undefined,
  models: {
    streamSimple(currentModel, context, options) {
      fixtures.calls = context.messages.filter(message => message.role === "assistant")
        .flatMap(message => message.content.filter(item => item.type === "toolCall").map(item => item.name));
      fixtures.output = context.messages.filter(message => message.role === "toolResult")
        .map(message => JSON.parse(message.content[0].text));
      if (live) return models.streamSimple(currentModel, context, options);
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
  "@/lib/data-agent/map-assistant.server": `
    export async function readMapAssistantThread() {}
    export async function saveMapAssistantThread() { return "fixture-thread"; }`,
  "@/lib/agent-runtime/store": `
    import { randomUUID } from "node:crypto";
    const f = globalThis.xiaoyunFixture;
    export async function createAgentSession(project_id, kind, session_id = randomUUID()) {
      const existing = f.sessions.get(session_id);
      if (existing) return structuredClone(existing);
      const snapshot = { session_id, project_id, revision: 0 };
      const full = { ...snapshot, kind, recent: [], summary: {} };
      f.sessions.set(session_id, full);
      return structuredClone(full);
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
    export async function readyAnalysisCapabilities() { return f.capabilities; }
    export async function getAnalysisJob(project, id) {
      const job = f.jobs.get(id);
      if (job?.project === project) return job;
    }`,
  "@/lib/xiaoyun/pending.server": `
    import { z } from ${JSON.stringify(import.meta.resolve("zod"))};
    const f = globalThis.xiaoyunFixture;
    export const pendingAnalysisSchema = z.object({ token: z.string(), resultId: z.string(), revision: z.number(), expiresAt: z.number(), plan: z.unknown(), reason: z.string() });
    export async function updatePendingAnalysis(scope, revision, token, pending) {
      const state = f.topics.get([...f.topics].find(([, value]) => value.scope.session_id === scope.session_id)?.[0]);
      if (!state || state.data.revision !== revision || state.data.xiaoyun_analysis_pending?.token !== token) throw Error("Stale pending");
      state.data.xiaoyun_analysis_pending = structuredClone(pending);
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
      state.requests ??= new Map();
      if (options?.requestId && state.requests.has(options.requestId)) return state.requests.get(options.requestId);
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
      const result = { ...f.results.get(id), result_id: id, revision };
      if (options?.requestId) state.requests.set(options.requestId, result);
      return result;
    }
    export function createDataProject() { throw new Error("Unexpected fixture project creation"); }
    export function createDataSession() { throw new Error("Unexpected fixture session creation"); }`,
};

globalThis.xiaoyunFixture = fixtures;
const sourceRoot = new URL("../src/", import.meta.url).href;
const baselineUrl = new URL("../src/lib/xiaoyun/supervisor.server.ts?baseline", import.meta.url).href;
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
  load(url, context, nextLoad) {
    if (baselineSource && url === baselineUrl) {
      return { format: "module-typescript", source: baselineSource, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { askXiaoyun } = await import("../src/lib/xiaoyun/supervisor.server.ts");

const context = { sessions: {} };
const selection = { topic: "power", target: "current" };
const query = ["query_data", { topic: "power", question: "查江苏每日发电量" }];
const chart = ["render_chart", { ...selection, renderer: "vchart" }];
const loadSkill = ["load_skill", { name: "forecast-review" }];

function scope(topic) {
  const value = { project_id: randomUUID(), project_key: "x".repeat(43), session_id: randomUUID() };
  context.sessions[topic] = value;
  fixtures.topics.set(topic, { scope: value, data: { topic, revision: 0, last_result_id: null } });
}

function data(topic, name, days, grain = "day", status = "ok", metricName = "测试指标") {
  const id = randomUUID();
  const issue_time = grain === "forecast_frame" ? "2026-01-01T00:00:00.000Z" : null;
  const rows = days.map((day, i) => ({
    time_start: new Date(grain === "month" ? Date.UTC(2026, day - 1, 1) : Date.UTC(2026, 0, day)).toISOString(),
    issue_time, entity_code: "test", series_code: "test", value: String(i + 1), quality_flag: 0,
    source_ref: { region_name: name, url: "https://example.test/dataset" },
  }));
  const metric = { name: metricName, unit: "unit", time_grain: grain, data_identity: issue_time ? "forecast" : "official_statistics",
    source_name: "固定样例", definition: "固定指标口径" };
  const ref = { version: "v".repeat(64), dataset_id: "fixture", query_hash: id, schema: [],
    time_range: { start: rows[0]?.time_start ?? null, end: rows.at(-1)?.time_start ?? null },
    quality: { returned_rows: rows.length, matched_rows: rows.length, missing_rows: 0, truncated: false } };
  fixtures.results.set(id, { status, rows, metric, query: { topic, issue_time }, data_ref: ref });
  fixtures.topics.get(topic).nextResult = id;
  return id;
}

async function turn(steps, input = {}, ask = askXiaoyun) {
  fixtures.steps = [...steps];
  fixtures.output = [];
  fixtures.calls = [];
  const result = await ask({ message: "固定验收", topic: "power", context, ...input }, new AbortController().signal);
  if (result.session) context.sessions[result.session.topic] = result.session.scope;
  return result;
}

if (live) {
  const { askXiaoyun: askBaseline } = await import(baselineUrl);
  const cases = [
    {
      name: "已有 GFS 预报",
      topic: "meteo",
      message: "查 GFS 2026 年 1 月 1 日起报后未来三天的全球风速预报，用 VChart 画图。",
      seed: () => data("meteo", "全球", [1, 2, 3], "forecast_frame", "ok", "GFS 全球风速预报"),
      correct: result => /GFS/i.test(fixtures.lastQuery?.question ?? "") &&
        result.artifacts?.some(item => item.kind === "chart") && !fixtures.calls.includes("submit_analysis"),
    },
    {
      name: "历史风速外推",
      topic: "meteo",
      message: "用刚查到的日度历史风速预测未来三天。",
      seed: () => data("meteo", "全球", Array.from({ length: 14 }, (_, i) => i + 1), "day", "ok", "日度历史风速"),
      previous: true,
      correct: (_, id) => [...fixtures.jobs.values()].some(job =>
        job.plan.operation === "forecast" && job.plan.horizon === 3 && job.data_ref.query_hash === id),
    },
    {
      name: "十期月度数据留出三期",
      topic: "power",
      message: "用刚查到的这十期月度发电量回测最后三期。",
      seed: () => data("power", "江苏", Array.from({ length: 10 }, (_, i) => i + 1), "month", "ok", "月度发电量"),
      previous: true,
      correct: result => !fixtures.jobs.size && /2\s*期/.test(result.summary),
    },
  ];
  await test("真实模型按相同样例对照原版与技能版", async () => {
    const failures = [];
    for (const [variant, ask] of [["baseline", askBaseline], ["skill", askXiaoyun]]) {
      for (const scenario of cases) {
        for (const map of [fixtures.topics, fixtures.results, fixtures.sessions, fixtures.jobs]) map.clear();
        context.sessions = {};
        fixtures.lastQuery = undefined;
        scope(scenario.topic);
        const id = scenario.seed();
        if (scenario.previous) fixtures.topics.get(scenario.topic).data.last_result_id = id;
        try {
          const reply = await turn([], { topic: scenario.topic, message: scenario.message }, ask);
          const loaded = fixtures.output.some(item => item.name === "forecast-review" && item.instructions);
          const correct = Boolean(scenario.correct(reply, id));
          const preflightOnly = !fixtures.calls.includes("submit_analysis");
          const expectedPreflight = scenario.previous ? fixtures.output.some(item => item.preflight) : true;
          console.log(JSON.stringify({ variant, case: scenario.name, correct, loaded, preflightOnly, calls: fixtures.calls }));
          if (variant === "skill" && !(correct && loaded && expectedPreflight)) failures.push(scenario.name);
        } catch (error) {
          console.log(JSON.stringify({ variant, case: scenario.name, error: error.name }));
          failures.push(`${variant}/${scenario.name}`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });
} else {
  await test("小云按同一 DataRef 串联查数、出图、预测和来源", async () => {
    scope("power");
    const inputId = data("power", "江苏", Array.from({ length: 14 }, (_, i) => i + 1));
    const request = { ...selection, plan: { operation: "forecast", horizon: 3 } };
    const preflight = ["inspect_data", request];
    const predict = ["submit_analysis", request];
    const requestId = randomUUID();
    const result = await turn([loadSkill, query, chart, preflight, predict], { requestId });
    assert.deepEqual(result.artifacts.map(({ kind }) => kind), ["chart", "analysis"]);
    assert.equal(fixtures.output[0].name, "forecast-review");
    assert.equal(fixtures.output[2].result_id, inputId);
    assert.equal(fixtures.output[3].preflight.plan.operation, "forecast");
    assert.equal(fixtures.jobs.get(result.artifacts[1].jobId).data_ref.query_hash, inputId);
    const analysisSession = context.sessions.power.analysis.session_id;
    delete context.sessions.power.analysis;
    const replay = await turn([loadSkill, preflight, predict], { requestId });
    assert.equal(replay.artifacts[0].jobId, result.artifacts[1].jobId);
    assert.equal(context.sessions.power.analysis.session_id, analysisSession);
    assert.equal(fixtures.jobs.size, 1);
    const priorChart = result.artifacts[0].chartId;
    const hubeiId = data("power", "湖北", [1, 2, 3]);
    await turn([query, chart], { message: "查湖北并画图" });
    assert.ok(!fixtures.calls.includes("load_skill"));
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
      loadSkill,
      ["query_data", { topic: "meteo", question: "查 GFS 风速" }],
      ["render_chart", { ...target, renderer: "vchart" }],
      ["submit_analysis", { ...target, plan: { operation: "forecast", horizon: 3 } }],
    ], { topic: "meteo" });
    assert.equal(fixtures.output[1].profile.analysis.forecast, false);
    assert.equal(fixtures.output[2].result_id, id);
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
      const result = await turn([loadSkill, query, ["inspect_data", { ...selection, plan: { operation, horizon } }]]);
      assert.match(result.summary, expected);
      assert.match(fixtures.output[2].preflight.error, expected);
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

  await test("小云预测提交前要加载技能，直接检查方案不入队", async () => {
    const inputId = data("power", "江苏", Array.from({ length: 10 }, (_, i) => i + 1), "month", "ok", "月度发电量");
    const plan = { operation: "forecast", horizon: 3 };
    const result = await turn([query, ["submit_analysis", { ...selection, plan }]]);
    assert.equal(result.artifacts, undefined);
    assert.equal(fixtures.output.at(-1).status, "needs_skill");
    const inspected = await turn([loadSkill, ["inspect_data", { ...selection, plan }]]);
    assert.equal(inspected.artifacts, undefined);
    assert.equal(fixtures.output.at(-1).result_id, inputId);
    assert.equal(fixtures.output.at(-1).preflight.plan.horizon, 3);
    assert.equal(fixtures.jobs.size, 1);
  });
}

if (!live) {
  await test("预测预检记录目标；那就两期只继续同一份回测；网络重试拿到同一个任务", async () => {
    scope("power");
    fixtures.jobs.clear();
    const original = data("power", "江苏", Array.from({ length: 10 }, (_, i) => i + 1), "month");
    const state = fixtures.topics.get("power");
    state.data.last_result_id = original;
    const plan = { operation: "backtest", model: "statsforecast", horizon: 3, horizonUnit: "month" };
    const rejected = await turn([loadSkill, ["inspect_data", { ...selection, plan }]], { message: "回测最近三个月" });
    assert.match(rejected.summary, /2 期/);
    assert.equal(fixtures.jobs.size, 0);
    assert.equal(state.data.xiaoyun_analysis_pending.resultId, original);
    state.data.last_result_id = data("power", "另一份结果", [1, 2, 3]);
    const requestId = randomUUID();
    const continuation = await turn([], { requestId, message: "那就两期" });
    const job = fixtures.jobs.get(continuation.business.jobId);
    assert.equal(job.data_ref.query_hash, original);
    assert.deepEqual(job.plan, { operation: "backtest", model: "statsforecast", horizon: 2, horizonUnit: "month" });
    assert.equal(state.data.xiaoyun_analysis_pending, null);
    const replay = await turn([], { requestId, message: "那就两期" });
    assert.equal(replay.business.jobId, job.job_id);
    assert.equal(fixtures.jobs.size, 1);
  });

  await test("同一请求重试不重复执行已保存的查数和图表步骤", async () => {
    scope("power");
    data("power", "江苏", [1, 2, 3]);
    const requestId = randomUUID();
    const first = await turn([query, chart], { requestId });
    const state = fixtures.topics.get("power");
    const chartSession = context.sessions.power.visualization.session_id;
    delete context.sessions.power.visualization;
    const replay = await turn([query, chart], { requestId });
    assert.equal(replay.business.chartId, first.business.chartId);
    assert.equal(state.data.revision, 1);
    assert.equal(fixtures.sessions.get(chartSession).revision, 1);
  });

  await test("省级截面使用类别轴；预测期单位不匹配或没有 Worker 时不入队", async () => {
    scope("power");
    const id = data("power", "江苏", [1, 2], "month");
    const category = fixtures.results.get(id);
    category.data_ref.shape = "category";
    category.rows[1] = { ...category.rows[1], time_start: category.rows[0].time_start, entity_code: "330000000000", source_ref: { region_name: "浙江" } };
    const result = await turn([query, chart]);
    assert.equal(result.business.options.type, "bar");
    assert.deepEqual(result.business.options.data[0].values.map(point => point.label), ["江苏", "浙江"]);

    const next = data("power", "江苏", Array.from({ length: 12 }, (_, i) => i + 1), "month");
    fixtures.topics.get("power").data.last_result_id = next;
    const plan = { operation: "forecast", horizon: 3, horizonUnit: "day" };
    const rejected = await turn([loadSkill, ["inspect_data", { ...selection, plan }]], { message: "预测未来三天" });
    assert.match(rejected.summary, /单位不一致/);
    fixtures.capabilities = ["describe"];
    try {
      const unavailable = await turn([loadSkill, ["inspect_data", { ...selection, plan: { ...plan, horizonUnit: "month" } }]], { message: "预测未来三个月" });
      assert.match(unavailable.summary, /没有可运行/);
    } finally { fixtures.capabilities = ["statsforecast", "describe", "cluster"]; }
  });
}

if (!live) {
  await test("父子 Pi 共用运行编号和调用预算，子 Agent 无权提交分析", async () => {
    const { withAgentRun } = await import("../src/lib/agent-runtime/policy.server.ts");
    const signal = new AbortController().signal;
    const requestId = randomUUID();
    const events = [];
    const log = console.info;
    console.info = line => events.push(JSON.parse(line));
    try {
      await withAgentRun("xiaoyun", signal, async parent => {
        assert.equal(parent.tool("query_data"), undefined);
        for (let i = 0; i < 2; i++) await withAgentRun("data", parent.signal, async child => {
          assert.equal(child.tool("submit_analysis").block, true);
          for (let j = 0; j < 5; j++) assert.equal(child.tool("search_semantic_catalog"), undefined);
          assert.equal(child.tool("search_semantic_catalog").block, true);
        });
        for (let j = 0; j < 3; j++) assert.equal(parent.tool("inspect_data"), undefined);
        assert.equal(parent.tool("inspect_data").block, true);
      }, requestId);
    } finally { console.info = log; }
    const parent = events.find(event => event.actor === "xiaoyun" && event.action === "run");
    assert.ok(events.every(event => event.run_id === requestId));
    assert.ok(events.filter(event => event.actor === "data").every(event => event.parent_span_id === parent.span_id));
    assert.ok(events.some(event => event.reason === "capability"));
  });
}
