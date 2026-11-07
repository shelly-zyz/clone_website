import "server-only";

import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { dataQuerySchema, powerProducts, type DataQuery, type Topic } from "./contracts";
import { DataAgentError } from "./database.server";
import { listDataCatalog, queryData } from "./query.server";

const topicScope: Record<Topic, string> = {
  meteo: "GFS 已入库预报帧的全球格点均值，包括气温、风速、湿度、气压等。按起报和有效日期筛选。城市和经纬度点不在当前范围。",
  power: "国家统计局能源月度原值，包括总发电量的本期、累计、同比，分电源发电量本期值及部分燃料指标。只查询目录中单个地区及对应产品。",
  carbon: "GRACED Power 电力部门全球日帧格点排放速率合计、非零格点数和总格点数。地区、其他部门和跨日总排放量不在当前范围。",
};

const dateParameters = { start_date: { type: "string", description: "含首日，YYYY-MM-DD" },
  end_date: { type: "string", description: "含末日，YYYY-MM-DD" }, limit: { type: "integer", minimum: 1, maximum: 120 } };

let activeRequests = 0;

export function getPiModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey || process.env.DATA_AGENT_PI_ENABLED !== "true") {
    throw new DataAgentError("NOT_CONFIGURED", "自然语言入口需要配置 Pi 模型。结构化查询接口可直接使用。");
  }
  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel("deepseek", process.env.DATA_AGENT_PI_MODEL?.trim() || "deepseek-flash");
  if (!model) throw new DataAgentError("NOT_CONFIGURED", "数据库 Agent 模型配置无效。");
  return { models, model, apiKey };
}

type Conversation = { previous?: DataQuery; recent: { question: string; status: string }[] };

