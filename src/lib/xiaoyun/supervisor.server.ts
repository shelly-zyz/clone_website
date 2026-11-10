import "server-only";

import { describeQueryDiagnosis } from "@/lib/data-agent/query-diagnosis";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { currentAuditRunId, withAgentRun, type AgentGuard } from "@/lib/agent-runtime/policy.server";
import { enabledForecastModels, isForecastOperation, prepareAnalysisPlan, runAnalysisRequest } from "@/lib/analysis-agent/analysis.server";
import { readyAnalysisCapabilities } from "@/lib/agent-runtime/store";
import { planSchema, type AnalysisPlan } from "@/lib/analysis-agent/contracts";
import { topicSchema, type Topic } from "@/lib/data-agent/contracts";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { readMapAssistantThread, saveMapAssistantThread } from "@/lib/data-agent/map-assistant.server";
import { getPiModel } from "@/lib/data-agent/pi.server";
import { listDataCatalog } from "@/lib/data-agent/query.server";
import { profileDataResult, type DataResult } from "@/lib/data-agent/result-profile";
import { askDataSession, resolveDataResult } from "@/lib/data-agent/state.server";
import { chartBackends, chartTypes } from "@/lib/visualization-agent/contracts";
import { visualizeResult } from "@/lib/visualization-agent/visualization.server";
import { chartReference, createTurnContext, targets, XiaoyunContextError, type ChartReference, type Target } from "./context.server";
import type { XiaoyunBusinessResult, XiaoyunReply, XiaoyunRequest } from "./contracts";

const targetInput = { topic: topicSchema, target: z.enum(targets) };
const forecastSkill = "forecast-review";
const analysisStatuses = { queued: "排队中", running: "正在计算", succeeded: "已完成", failed: "执行失败" } as const;

const instructions = [
  "你是 OpenGridWorks 小云，负责在同一轮完成用户提出的多个相关动作。",
  "用户明确的专题优先。新问题默认当前地球。旧对象优先使用已选中的卡片，然后是相关专题的同类型对象。",
  "真实数值、新指标、新地区、新时段交给 query_data。只传查数要求。用户要求查数再画图或预测时，拿到数据后继续调用相应工具。",
  "用户只问数值时，query_data 成功后直接结束。绘图、提交分析和查来源需要用户提出相应要求。",
  "target=current 指本轮查询结果；未查新数据时指当前专题最近的查询。target=data 指之前的查询，chart 指原图输入，analysis 指上次任务输入。",
  "改图形或渲染器时用 target=chart，继承图表输入与其余设置。改地区或时段时先查数，query_data 的 base 选被修改对象。",
  "数据库返回澄清时停止依赖该查询的动作。若用户回答待澄清项，用 resume=true 恢复查数，并继续原问题要求的动作。",
  "空结果或全缺测的备选日期仅供选择。用户明确确认或给出替代日期后才 resume。不要自行扩大筛选。图表和预测维持数据库返回的口径与单位，不能把速率、累计或同比重新加总。",
  "复用旧数据前先 inspect_data。根据工具回执中的指标口径、形状、粒度、质量和候选，选择图表或分析。趋势通常用折线，数值大小比较可用柱状。",
  "各省同月排名交给 query_data 申请省级同口径比较，拿到 category 数据使用柱状图。单地区时间序列不会变成排名。空间数据仍需要已有地图能力。",
  "用户回答上一轮分析澄清时，使用 pending_analysis 指向待续办输入，保留原任务及未改条件。新的分析不使用此目标。",
  "用户指定天或月时 plan.horizonUnit 使用 day 或 month；只说多少期用 period。只要求找更准模型用 select_model，要求用更准模型预测用 forecast 且 strategy=auto，两者都不传 model。指定模型与基线对比用 compare。",
  "涉及查看已发布预报、新预测、回测、基线比较或修改预测时，先用 load_skill 读取 forecast-review，再决定路径。仅查看任务进度时直接用 get_analysis。",
  "只用工具回执中的真实数据与执行状态。概念、地图和工具能力问题可以直接用中文回答；涉及站点的数据范围时先看目录。",
].join("\n");

type Inspected = {
  id: string;
  result: DataResult;
  profile: ReturnType<typeof profileDataResult>;
  chart?: ChartReference;
};

