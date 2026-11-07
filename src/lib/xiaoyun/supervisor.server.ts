import "server-only";

import { Agent } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { topicSchema, type Topic } from "@/lib/data-agent/contracts";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { askMapAssistant } from "@/lib/data-agent/map-assistant.server";
import { getPiModel } from "@/lib/data-agent/pi.server";
import {
  askDataSession, createDataProject, createDataSession, readDataSession, resolveDataResult,
} from "@/lib/data-agent/state.server";
import type { XiaoyunReply, XiaoyunRequest, XiaoyunSession } from "./contracts";

const topicNames = { power: "电源地球", meteo: "气象地球", carbon: "碳排放地球" } as const;
const intentSchema = z.strictObject({
  route: z.enum(["data", "general", "sources", "clarify"]),
  topic: topicSchema,
});
let activeRoutes = 0;

async function routeQuestion(input: XiaoyunRequest, signal: AbortSignal) {
  const { message, topic, context } = input;
  const previousTopic = context.lastTopic ?? topic;
  const normalized = message.replace(/[，。！？,.!?\s]/g, "");
  if (/^(请)?(展示|显示|查看|给我看|告诉我)(一下)?(刚才|上一条|上一个|这个|这组)?的?(数据)?来源$/.test(normalized)) {
    return { route: "sources", topic: previousTopic } as const;
  }

  if (activeRoutes >= 4) throw new DataAgentError("BUSY", "小云正在处理其他请求，请稍后重试。");
  const { models, model, apiKey } = getPiModel();
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  let decision: z.infer<typeof intentSchema> | undefined;
  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: "off",
      systemPrompt: [
        "你是 OpenGridWorks 小云的任务分派总管。只调用 select_intent，一次。不要生成答案。",
        "data：用户需要真实的发电、气象、碳排放数据，或修改刚才问数的范围。追问如“换成湖北”应沿用上次数据专题。",
        "general：概念、图层、地图操作说明、指标口径、问候，或查询有哪些公开数据。不要把具体观测值分到 general。",
        "sources：用户希望查看上一条查询的实际来源。clarify：意图不明确或要求当前未接入的绘图、预测、写入等任务。",
        "topic 使用用户明确指定的专题或指标所属专题，其次使用追问对应的上次专题，否则使用当前地球。",
      ].join("\n"),
      tools: [{
        name: "select_intent",
        label: "分派小云任务",
        description: "选择一个业务入口和专题",
        parameters: {
          type: "object", additionalProperties: false, required: ["route", "topic"],
          properties: {
            route: { type: "string", enum: ["data", "general", "sources", "clarify"] },
            topic: { type: "string", enum: ["power", "meteo", "carbon"] },
          },
        },
        execute: async (_id, args) => {
          decision ??= intentSchema.parse(args);
          return { content: [{ type: "text", text: "已选择入口" }], details: undefined };
        },
      }],
    },
    streamFn: (currentModel, context, options) => models.streamSimple(currentModel, context, {
      ...options, maxTokens: 180, maxRetries: 0,
    }),
    getApiKey: (provider) => provider === "deepseek" ? apiKey : undefined,
    finishTurn: () => ({ action: "end" }),
  });
  const abort = () => agent.abort();
  timeout.throwIfAborted();
  timeout.addEventListener("abort", abort, { once: true });
  activeRoutes += 1;
  try {
    await agent.prompt(JSON.stringify({
      message, activeTopic: topic, lastDataTopic: context.lastTopic,
    }));
    timeout.throwIfAborted();
    if (agent.state.errorMessage) throw new Error("Xiaoyun router provider failed");
    return decision ?? { route: "clarify", topic };
  } finally {
    activeRoutes -= 1;
    timeout.removeEventListener("abort", abort);
  }
}

async function createSession(topic: Topic): Promise<XiaoyunSession> {
  const project = await createDataProject(topic, `小云 · ${topicNames[topic]}`);
  const session = await createDataSession(project.project_id, project.project_key);
  return { project_id: project.project_id, project_key: project.project_key, session_id: session.session_id };
}

