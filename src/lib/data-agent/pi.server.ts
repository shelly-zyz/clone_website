import "server-only";

import { businessLimits, withAgentRun, type AgentGuard } from "@/lib/agent-runtime/policy.server";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { cityDatasets, dataQuerySchema, powerProducts, type DataQuery, type DataTopic } from "./contracts";
import { cityNameInQuestion } from "./city-names";
import { listWeatherForecastRegions } from "@/lib/weather-model-forecast.server";
import { DataAgentError } from "./database.server";
import { listDataCatalog, listDataEntities, queryData } from "./query.server";

const topicScope: Record<DataTopic, string> = {
  meteo: "GFS 已入库预报帧的全球格点均值，包括气温、风速、湿度、气压等。用户说最新已入库 GFS 时，省略起报和日期条件，查询会选择该指标最新已发布起报；只要一个值则传 limit=1。WRF 和 ClimaX 可查已发布地区的 10 米风速。城市和经纬度点须有对应的已发布地区。",
  power: "国家统计局能源月度原值支持各省同月比较。中国城市年度发电量是研究估算，使用 city_code 查询，不作为月报或用电量。",
  carbon: "GRACED Power 提供全球电力日帧指标。中国城市年度电力部门 CO₂ 排放是研究估算，使用 city_code 查询，不是城市全行业排放。",
  economy: "世界银行 WDI 提供经济体年度现价美元 GDP 和人口。查询须指定三位经济体代码 economy_code，可通过目录核对。年度查询用当年 1 月 1 日到 12 月 31 日。不得自行换算为不变价或人均指标。",
};

const dateParameters = { start_date: { type: "string", description: "含首日，YYYY-MM-DD" },
  end_date: { type: "string", description: "含末日，YYYY-MM-DD" }, limit: { type: "integer", minimum: 1, maximum: 120 } };