function inheritAnalysisPlan(plan: AnalysisPlan, priorSelection: unknown) {
  const previous = planSchema.safeParse(priorSelection).data;
  return previous?.operation === plan.operation ? { ...previous, ...plan } : plan;
}

function artifactId(kind: "analysis" | "chart", project: string, requestId: string | undefined) {
  if (!requestId) return;
  const bytes = createHash("sha256").update(`xiaoyun-${kind}/${project}/${requestId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function horizonReply(text: string) {
  const match = /^(?:那就|那改成|改成|就|用)?(1[0-2]|[1-9一二两三四五六七八九十]|十一|十二)期(?:吧)?$/.exec(text);
  if (!match) return;
  const numerals = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  return match[1] === "两" ? 2 : Number(match[1]) || numerals.indexOf(match[1]);
}

function plainMarkdown(text: string) {
  return text.replace(/[\\`*_{}\[\]<>|]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

function resultSources(result: DataResult) {
  return [...new Set(result.rows.flatMap(({ source_ref }) =>
    typeof source_ref.url === "string" && /^https:\/\/[^\s]+$/.test(source_ref.url) ? [source_ref.url] : []))]
    .slice(0, 8)
    .map((url) => ({ url, title: result.metric.source_name, fetchedAt: new Date().toISOString() }));
}

function describeResult(result: DataResult, resultId: string | null, route: "data" | "sources"): XiaoyunReply {
  const { metric, rows, data_ref } = result;
  const formatTime = (date: string) => metric.time_grain === "month" ? date.slice(0, 7)
    : metric.time_grain === "forecast_frame" ? date.replace("T", " ").slice(0, 16) + " UTC" : date.slice(0, 10);
  const category = profileDataResult(result).shape === "category";
  const location = category ? "各省" : rows[0]?.source_ref.region_name;
  const heading = `${typeof location === "string" ? location : ""}${metric.name}`;
  const source = `数据来自${metric.source_name}，版本为 ${data_ref.version.slice(0, 12)}。`;
  const first = rows[0];
  const summary = route === "sources" ? `上一条结果的${source}`
    : result.diagnosis ? heading + describeQueryDiagnosis(result.diagnosis)
      : result.status === "empty" ? `${heading}在所选范围内没有记录。`
      : rows.length === 1 && first.value !== null ? `${formatTime(first.time_start)}，${heading}为 ${first.value} ${metric.unit}。`
        : `${heading}返回 ${rows.length} 条记录${data_ref.quality.missing_rows ? `，查询范围内有 ${data_ref.quality.missing_rows} 条缺测` : ""}。`;
  const preview = route === "data" && rows.length > 0
    ? rows.slice(0, 12).map((row) => `- ${category ? plainMarkdown(String(row.source_ref.region_name || row.entity_code)) : formatTime(row.time_start)} · ${row.value ?? "缺测"} ${plainMarkdown(metric.unit)}`)
    : [];
  return {
    route, summary,
    markdown: [`**${plainMarkdown(heading)}**`, ...preview, plainMarkdown(source), plainMarkdown(metric.rules?.interpretation ?? metric.definition)].join("\n\n"),
    sources: resultSources(result),
    data: { result_id: resultId, data_ref, query: result.query,
      ...(metric.rules ? { metric_rules: metric.rules } : {}), ...(result.diagnosis ? { diagnosis: result.diagnosis } : {}) },
  };
}

export async function askXiaoyun(input: XiaoyunRequest, requestSignal: AbortSignal): Promise<XiaoyunReply> {
  return withAgentRun("xiaoyun", requestSignal, async guard => ({
    ...await runXiaoyun(input, requestSignal, guard), runId: currentAuditRunId(),
  }), input.requestId);
}

async function runXiaoyun(input: XiaoyunRequest, requestSignal: AbortSignal, guard: AgentGuard): Promise<XiaoyunReply> {
  const { signal } = guard;
  const context = createTurnContext(input);
  const inspected = new Map<string, Inspected>();
  const artifacts: XiaoyunBusinessResult[] = [];
  const notes = new Map<string, string>();
  let reply: XiaoyunReply | undefined;
  let boundTopic: Topic | undefined;
  let queryAttempted = false;
  let queryUsable = false;
  let lastRoute: XiaoyunReply["lastRoute"];
  let terminal = false;
  let forecastSkillLoaded = false;

  function bind(topic: Topic) {
    if (boundTopic && boundTopic !== topic) throw new XiaoyunContextError("本轮已锁定一个专题。请分开处理不同专题的操作。");
    boundTopic = topic;
  }

  function note(key: string, message: string, status = "unsupported") {
    notes.set(key, message);
    return { status, message };
  }

  function remember(topic: Topic, target: Target, id: string, result: DataResult, chart?: ChartReference) {
    const entry = { id, result, chart, profile: profileDataResult(result) };
    inspected.set(`${topic}:${target}`, entry);
    return entry;
  }

  async function inspect(topic: Topic, target: Target) {
    const previous = inspected.get(`${topic}:${target}`);
    if (previous) return previous;
    if (queryAttempted && target === "current") {
      throw new XiaoyunContextError("本轮没有可用的新查询结果。");
    }
    const state = await context.get(topic);
    if (!state) throw new XiaoyunContextError("当前专题还没有可用的数据，请先查数。");
    const chart = target === "chart" ? chartReference(state, context.selected(topic)) : undefined;
    const pending = target === "pending_analysis" ? context.pendingAnalysis(state) : undefined;
    const id = target === "pending_analysis" ? pending?.resultId : target === "chart" ? chart?.result_id : target === "analysis" ? state.analysis?.summary.result_id : state.data.last_result_id;
    if (!id) throw new XiaoyunContextError("没有找到所引用的结果，请指定数据或先查数。");
    const result = await resolveDataResult(state.scope.project_id, id, state.scope.project_key);
    return remember(topic, target, id, result, chart);
  }

  const normalized = input.message.replace(/[，。！？,.!?\s]/g, "");
  const lookupOnly = /(?:只要|只报|仅返回)(?:数字|数值)(?:和单位)?$/.test(normalized);
  if (/^(请)?(展示|显示|查看|给我看|告诉我)(一下)?(刚才|上一条|上一个|这个|这组)?的?(数据)?来源$/.test(normalized)) {
    try {
      const topic = input.selectedChart?.topic ?? input.context.lastTopic ?? input.topic;
      const target = input.selectedChart || input.context.lastRoute === "visualization" ? "chart"
        : input.context.lastRoute === "analysis" ? "analysis" : "data";
      const entry = await inspect(topic, target);
      signal.throwIfAborted();
      return describeResult(entry.result, entry.id, "sources");
    } catch (error) {
      if (error instanceof XiaoyunContextError) return { route: "sources", summary: error.message };
      throw error;
    }
  }

  function actionable(topic: Topic, target: Target) {
    bind(topic);
    if (queryAttempted && (!queryUsable || target !== "current")) {
      throw new XiaoyunContextError("本轮出图和分析应使用刚查询的结果。");
    }
    const entry = inspected.get(`${topic}:${target}`);
    if (!entry) throw new XiaoyunContextError("请先使用 inspect_data 检查所引用的数据。");
    return entry;
  }

  function tool<T>(name: string, description: string, schema: z.ZodType<T>, run: (args: T) => Promise<object> | object): AgentTool {
    const { $schema: draft, ...parameters } = z.toJSONSchema(schema);
    void draft;
    return {
      name, label: name, description, parameters: { ...parameters, type: "object" },
      execute: async (_id, args) => {
        signal.throwIfAborted();
        const start = Date.now();
        let value: object;
        try {
          value = await run(schema.parse(args));
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof XiaoyunContextError || error instanceof DataAgentError) {
            value = note(name, error.message, error instanceof DataAgentError ? error.code : "needs_input");
          } else {
            value = note(name, "此步骤暂时无法完成。", "unavailable");
          }
        }
        if ("status" in value && ["ok", "queued", "running", "succeeded"].includes(String(value.status))) notes.delete(name);
        guard.record(name, start, value);
        return { content: [{ type: "text", text: JSON.stringify(value) }], details: undefined };
      },
    };
  }

  const tools = [
    tool("load_skill", "forecast-review 适用于查看已发布预报、历史外推、回测、基线比较和调整旧预测。", z.strictObject({
      name: z.literal(forecastSkill),
    }), async ({ name }) => {
      if (forecastSkillLoaded) return { status: "ok", name, already_loaded: true };
      const instructions = await readFile(join(process.cwd(), "src/lib/xiaoyun/skills/forecast-review/SKILL.md"), "utf8");
      forecastSkillLoaded = true;
      notes.delete("forecast_skill_required");
      return { status: "ok", name, instructions };
    }),
    tool("query_data", "让数据库 Agent 查数并保存结果。base 用于以旧结果为基准改筛选，resume 用于回答数据库的澄清。", z.strictObject({
      topic: topicSchema, question: z.string().trim().min(1).max(300),
      base: z.enum(["data", "chart", "analysis"]).optional(), latestVersion: z.boolean().optional(), resume: z.boolean().optional(),
    }), async ({ topic, question, base, latestVersion, resume }) => {
      bind(topic);
      if (queryAttempted || artifacts.length) throw new XiaoyunContextError("本轮只执行一次新的查询，且应在出图和提交分析之前执行。");
      const state = await context.get(topic, !resume && !base);
      if (!state) throw new XiaoyunContextError("当前专题没有可以继续的查询。");
      const confirmedRange = /^(好|好的|可以|同意|确认|就查这个|改查这个|按建议查)$/.test(normalized)
        ? state.pending?.suggestedRange : undefined;
      const pending = resume || confirmedRange ? state.pending : undefined;
      if (resume && !pending && !input.requestId) throw new XiaoyunContextError("没有待澄清的查询。");
      const original = base && !confirmedRange ? await inspect(topic, base) : undefined;
      const baseline = pending?.baseResultId ?? original?.id;
      queryAttempted = true;
      inspected.delete(`${topic}:current`);
      const dataQuestion = pending
        ? `${pending.question.slice(0, 290)}\n补充条件：${question.slice(0, 200)}`
        : question;
      const result = await askDataSession(topic, dataQuestion, { ...state.scope, revision: state.data.revision },
        state.scope.project_key, signal, {
          originalMessage: pending?.originalMessage ?? input.message,
          baseResultId: baseline,
          latestVersion: confirmedRange ? false : latestVersion ?? pending?.latestVersion ?? false,
          requestId: input.requestId,
          resume: resume || Boolean(confirmedRange), resumedFromPending: Boolean(pending), confirmedRange,
        });
      state.data.revision = result.revision;
      if (!("data_ref" in result) || !result.result_id) {
        const issue = "issue" in result && result.issue === "unsupported" ? "unsupported" : "needs_clarification";
        terminal = true;
        return note("query_data", ("message" in result ? result.message : undefined) ?? "请补充查询条件。", issue);
      }
      lastRoute = "data";
      reply = describeResult(result, result.result_id, "data");
      const { profile } = remember(topic, "current", result.result_id, result, original?.chart);
      queryUsable = result.status === "ok" && profile.valid > 0 && !profile.invalid;
      if (!queryUsable || lookupOnly) terminal = true;
      return { status: result.status, data_ref: result.data_ref, result_id: result.result_id, revision: result.revision,
        profile, diagnosis: result.diagnosis, chart: original?.chart?.selection,
        forecastModels: profile.analysis.forecast ? enabledForecastModels() : [] };
    }),
    tool("inspect_data", "读取目标数据及可用能力。提供 plan 时在不入队的情况下预检分析方案。", z.strictObject({
      ...targetInput, plan: planSchema.optional(),
    }),
      async ({ topic, target, plan }) => {
        const { id, profile, result, chart } = await inspect(topic, target);
        const state = await context.get(topic);
        const pending = state && target === "pending_analysis" ? context.pendingAnalysis(state) : undefined;
        const prior = pending?.plan ?? (target === "analysis" ? state?.analysis?.summary.selection : undefined);
        if (plan && pending && plan.operation !== pending.plan.operation) {
          return note("inspect_data", "请保留待续办的操作，或明确开始新任务。", "needs_input");
        }
        const inherited = plan && inheritAnalysisPlan(plan, prior);
        const ready = profile.analysis.forecast || plan ? await readyAnalysisCapabilities() : [];
        const preflight = inherited && prepareAnalysisPlan(profile, inherited, ready);
        if (preflight?.error && inherited && state && isForecastOperation(inherited.operation)) {
          bind(topic);
          notes.set("analysis_preflight", preflight.error);
          await context.savePending(state, { token: randomUUID(), revision: state.data.revision,
            resultId: id, plan: inherited, reason: preflight.error, expiresAt: Date.now() + 30 * 60_000 });
        } else if (preflight) notes.delete("analysis_preflight");
        return { status: "ok", result_id: id, data_ref: result.data_ref, profile, chart: chart?.selection,
          forecastModels: profile.analysis.forecast ? enabledForecastModels().filter(model => ready.includes(model)) : [], preflight };
      }),
    tool("render_chart", "按已检查的单指标结果生成图表。修改旧图时用 chart 目标并继承它的输入与设置。", z.strictObject({
      ...targetInput, chart: z.enum(chartTypes).optional(), renderer: z.enum(chartBackends).optional(),
    }), async ({ topic, target, chart, renderer }) => {
      const entry = actionable(topic, target);
      if (artifacts.some(result => result.kind === "chart")) throw new XiaoyunContextError("本轮图表已生成。");
      if (!entry.profile.chart) return note("render_chart", "该结果没有可绘制的有效数值。");
      const state = await context.get(topic);
      if (!state) throw new XiaoyunContextError("请先查询数据。");
      const session = await context.session(state, "visualization");
      const output = await visualizeResult({
        action: "render_session", project_id: state.scope.project_id, session_id: session.session_id, revision: session.revision,
        result_id: entry.id, instruction: input.message, chart: chart ?? entry.chart?.selection.chart ?? entry.profile.chart.default,
        renderer: renderer ?? entry.chart?.selection.renderer ?? "echarts",
      }, state.scope.project_key, signal, artifactId("chart", state.scope.project_id, input.requestId));
      if (!("status" in output) || output.status !== "ok" || !("chart_id" in output) || !output.chart_id) {
        return note("render_chart", "error" in output ? output.error ?? "暂时无法生成图表。" : "暂时无法生成图表。");
      }
      lastRoute = "visualization";
      const region = entry.profile.shape === "category" ? "各省" : entry.result.rows[0]?.source_ref.region_name;
      const title = [typeof region === "string" ? region : "", entry.result.metric.name].filter(Boolean).join(" · ");
      artifacts.push({ kind: "chart", chartId: output.chart_id, topic, title,
        renderer: output.renderer, options: output.options, version: output.data_ref.version });
      return { status: "ok", chart_id: output.chart_id, result_id: entry.id, template: output.template_id };
    }),
    tool("submit_analysis", "提交描述、聚类、预测、回测或单模型与基线对比。已入队后通过 get_analysis 看结果。", z.strictObject({
      ...targetInput, plan: planSchema,
    }), async ({ topic, target, plan }) => {
      if (isForecastOperation(plan.operation) && !forecastSkillLoaded) {
        return note("forecast_skill_required", "请先使用 load_skill 读取 forecast-review。", "needs_skill");
      }
      const entry = actionable(topic, target);
      if (artifacts.some(result => result.kind === "analysis")) throw new XiaoyunContextError("本轮已提交一项分析。");
      const state = await context.get(topic);
      if (!state) throw new XiaoyunContextError("请先查询数据。");
      const session = await context.session(state, "analysis");
      const pending = target === "pending_analysis" ? context.pendingAnalysis(state) : undefined;
      if (pending && pending.plan.operation !== plan.operation) {
        return note("submit_analysis", "请保留待续办的操作，或明确开始新任务。", "needs_input");
      }
      const inherited = inheritAnalysisPlan(plan, pending?.plan ?? (target === "analysis" ? session.summary.selection : undefined));
      const result = await runAnalysisRequest({
        action: "submit", project_id: state.scope.project_id, session_id: session.session_id, revision: session.revision,
        result_id: entry.id, plan: inherited,
      }, state.scope.project_key, signal, artifactId("analysis", state.scope.project_id, input.requestId));
      if (!("status" in result) || !("job_id" in result) || !result.job_id) {
        notes.delete("analysis_preflight");
        return note("submit_analysis", "error" in result ? result.error ?? "分析未提交。" : "分析未提交。");
      }
      notes.delete("analysis_preflight");
      if ("reused" in result) {
        state.scope = { ...state.scope, analysis: { session_id: result.session_id } };
        const previousRef = z.object({ query_hash: z.string() }).safeParse(result.data_ref).data;
        if (previousRef?.query_hash !== entry.result.data_ref.query_hash) {
          notes.set("reused_analysis", "该请求已有分析任务，仍使用首次提交的数据快照。");
        }
      }
      if (context.pendingAnalysis(state)?.resultId === entry.id) {
        try { await context.savePending(state, null); } catch (error) {
          if (!(error instanceof DataAgentError) || error.code !== "SESSION_CONFLICT") throw error;
        }
      }
      lastRoute = "analysis";
      artifacts.push({ kind: "analysis", topic, jobId: result.job_id, projectId: state.scope.project_id });
      return { status: result.status, job_id: result.job_id, plan: result.plan };
    }),
    tool("get_analysis", "读取该专题已有任务的实际状态。", z.strictObject({ topic: topicSchema }), async ({ topic }) => {
      bind(topic);
      const state = await context.get(topic);
      const current = artifacts.find(item => item.kind === "analysis");
      const jobId = current?.jobId ?? state?.analysis?.summary.job_id;
      if (!state || !jobId) return note("get_analysis", "当前专题还没有分析任务。", "empty");
      const result = await runAnalysisRequest({ action: "get_job", project_id: state.scope.project_id, job_id: jobId },
        state.scope.project_key, signal);
      if (!("status" in result) || !("job_id" in result)) return note("get_analysis", "暂时无法读取任务。");
      lastRoute = "analysis";
      if (!artifacts.some(item => item.kind === "analysis")) {
        artifacts.push({ kind: "analysis", topic, jobId, projectId: state.scope.project_id });
      }
      notes.set("analysis_status", `分析任务${analysisStatuses[result.status]}。`);
      return { status: result.status, job_id: jobId };
    }),
    tool("get_sources", "沿明确的数据、图表或分析输入引用读取真实数据来源。", z.strictObject(targetInput),
      async ({ topic, target }) => {
        bind(topic);
        const entry = await inspect(topic, target);
        const sourceReply = describeResult(entry.result, entry.id, "sources");
        if (reply?.route !== "data" || reply.data?.result_id !== entry.id) reply = sourceReply;
        return { status: "ok", data_ref: entry.result.data_ref, sources: sourceReply.sources };
      }),
    tool("list_available_datasets", "查看本站已发布数据和指标口径。", z.strictObject({ topic: topicSchema.optional() }),
      async ({ topic }) => {
        const { datasets } = await listDataCatalog(topic);
        return { status: "ok", datasets: datasets.map(({ topic, dataset_id, metrics }) => ({
          topic, dataset_id, metrics: metrics.map(({ name, unit, definition, rules }) => ({ name, unit, definition, rules })),
        })) };
      }),
    tool("utc_now", "读取当前 UTC 时间。", z.strictObject({}), () => ({ status: "ok", time: new Date().toISOString() })),
  ];

  const horizon = horizonReply(normalized);
  if (horizon && !input.selectedChart) {
    const topic = input.context.lastTopic ?? input.topic;
    const state = await context.get(topic);
    if (state && !state.pending) {
      const pending = context.pendingAnalysis(state);
      const jobId = artifactId("analysis", state.scope.project_id, input.requestId);
      const existing = jobId && await runAnalysisRequest({ action: "get_job", project_id: state.scope.project_id, job_id: jobId },
        state.scope.project_key, signal).catch(error => {
        if (!(error instanceof DataAgentError) || error.code !== "PROJECT_NOT_FOUND") throw error;
      });
      if (existing && typeof existing === "object" && "job_id" in existing && jobId) {
        const business = { kind: "analysis" as const, topic, jobId, projectId: state.scope.project_id };
        return { route: "analysis", summary: "分析任务可在结果卡查看。", business, artifacts: [business],
          session: { topic, scope: state.scope }, lastTopic: topic, lastRoute: "analysis" };
      }
      if (pending) {
        const args = { topic, target: "pending_analysis", plan: { ...pending.plan, horizon } };
        for (const [name, parameters] of [["load_skill", { name: forecastSkill }], ["inspect_data", args], ["submit_analysis", args]] as const) {
          if (name === "submit_analysis" && (notes.has("analysis_preflight") || notes.has("inspect_data"))) break;
          const registered = tools.find(tool => tool.name === name);
          if (!registered || guard.tool(name)) break;
          await registered.execute(randomUUID(), parameters, signal);
        }
        const business = artifacts.at(-1);
        return { route: business ? "analysis" : "clarify",
          summary: [...notes.values()].join(" ") || (business ? "分析任务可在结果卡查看。" : "未能继续该分析。"),
          session: { topic, scope: state.scope }, lastTopic: topic, lastRoute, business, artifacts: business ? artifacts : undefined };
      }
    }
  }

  const { models, model, apiKey, thinkingLevel = "off" } = getPiModel();
  const agent = new Agent({
    initialState: { model, tools, thinkingLevel, systemPrompt: instructions },
    streamFn: (currentModel, modelContext, options) => {
      guard.model();
      return models.streamSimple(currentModel, modelContext, { ...options, maxTokens: thinkingLevel === "off" ? 650 : 2048, maxRetries: 0 });
    },
    getApiKey: provider => provider === "deepseek" ? apiKey : undefined,
    toolExecution: "sequential",
    beforeToolCall: async ({ toolCall }) => guard.tool(toolCall.name, !terminal),
    finishTurn: () => terminal || guard.done() ? { action: "end" } : undefined,
  });

  const abort = () => agent.abort();
  signal.throwIfAborted();
  signal.addEventListener("abort", abort, { once: true });
  const unsubscribe = agent.subscribe(event => {
    if (event.type === "message_end" && event.message.role === "assistant") guard.usage(event.message);
  });
  try {
    const topics = [...new Set([input.topic, input.selectedChart?.topic, input.context.lastTopic])]
      .filter((topic): topic is Topic => Boolean(topic));
    const [references, thread] = await Promise.all([
      Promise.all(topics.map(topic => context.describe(topic))),
      readMapAssistantThread(input.context.threadId),
    ]);
    await agent.prompt(JSON.stringify({
      message: input.message, activeTopic: input.topic, previousTopic: input.context.lastTopic, references, recent: thread?.recent,
    }));
    requestSignal.throwIfAborted();
    if (agent.state.errorMessage || signal.aborted) {
      if (!reply && !artifacts.length && !notes.size) throw new Error("Xiaoyun model failed");
      notes.set("partial", "其余步骤未完成，可以根据已返回的结果继续。");
    }
    const scope = boundTopic ? (await context.get(boundTopic))?.scope : undefined;
    const messages = [reply?.summary,
      artifacts.some(item => item.kind === "chart") ? "已生成图表。" : undefined,
      artifacts.some(item => item.kind === "analysis") && !notes.has("analysis_status") ? "分析任务可在结果卡查看。" : undefined,
      ...notes.values(),
    ].filter(Boolean);
    const last = agent.state.messages.at(-1);
    const text = last?.role === "assistant" ? last.content.flatMap(item => item.type === "text" ? [item.text] : []).join("\n").trim() : "";
    const route = reply?.route === "sources" ? "sources" : lastRoute ?? (messages.length ? "clarify" : "general");
    const summary = messages.join(" ") || text.split(/\n\s*\n/, 1)[0] || "请指定想查询、绘图或分析的内容。";
    const threadId = route === "general" && text ? await saveMapAssistantThread(thread, input.message, text) : undefined;
    return {
      ...reply, route, summary,
      ...(route === "general" && text !== summary ? { markdown: text || undefined } : {}),
      ...(threadId ? { threadId } : {}),
      ...(scope && boundTopic ? { session: { topic: boundTopic, scope }, lastTopic: boundTopic } : {}),
      lastRoute,
      business: artifacts.at(-1),
      artifacts: artifacts.length ? artifacts : undefined,
    };
  } catch (error) {
    if (error instanceof XiaoyunContextError) return { route: "clarify", summary: error.message };
    throw error;
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", abort);
  }
}