type Result = Awaited<ReturnType<typeof resolveDataResult>>;

function plainMarkdown(text: string) {
  return text.replace(/[\\`*_{}\[\]<>|]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

function resultSources(result: Result) {
  return [...new Set(result.rows.flatMap(({ source_ref }) =>
    typeof source_ref.url === "string" && /^https:\/\/[^\s]+$/.test(source_ref.url) ? [source_ref.url] : []))]
    .slice(0, 8)
    .map((url) => ({ url, title: result.metric.source_name, fetchedAt: new Date().toISOString() }));
}

function describeResult(result: Result, resultId: string | null, route: "data" | "sources"): XiaoyunReply {
  const { metric, rows, data_ref } = result;
  const formatTime = (date: string) => metric.time_grain === "month" ? date.slice(0, 7)
    : metric.time_grain === "forecast_frame" ? date.replace("T", " ").slice(0, 16) + " UTC" : date.slice(0, 10);
  const location = rows[0]?.source_ref.region_name;
  const heading = `${typeof location === "string" ? location : ""}${metric.name}`;
  const source = `数据来自${metric.source_name}，版本为 ${data_ref.version.slice(0, 12)}。`;
  const first = rows[0];
  const summary = route === "sources" ? `上一条结果的${source}`
    : result.status === "empty" ? `${heading}在所选范围内没有记录。`
      : rows.length === 1 && first.value !== null ? `${formatTime(first.time_start)}，${heading}为 ${first.value} ${metric.unit}。`
        : `${heading}返回 ${rows.length} 条记录${data_ref.quality.missing_rows ? `，查询范围内有 ${data_ref.quality.missing_rows} 条缺测` : ""}。`;
  const preview = route === "data" && rows.length > 0
    ? rows.slice(0, 12).map((row) => `- ${formatTime(row.time_start)} · ${row.value ?? "缺测"} ${plainMarkdown(metric.unit)}`)
    : [];
  return {
    route, summary,
    markdown: [`**${plainMarkdown(heading)}**`, ...preview, plainMarkdown(source), plainMarkdown(metric.definition)].join("\n\n"),
    sources: resultSources(result),
    data: { result_id: resultId, data_ref, query: result.query },
  };
}

export async function askXiaoyun(input: XiaoyunRequest, signal: AbortSignal): Promise<XiaoyunReply> {
  const { context, message } = input;
  const { route, topic } = await routeQuestion(input, signal);
  signal.throwIfAborted();
  if (route === "general") {
    const reply = await askMapAssistant(message, context.threadId ?? null, signal);
    const firstParagraph = reply.answer.split(/\n\s*\n/, 1)[0];
    const summary = firstParagraph.replace(/[*_`#]/g, "");
    return { route, summary, markdown: reply.answer !== summary ? reply.answer : undefined, threadId: reply.threadId };
  }
  if (route === "clarify") {
    return { route, summary: "请告诉我你想查哪个指标、了解什么口径，或操作哪一项地图功能。当前小云支持页面指令、项目问数和通用问答。" };
  }
  const existing = context.sessions?.[topic];
  if (route === "sources" && !existing) {
    return { route, summary: "当前会话还没有可查看来源的查询结果。请先告诉我要查哪项数据。" };
  }
  const scope = existing ?? await createSession(topic);
  if (route === "sources") {
    const current = await readDataSession(scope.project_id, scope.session_id, scope.project_key);
    if (current.topic !== topic) throw new DataAgentError("SESSION_CONFLICT", "问数会话与地球专题不一致。");
    if (!current.last_result_id) return { route, summary: "当前会话还没有可查看来源的查询结果。" };
    const result = await resolveDataResult(scope.project_id, current.last_result_id, scope.project_key);
    return describeResult(result, current.last_result_id, route);
  }
  const result = await askDataSession(topic, message, scope, scope.project_key, signal);
  const reply = "data_ref" in result
    ? { ...describeResult(result, result.result_id, "data"), lastTopic: topic }
    : { route: "clarify" as const, summary: result.message };
  return { ...reply, session: { topic, scope } };
}