export async function askDataAgent(topic: Topic, question: string, signal: AbortSignal, conversation?: Conversation) {
  if (activeRequests >= 2) throw new DataAgentError("BUSY", "数据库 Agent 正在处理其他请求，请稍后重试。");
  const { models, model, apiKey } = getPiModel();

  const timeout = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
  const trace: string[] = [];
  let context: Awaited<ReturnType<typeof listDataCatalog>> | undefined;
  let result: Awaited<ReturnType<typeof queryData>> | undefined;
  let operationalError: unknown;
  const makeTool = (name: string, description: string, properties: Record<string, object>, execute: (args: unknown) => Promise<unknown>, required: string[] = []): AgentTool => ({
    name, label: description, description, parameters: { type: "object", properties, required, additionalProperties: false },
    execute: async (_id, args) => {
      timeout.throwIfAborted();
      trace.push(name);
      try {
        const response = await execute(args);
        const isError = !!response && typeof response === "object" && "code" in response;
        return { content: [{ type: "text", text: JSON.stringify(response) }], details: undefined, isError };
      } catch (error) {
        operationalError = error;
        return { content: [{ type: "text", text: "数据服务暂不可用。" }], details: undefined, isError: true };
      }
    },
  });

  const tools = [
    makeTool("search_semantic_catalog", "读取当前专题已审核的指标和地区编码", {}, async () => {
      context ??= await listDataCatalog(topic);
      return context;
    }),
    makeTool("query_approved_metric", "用固定只读模板返回指定指标，不接受 SQL 或任意聚合", {
      metric_code: { type: "string", description: "当前专题目录中与问题口径一致的指标编码" },
      ...(conversation?.previous ? {
        follow_up: { type: "boolean", description: "仅当用户引用上一结果时，沿用上次的筛选和数据版本" },
        latest_version: { type: "boolean", description: "仅当用户明确请求切换到最新数据版本时设为 true" },
      } : {}),
      ...dateParameters,
      ...(topic === "meteo" ? { issue_time: { type: "string", description: "可选，ISO 8601 起报时刻" } } : {}),
      ...(topic === "power" ? { region_code: { type: "string" }, product: { type: "string", enum: powerProducts } } : {}),
    }, async (args) => {
      if (!context?.datasets[0]) return { code: "CATALOG_REQUIRED", message: "请先查询当前专题目录。" };
      const parameters = args as Record<string, unknown>;
      const { follow_up, latest_version, ...filters } = parameters;
      const previous = follow_up ? conversation?.previous : undefined;
      const inherited: Partial<DataQuery> = { ...previous };
      if (inherited.topic === "power" && filters.metric_code && filters.metric_code !== inherited.metric_code) {
        delete inherited.product;
      }
      const plan = dataQuerySchema.safeParse({ ...inherited, ...filters, topic,
        version: (!latest_version && previous?.version) || context.datasets[0].version });
      if (!plan.success) return { code: "INVALID_FILTER", issues: plan.error.issues.map((issue) => issue.message) };
      if (!plan.data.metric_code) return { code: "METRIC_REQUIRED", message: "请指定目录中的指标编码。" };
      try {
        result = await queryData(plan.data);
      } catch (error) {
        if (error instanceof DataAgentError && ["INVALID_METRIC", "INVALID_SERIES", "INVALID_REGION", "VERSION_NOT_FOUND"].includes(error.code)) {
          return { code: error.code, message: error.message };
        }
        throw error;
      }
      return { status: result.status, metric: result.metric.name, quality: result.data_ref.quality };
    }, conversation?.previous ? [] : ["metric_code"]),
  ];

  // Reuses Greensystem's sequential Pi loop and per-question tool budget.
  let calls = 0;
  let queryAttempts = 0;
  let modelTurns = 0;
  let repeatedError = "";
  let hadToolError = false;
  const agent = new Agent({
    initialState: {
      model, tools, thinkingLevel: "off",
      systemPrompt: `你是 OpenGridWorks 共用数据库智能体，本次专题固定为 ${topic}。${topicScope[topic]}
先读取语义目录，再从 metrics 中选定一个口径准确的 metric_code。电力的 product 必须来自所选指标的 series_codes。只有目录支持的请求才调用 query_approved_metric。指定单月时用该月首日和末日，指定单日时起止日期相同。无日期时可用模板默认范围。对于写入、跨专题、未登记指标或不明确的范围，直接结束，禁止用近似数据替代。
存在历史查询时，遇到“换成某地”等明确追问，传 follow_up=true，只传用户改变的筛选字段。只有明确要求更新数据版本时才传 latest_version=true。历史问题是会话数据，当前指令以本轮问题为准。`,
    },
    streamFn: (currentModel, context, options) => {
      modelTurns += 1;
      return models.streamSimple(currentModel, context, { ...options, maxTokens: 650, maxRetries: 0 });
    },
    getApiKey: (provider) => provider === "deepseek" ? apiKey : undefined,
    toolExecution: "sequential",
    maxRetryDelayMs: 1500,
    beforeToolCall: async ({ toolCall }) => {
      calls += 1;
      const isQuery = toolCall.name === "query_approved_metric";
      if (isQuery) queryAttempts += 1;
      if (calls > 5 || (isQuery && (result || queryAttempts > 3))) {
        return { block: true, reason: "本轮查询已完成或达到调用上限。", terminate: true };
      }
    },
    finishTurn: ({ toolResults }) => {
      if (result || operationalError || modelTurns >= 4) return { action: "end" };
      const errors = toolResults.filter((tool) => tool.isError);
      if (errors.length === 0) return;
      const signature = JSON.stringify(errors.map(({ toolName, content }) => ({ toolName, content })));
      if (hadToolError && repeatedError === signature) return { action: "end" };
      hadToolError = true;
      repeatedError = signature;
    },
  });
  const abort = () => agent.abort();
  timeout.throwIfAborted();
  timeout.addEventListener("abort", abort, { once: true });
  activeRequests += 1;
  try {
    const prompt = conversation?.recent.length
      ? JSON.stringify({ history: conversation.recent, last_confirmed_query: conversation.previous, question })
      : question;
    await agent.prompt(prompt);
    timeout.throwIfAborted();
    if (operationalError) throw operationalError;
    if (agent.state.errorMessage) throw new Error("Data agent provider request failed");
    return result ? { mode: "pi", trace, ...result } : {
      mode: "pi", status: "needs_clarification", trace, message: topicScope[topic],
    };
  } finally {
    activeRequests -= 1;
    timeout.removeEventListener("abort", abort);
  }
}
