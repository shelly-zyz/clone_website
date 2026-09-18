import type { EnergyAgentHistoryItem, EnergyPlanner, EnergyPlannerDecision } from "./agent.server";
import type { DashboardQueryContext, EnergyIR } from "./schema";
// @ts-expect-error TS5097 is intentionally isolated to the runtime import used by direct Node tests.
import { SEMANTIC_CATALOG_VERSION } from "./semantic-catalog.ts";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type EnergyAgentConfig = {
  configured: boolean;
  provider: EnergyAgentProvider;
  model: string | null;
  baseUrl: string;
  timeoutMs: number;
  reason?: string;
};

export type EnergyAgentProvider = "openai" | "deepseek";

type PlannerConfig = { provider: EnergyAgentProvider; apiKey: string; model: string; baseUrl: string; timeoutMs: number };

export function readEnergyAgentConfig(environment: Record<string, string | undefined> = process.env): EnergyAgentConfig {
  const requestedProvider = environment.ENERGY_AGENT_PROVIDER?.trim().toLowerCase();
  const provider: EnergyAgentProvider = requestedProvider === "deepseek" || (!requestedProvider && environment.DEEPSEEK_API_KEY && !environment.OPENAI_API_KEY)
    ? "deepseek"
    : "openai";
  const providerIsValid = !requestedProvider || requestedProvider === "openai" || requestedProvider === "deepseek";
  const apiKey = provider === "deepseek" ? environment.DEEPSEEK_API_KEY?.trim() : environment.OPENAI_API_KEY?.trim();
  const model = environment.ENERGY_AGENT_MODEL?.trim();
  const defaultBaseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";
  const providerBaseUrl = provider === "deepseek" ? environment.DEEPSEEK_BASE_URL : environment.OPENAI_BASE_URL;
  const baseUrl = (environment.ENERGY_AGENT_BASE_URL?.trim() || providerBaseUrl?.trim() || defaultBaseUrl).replace(/\/$/, "");
  const configured = Boolean(providerIsValid && apiKey && model);
  const keyName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
  return {
    configured,
    provider,
    model: model || null,
    baseUrl,
    timeoutMs: boundedTimeout(environment.ENERGY_AGENT_TIMEOUT_MS),
    ...(configured ? {} : { reason: providerIsValid
      ? `需要同时配置${keyName}和ENERGY_AGENT_MODEL；未配置时不会把规则解析器冒充智能体。`
      : `不支持ENERGY_AGENT_PROVIDER=${requestedProvider}；只允许openai或deepseek。` }),
  };
}

export function createConfiguredEnergyPlanner(environment: Record<string, string | undefined> = process.env, fetchImpl: FetchLike = fetch) {
  const publicConfig = readEnergyAgentConfig(environment);
  const apiKey = publicConfig.provider === "deepseek" ? environment.DEEPSEEK_API_KEY?.trim() : environment.OPENAI_API_KEY?.trim();
  if (!publicConfig.configured || !apiKey || !publicConfig.model) return { config: publicConfig, planner: null };
  return {
    config: publicConfig,
    planner: new ResponsesEnergyPlanner({
      provider: publicConfig.provider,
      apiKey,
      model: publicConfig.model,
      baseUrl: publicConfig.baseUrl,
      timeoutMs: publicConfig.timeoutMs,
    }, fetchImpl),
  };
}

