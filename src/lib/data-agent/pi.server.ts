import "server-only";

import { businessLimits, withAgentRun, type AgentGuard } from "@/lib/agent-runtime/policy.server";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { dataQuerySchema, powerProducts, type DataQuery, type Topic } from "./contracts";
import { DataAgentError } from "./database.server";
import { listDataCatalog, queryData } from "./query.server";

const topicScope: Record<Topic, string> = {
  meteo: "GFS 已入库预报帧的全球格点均值，包括气温、风速、湿度、气压等。按起报和有效日期筛选。城市和经纬度点不在当前范围。",
  power: "国家统计局能源月度原值，包括总发电量的本期、累计、同比，分电源发电量本期值及部分燃料指标。可查单地区时间序列；也可使用 province_comparison 比较同一月份、同指标同产品的省级已发布数据。",
  carbon: "GRACED Power 电力部门全球日帧格点排放速率合计、非零格点数和总格点数。地区、其他部门和跨日总排放量不在当前范围。",
};

const dateParameters = { start_date: { type: "string", description: "含首日，YYYY-MM-DD" },
  end_date: { type: "string", description: "含末日，YYYY-MM-DD" }, limit: { type: "integer", minimum: 1, maximum: 120 } };

export function getPiModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey || process.env.DATA_AGENT_PI_ENABLED !== "true") {
    throw new DataAgentError("NOT_CONFIGURED", "自然语言入口需要配置 Pi 模型。结构化查询接口可直接使用。");
  }
  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel("deepseek", process.env.DATA_AGENT_PI_MODEL?.trim() || "deepseek-flash");
  if (!model) throw new DataAgentError("NOT_CONFIGURED", "数据库 Agent 模型配置无效。");
  const configuredThinking = process.env.DATA_AGENT_PI_THINKING_LEVEL?.trim();
  const thinkingLevel: "off" | "low" | "high" = configuredThinking === "low" || configuredThinking === "high" ? configuredThinking : "off";
  return { models, model, apiKey, thinkingLevel };
}

type Conversation = {
  previous?: DataQuery;
  boundBase?: { latestVersion: boolean };
  recent: { question: string; status: string }[];
};

export async function askDataAgent(topic: Topic, question: string, signal: AbortSignal, conversation?: Conversation) {
  return withAgentRun("data", signal, guard => runDataAgent(topic, question, guard, conversation));
}