export function getPiModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const missing: string[] = [];
  if (process.env.DATA_AGENT_PI_ENABLED !== "true") missing.push("DATA_AGENT_PI_ENABLED=true");
  if (!apiKey) missing.push("DEEPSEEK_API_KEY");
  if (missing.length) {
    throw new DataAgentError("NOT_CONFIGURED", `自然语言入口未启用，请在服务端配置 ${missing.join(" 和 ")}。结构化查询接口可直接使用。`);
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

export async function askDataAgent(topic: DataTopic, question: string, signal: AbortSignal, conversation?: Conversation) {
  return withAgentRun("data", signal, guard => runDataAgent(topic, question, guard, conversation));
}

async function runDataAgent(topic: DataTopic, question: string, guard: AgentGuard, conversation?: Conversation) {
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
    makeTool("search_semantic_catalog", "读取已审核指标。可同时指定数据集及要查找的地区名称或代码。", {
      dataset_id: { type: "string" }, entity_search: { type: "string", description: "城市/经济体名称、拼音或代码" },
    }, async args => {
      const pinned = conversation?.boundBase && !conversation.boundBase.latestVersion ? conversation.previous?.version : undefined;
      context ??= await listDataCatalog(topic, pinned);
      if (pinned && !context.datasets.length) {
        throw new DataAgentError("VERSION_NOT_FOUND", "原查询版本不可用。可以明确要求使用最新发布版本重新查询。");
      }
      const search = args as { dataset_id?: string; entity_search?: string };
      const match = context.datasets.find(dataset => dataset.dataset_id === search.dataset_id);
      const city = topic === "power" || topic === "carbon" ? cityNameInQuestion(question) : undefined;
      const cityDataset = city && (topic === "power" || topic === "carbon")
        ? context.datasets.find(dataset => dataset.dataset_id === cityDatasets[topic]) : undefined;
      if (match && typeof search.entity_search === "string" && search.entity_search.trim().length >= 2 &&
        search.entity_search.length <= 80) {
        const entities = await listDataEntities(topic, match.dataset_id, search.entity_search.trim(), match.version);
        if (entities.length || !cityDataset) return { ...context, entity_matches: entities };
      }
      if (city && cityDataset) {
        return { ...context, entity_dataset_id: cityDataset.dataset_id,
          entity_matches: await listDataEntities(topic, cityDataset.dataset_id, city, cityDataset.version) };
      }
      return context;
    }),
    ...(topic === "meteo" ? [
      makeTool("list_weather_forecast_regions", "读取 WRF 和 ClimaX 已发布的区域及地区编码", {}, listWeatherForecastRegions),
    ] : []),
    makeTool("query_approved_metric", "用固定只读模板返回指定指标，不接受 SQL 或任意聚合", {
      metric_code: { type: "string", description: "当前专题目录中与问题口径一致的指标编码" },
      dataset_id: { type: "string", description: "指标所属数据集编码" },
      ...(topic === "power" || topic === "carbon" ? { city_code: { type: "string", description: "城市年度指标必填，目录返回的六位城市代码" } } : {}),
      ...(topic === "economy" ? { economy_code: { type: "string", description: "目录中的三位经济体代码" } } : {}),
      ...(conversation?.previous && !conversation.boundBase ? {
        follow_up: { type: "boolean", description: "仅当用户引用上一结果时，沿用上次的筛选和数据版本" },
        latest_version: { type: "boolean", description: "仅当用户明确请求切换到最新数据版本时设为 true" },
      } : {}),
      ...dateParameters,
      ...(topic === "meteo" ? {
        issue_time: { type: "string", description: "可选，ISO 8601 起报时刻" },
        model: { type: "string", enum: ["wrf", "climax"], description: "区域预报来源，全球 GFS 不传此项" },
        region_code: { type: "string", description: "与 model 同时传，使用已发布地区编码" },
      } : {}),
      ...(topic === "power" ? { region_code: { type: "string" }, province_comparison: { type: "boolean", description: "只在用户明确要求各省同月比较时为 true，不指定单地区" }, product: { type: "string", enum: powerProducts } } : {}),
    }, async (args) => {
      if (!context?.datasets[0]) return { code: "CATALOG_REQUIRED", message: "请先查询当前专题目录。" };
      const parameters = args as Record<string, unknown>;
      const { follow_up, latest_version, ...filters } = parameters;
      const previous = conversation?.boundBase || follow_up ? conversation?.previous : undefined;
      if (previous?.topic === "meteo" && ((filters.model && filters.model !== previous.model) ||
          (filters.region_code && filters.region_code !== previous.region_code)) && conversation?.boundBase) {
        return { code: "INVALID_FILTER", message: "变更预报模型或地区需要开始新的查询。" };
      }
      const regional = topic === "meteo" && (filters.model || previous?.topic === "meteo" && previous.model);
      const changedRegionalSeries = previous?.topic === "meteo" && ((filters.model && filters.model !== previous.model) ||
        (filters.region_code && filters.region_code !== previous.region_code));
      const inherited: Partial<DataQuery> = { ...previous };
      if (inherited.topic === "power" && filters.metric_code && filters.metric_code !== inherited.metric_code) {
        delete inherited.product;
      }
      if (parameters.province_comparison === false || (filters.region_code && !filters.province_comparison)) {
        if (inherited.topic === "power") delete inherited.province_comparison;
        delete filters.province_comparison;
      }
      if (parameters.province_comparison === true && inherited.topic === "power") delete inherited.region_code;
      if (inherited.topic === "meteo" && (changedRegionalSeries || (regional && latest_version))) {
        delete inherited.issue_time;
      }
      if (regional) delete filters.dataset_id;
      const selected = context.datasets.find(dataset => filters.dataset_id === dataset.dataset_id)
        ?? context.datasets.find(dataset => dataset.metrics.some(metric => metric.metric_code === filters.metric_code))
        ?? context.datasets[0];
      const plan = dataQuerySchema.safeParse({ ...inherited, ...filters, topic,
        version: regional
          ? (!latest_version && !changedRegionalSeries ? previous?.version : undefined)
          : (conversation?.boundBase ? context.datasets[0].version
            : ((!latest_version && previous?.version && (!filters.metric_code || selected.version === previous.version)) || selected.version)),
      });
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
先读取语义目录，再从 metrics 中选定一个口径准确的 metric_code。区域气象要求先调用 list_weather_forecast_regions，选择已覆盖的模型、地区，指标填 grid_wind_speed_10m_mean。电力的 product 必须来自所选指标的 series_codes。只有目录支持的请求才调用 query_approved_metric。省级比较必须有明确的单月，传该月首日及末日，limit=40，不指定地区。指定单月时用该月首日和末日，指定单日时起止日期相同。无日期时可用模板默认范围。缺少决定性条件时调用 report_query_gap，给出一个具体问题。超出目录能力时报告 unsupported，禁止用近似数据替代。
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