export class ResponsesEnergyPlanner implements EnergyPlanner {
  readonly id: string;
  readonly model: string;
  private readonly config: PlannerConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: PlannerConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.model = config.model;
    this.id = `${config.provider}-responses-energy-planner`;
  }

  async plan(input: { question: string; context: DashboardQueryContext; history: EnergyAgentHistoryItem[] }): Promise<EnergyPlannerDecision> {
    const response = await this.fetchImpl(`${this.config.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.config.timeoutMs),
      body: JSON.stringify({
        model: this.config.model,
        store: false,
        instructions: PLANNER_INSTRUCTIONS,
        input: JSON.stringify({ question: input.question, dashboardContext: input.context, recentConversation: input.history.slice(-6) }),
        max_output_tokens: 1200,
        ...(this.config.provider === "deepseek" ? { reasoning: { effort: "none" } } : {}),
        text: { format: { type: "json_schema", name: "energy_ir_planner_decision", strict: true, schema: plannerDecisionSchema } },
        prompt_cache_key: `energy-ir-${SEMANTIC_CATALOG_VERSION}`,
      }),
    });
    if (!response.ok) throw new Error(`${providerLabel(this.config.provider)} Responses API returned ${response.status}.`);
    const payload = await response.json() as {
      status?: string;
      incomplete_details?: { reason?: string } | null;
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const outputText = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!outputText) {
      const detail = payload.incomplete_details?.reason ? ` (${payload.incomplete_details.reason})` : "";
      throw new Error(`${providerLabel(this.config.provider)} Responses API returned no structured output text${detail}.`);
    }
    const decision = validatePlannerDecision(JSON.parse(outputText));
    if (decision.kind === "query" && decision.ir) decision.ir = normalizeNullableEntities(decision.ir);
    return decision;
  }
}

function providerLabel(provider: EnergyAgentProvider) {
  return provider === "deepseek" ? "DeepSeek" : "OpenAI";
}

const PLANNER_INSTRUCTIONS = `你是EnergyDataAgent的规划器，只把用户问题转换为受控EnergyIR或澄清/不可用/拒绝决定。语义目录版本${SEMANTIC_CATALOG_VERSION}。
允许指标仅有mapped_asset_count、mapped_asset_sources、dataset_quality、layer_availability、gfs_run_time、prediction_readiness。
允许数据集仅有mapped-assets、gfs、graced、vre、osm、pv-footprint；允许技术仅有solar、wind、offshore、hydro、nuclear、coal、gas、oil、geothermal。
operation只能是read，country只能是CN。不要生成SQL、表名、字段名、代码或最终业务答案。
设施数量/来源、数据时间更新缺失、图层可用覆盖可以生成query。真实15分钟预测、调度和实时省级碳强度返回unavailable。写入删除更新和自由SQL返回refused。歧义指代或时间范围返回clarification。
使用dashboardContext解析“该省”“这个图层”；没有上下文时要求澄清。query时message与reasonCode为null；其他决定时ir为null。`;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const plannerDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "ir", "message", "reasonCode"],
  properties: {
    kind: { type: "string", enum: ["query", "clarification", "unavailable", "refused"] },
    message: nullableString,
    reasonCode: nullableString,
    ir: {
      anyOf: [
        { type: "null" },
        {
          type: "object", additionalProperties: false,
          required: ["schemaVersion", "operation", "intent", "metric", "entities", "time", "groupBy", "visualization", "availabilityRequired"],
          properties: {
            schemaVersion: { type: "integer", const: 1 }, operation: { type: "string", enum: ["read"] },
            intent: { type: "string", enum: ["mapped_asset_count", "mapped_asset_sources", "dataset_quality", "layer_availability", "gfs_run_time", "prediction_readiness"] },
            metric: { type: "string", enum: ["mapped_asset_count", "mapped_asset_sources", "dataset_quality", "layer_availability", "gfs_run_time", "prediction_readiness"] },
            entities: {
              type: "object", additionalProperties: false, required: ["country", "province", "technology", "dataset", "facility"],
              properties: {
                country: { type: "string", const: "CN" }, province: nullableString, facility: nullableString,
                technology: { anyOf: [{ type: "string", enum: ["solar", "wind", "offshore", "hydro", "nuclear", "coal", "gas", "oil", "geothermal"] }, { type: "null" }] },
                dataset: { anyOf: [{ type: "string", enum: ["mapped-assets", "gfs", "graced", "vre", "osm", "pv-footprint"] }, { type: "null" }] },
              },
            },
            time: { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { type: "string", enum: ["none", "current", "latest", "range"] } } },
            groupBy: { type: "array", items: { type: "string", enum: ["source", "technology", "province"] }, maxItems: 3 },
            visualization: { type: "string", enum: ["number", "table", "status"] }, availabilityRequired: { type: "boolean" },
          },
        },
      ],
    },
  },
};

function normalizeNullableEntities(value: unknown) {
  if (!isRecord(value) || !isRecord(value.entities)) return value;
  const entities = Object.fromEntries(Object.entries(value.entities).filter(([, item]) => item !== null));
  if (typeof entities.province === "string") {
    entities.province = entities.province.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/u, "");
  }
  return { ...value, entities } as EnergyIR;
}

function validatePlannerDecision(value: unknown): EnergyPlannerDecision {
  if (!isRecord(value)) throw new Error("Energy planner returned an invalid decision envelope.");
  const allowedKinds = new Set(["query", "clarification", "unavailable", "refused"]);
  if (typeof value.kind !== "string" || !allowedKinds.has(value.kind)) {
    throw new Error("Energy planner returned an unknown decision kind.");
  }
  if (value.message !== null && typeof value.message !== "string") {
    throw new Error("Energy planner returned an invalid message.");
  }
  if (value.reasonCode !== null && typeof value.reasonCode !== "string") {
    throw new Error("Energy planner returned an invalid reason code.");
  }
  if (value.kind === "query" && !isRecord(value.ir)) {
    throw new Error("Energy planner returned a query without EnergyIR.");
  }
  if (value.kind !== "query" && value.ir !== null) {
    throw new Error("Energy planner returned EnergyIR for a non-query decision.");
  }
  return value as EnergyPlannerDecision;
}

function boundedTimeout(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(60_000, Math.max(3_000, parsed)) : 20_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