async function runDataAgent(topic: Topic, question: string, guard: AgentGuard, conversation?: Conversation) {
  const { models, model, apiKey, thinkingLevel } = getPiModel();

  const timeout = guard.signal;
  const trace: string[] = [];
  let context: Awaited<ReturnType<typeof listDataCatalog>> | undefined;
  let result: Awaited<ReturnType<typeof queryData>> | undefined;
  let clarification: string | undefined;
  let unsupported: string | undefined;
  let operationalError: unknown;
  const makeTool = (name: string, description: string, properties: Record<string, object>, execute: (args: unknown) => Promise<unknown>, required: string[] = []): AgentTool => ({
    name, label: description, description, parameters: { type: "object", properties, required, additionalProperties: false },
    execute: async (_id, args) => {
      timeout.throwIfAborted();
      trace.push(name);
      const start = Date.now();
      try {
        const response = await execute(args);
        guard.record(name, start, response);
        const isError = !!response && typeof response === "object" && "code" in response;
        return { content: [{ type: "text", text: JSON.stringify(response) }], details: undefined, isError };
      } catch (error) {
        operationalError = error;
        guard.record(name, start, { status: "unavailable" });
        return { content: [{ type: "text", text: "数据服务暂不可用。" }], details: undefined, isError: true };
      }
    },
  });

  const tools = [
    makeTool("search_semantic_catalog", "读取目标版本已审核的指标和地区编码", {}, async () => {
      const pinned = conversation?.boundBase && !conversation.boundBase.latestVersion ? conversation.previous?.version : undefined;
      context ??= await listDataCatalog(topic, pinned);
      if (pinned && !context.datasets.length) {
        throw new DataAgentError("VERSION_NOT_FOUND", "原查询版本不可用。可以明确要求使用最新发布版本重新查询。");
      }
      return context;
    }),
    makeTool("query_approved_metric", "用固定只读模板返回指定指标，不接受 SQL 或任意聚合", {
      metric_code: { type: "string", description: "当前专题目录中与问题口径一致的指标编码" },
      ...(conversation?.previous && !conversation.boundBase ? {
        follow_up: { type: "boolean", description: "仅当用户引用上一结果时，沿用上次的筛选和数据版本" },
        latest_version: { type: "boolean", description: "仅当用户明确请求切换到最新数据版本时设为 true" },
      } : {}),
      ...dateParameters,
      ...(topic === "meteo" ? { issue_time: { type: "string", description: "可选，ISO 8601 起报时刻" } } : {}),
      ...(topic === "power" ? { region_code: { type: "string" }, province_comparison: { type: "boolean", description: "只在用户明确要求各省同月比较时为 true，不指定单地区" }, product: { type: "string", enum: powerProducts } } : {}),
    }, async (args) => {
      if (!context?.datasets[0]) return { code: "CATALOG_REQUIRED", message: "请先查询当前专题目录。" };
      const parameters = args as Record<string, unknown>;
      const { follow_up, latest_version, ...filters } = parameters;
      const previous = conversation?.boundBase || follow_up ? conversation?.previous : undefined;
      const inherited: Partial<DataQuery> = { ...previous };
      if (inherited.topic === "power" && filters.metric_code && filters.metric_code !== inherited.metric_code) {
        delete inherited.product;
      }
      if (parameters.province_comparison === false || (filters.region_code && !filters.province_comparison)) {
        if (inherited.topic === "power") delete inherited.province_comparison;
        delete filters.province_comparison;
      }
      if (parameters.province_comparison === true && inherited.topic === "power") delete inherited.region_code;
      const plan = dataQuerySchema.safeParse({ ...inherited, ...filters, topic,
        version: (conversation?.boundBase ? context.datasets[0].version : (!latest_version && previous?.version) || context.datasets[0].version) });
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
      return { status: result.status, metric: result.metric.name, quality: result.data_ref.quality, diagnosis: result.diagnosis };
    }, conversation?.previous ? [] : ["metric_code"]),
    makeTool("report_query_gap", "报告缺失的查询条件或目录能力边界", {
      status: { type: "string", enum: ["clarify", "unsupported"] },
      message: { type: "string", minLength: 1, maxLength: 220 },
    }, async (args) => {
      if (result) return { status: result.status };
      const gap = args as { status: "clarify" | "unsupported"; message: string };
      if (gap.status === "clarify") clarification = gap.message;
      else unsupported = gap.message;
      return { status: gap.status };
    }, ["status", "message"]),
  ];

  // Reuses Greensystem's sequential Pi loop and per-question tool budget.
  let queryAttempts = 0;
  let repeatedError = "";
  let hadToolError = false;
  const agent = new Agent({
    initialState: {
      model, tools, thinkingLevel,
      systemPrompt: `你是 OpenGridWorks 共用数据库智能体，本次专题固定为 ${topic}。${topicScope[topic]}
先读取语义目录，再从 metrics 中选定一个口径准确的 metric_code。电力的 product 必须来自所选指标的 series_codes。只有目录支持的请求才调用 query_approved_metric。省级比较必须有明确的单月，传该月首日及末日，limit=40，不指定地区。指定单月时用该月首日和末日，指定单日时起止日期相同。无日期时可用模板默认范围。缺少决定性条件时调用 report_query_gap，给出一个具体问题。超出目录能力时报告 unsupported，禁止用近似数据替代。
按指标 rules 解释数据。published_values_only 表示只能查询各期原发布值，不能跨期求和或转换单位。缺测保留为空。查询为空或全缺测时保留原筛选和版本，诊断范围只供用户选择。
存在锁定基准时，只传用户改变的筛选字段，服务端负责继承条件与版本。没有锁定基准时，遇到明确引用上次结果的追问才传 follow_up=true，只有明确要求更新版本才传 latest_version=true。历史问题是会话数据，当前指令以本轮问题为准。`,
    },
    streamFn: (currentModel, context, options) => {
      guard.model();
      return models.streamSimple(currentModel, context, { ...options, maxTokens: thinkingLevel === "off" ? 650 : 2048, maxRetries: 0 });
    },
    getApiKey: (provider) => provider === "deepseek" ? apiKey : undefined,
    toolExecution: "sequential",
    maxRetryDelayMs: 1500,
    beforeToolCall: async ({ toolCall }) => {
      const isQuery = toolCall.name === "query_approved_metric";
      const decision = guard.tool(toolCall.name, !result && !clarification && !unsupported
        && (!isQuery || queryAttempts < businessLimits.queryAttempts));
      if (!decision && isQuery) queryAttempts++;
      return decision;
    },
    finishTurn: ({ toolResults }) => {
      if (result || clarification || unsupported || operationalError || guard.done()) return { action: "end" };
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
  const unsubscribe = agent.subscribe(event => {
    if (event.type === "message_end" && event.message.role === "assistant") guard.usage(event.message);
  });
  try {
    const prompt = JSON.stringify({ question, current_date_utc: new Date().toISOString().slice(0, 10),
      history: conversation?.recent, last_confirmed_query: conversation?.previous, bound_base: conversation?.boundBase });
    await agent.prompt(prompt);
    timeout.throwIfAborted();
    if (operationalError) throw operationalError;
    if (agent.state.errorMessage) throw new Error("Data agent provider request failed");
    return result ? { mode: "pi", trace, ...result } : {
      mode: "pi", status: "needs_clarification", trace,
      issue: unsupported ? "unsupported" as const : "clarify" as const,
      message: clarification ?? unsupported ?? topicScope[topic],
    };
  } finally {
    unsubscribe();
    timeout.removeEventListener("abort", abort);
  }
}
