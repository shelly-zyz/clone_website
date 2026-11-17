import { z } from "zod";
import { chartKinds, datasetRequestSchema, domains, engines, figurePatchSchema, layouts, styleSchema, themes,
  type ChartKind, type Domain, type Engine } from "./contracts";

export const domainTools = {
  electricity: ["prepare_timeseries", "compare_forecasts", "analyze_market_prices", "analyze_generation_mix", "visualize_market_results"],
  meteorology: ["prepare_timeseries", "prepare_spatial_field", "analyze_precipitation", "analyze_wind_field", "compare_forecasts"],
  carbon: ["prepare_emission_series", "harmonize_emission_units", "analyze_sector_structure", "compare_scenarios", "visualize_emission_flow"],
  economy: ["prepare_macro_series", "harmonize_frequency", "compare_forecasts", "analyze_growth_contribution", "visualize_macro_scenarios"],
} as const satisfies Record<Domain, readonly string[]>;

type Stage = "orchestration" | "domain" | "layout" | "engine" | "theme" | "review";
type Scope = Domain | "shared";
const profile = z.object({ dataset_id: z.string(), metric_id: z.string(), unit: z.string(), source_version: z.string(),
  digest: z.string(), sample_count: z.number(), missing: z.number(), query: datasetRequestSchema });
const schemas: Record<Stage, { input: z.ZodType; output: z.ZodType }> = {
  orchestration: {
    input: z.object({ message: z.string(), default_domain: z.enum(domains), prior: z.object({ configuration: figurePatchSchema }).optional() }),
    output: z.object({ status: z.enum(["ready", "clarify", "data_gap"]), patch: figurePatchSchema.optional(), explanation: z.string().optional() }),
  },
  domain: {
    input: z.object({ datasets: z.array(datasetRequestSchema).min(1).max(6), target_unit: z.string().optional(), target_frequency: z.string().optional() }),
    output: z.object({ status: z.literal("ok"), datasets: z.array(profile), recommended_chart: z.enum(chartKinds).nullable(),
      statistics: z.array(z.object({ index: z.number(), unit: z.string(), min: z.number(), max: z.number(), valid: z.number(), missing: z.number() })),
      transformations: z.array(z.string()) }),
  },
  layout: {
    input: figurePatchSchema,
    output: z.object({ chart: z.enum(chartKinds), layout: z.enum(layouts), fields: z.array(z.string()), datasets: z.array(profile) }),
  },
  engine: {
    input: z.object({ model: z.object({ title: z.string(), columns: z.number(), panels: z.array(z.object({ kind: z.enum(chartKinds) })) }),
      plan: z.object({ engine: z.enum(engines) }) }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("echarts"), option: z.record(z.string(), z.unknown()) }),
      z.object({ kind: z.literal("image"), format: z.literal("svg"), base64: z.string() }),
    ]),
  },
  theme: {
    input: styleSchema,
    output: z.object({ theme: z.enum(themes), background: z.string(), foreground: z.string(), colors: z.array(z.string()),
      continuous: z.array(z.string()), diverging: z.array(z.string()) }),
  },
  review: {
    input: z.object({ datasets: z.array(profile) }),
    output: z.object({ status: z.literal("valid"), checks: z.array(z.object({ id: z.string(), detail: z.string() })), warnings: z.array(z.string()) }),
  },
};

function entry(skill_id: string, domain: Scope, stage: Stage, priority: number, capabilities: readonly string[],
  triggers: readonly string[], required_tools: readonly string[], constraints: readonly string[], fallback: string) {
  const schema = schemas[stage];
  return { skill_id, domain, stage, priority, capabilities, triggers, required_tools, constraints, version: "1.0.0", fallback,
    input_schema: z.toJSONSchema(schema.input), output_schema: z.toJSONSchema(schema.output) };
}

const fieldSkills = {
  electricity: entry("electricity-visualization", "electricity", "domain", 80, ["月度电量", "电源构成", "负荷与市场数据的口径检查"],
    ["功率", "负荷", "发电", "电价", "成交", "弃电", "结算", "储能"], domainTools.electricity.map(tool => "electricity." + tool),
    ["区分 MW 和 MWh", "区分累计、同比、结算窗口"], "缺少发布口径时报告情报空白"),
  meteorology: entry("meteorology-visualization", "meteorology", "domain", 80, ["气象序列", "风场", "降水与规则网格"],
    ["气温", "温度", "降水", "风速", "风向", "湿度", "气压", "GFS", "GRIB", "NetCDF", "雷达"], domainTools.meteorology.map(tool => "meteorology." + tool),
    ["UTC 起报与有效时刻分开", "遮罩缺测并保留 WGS84 坐标", "瞬时降水率与累计量分开"], "返回具体缺失网格或时效"),
  carbon: entry("carbon-visualization", "carbon", "domain", 80, ["GRACED 速率", "排放范围检查", "情景与流量守恒"],
    ["碳排放", "排放", "减排", "CO₂", "CO2", "GRACED", "Scope"], domainTools.carbon.map(tool => "carbon." + tool),
    ["速率不是总量", "分开 CO₂、CO₂e 和碳质量", "范围重叠时拒绝相加"], "提示缺少可比行业或情景"),
  economy: entry("economy-visualization", "economy", "domain", 80, ["经济快照", "历史与预测口径", "版本比较"],
    ["经济", "GDP", "物价", "CPI", "PPI", "投资", "贸易", "出口", "增长展望"], domainTools.economy.map(tool => "economy." + tool),
    ["名义/实际值、频率和基期分开", "历史及展望版次可追溯"], "报告缺少的指标、经济体或历史版本"),
};

const orchestrator = entry("visualization-orchestrator", "shared", "orchestration", 90, ["推断意图", "选择领域", "规划与失败处理"],
  ["绘图", "从已发布数据生成图件", "修改已有图件"], ["viz.list_capabilities", "viz.profile_dataset", "viz.create_plan"],
  ["只提交数据引用与图表计划"], "提示缺失条件并复用已有图件");
const author = {
  flint: entry("flint-chart-author", "shared", "engine", 50, ["Flint 语义规范与编译"], ["主引擎为 Flint"], ["validate_chart", "compile_chart"],
    ["编译到一个 ECharts 配置", "关闭文件引用"], "提示兼容性，可显式改用 ECharts"),
  matplotlib: entry("academic-figure", "shared", "engine", 50, ["印刷尺寸", "统计图型", "多面板论文排版"],
    ["主引擎为 Matplotlib"], ["viz.render_scientific"], ["白底与矢量交付", "固定绘图程序"], "提示缺少运行环境"),
  echarts: entry("scientific-chart-design", "shared", "layout", 50, ["多面板布局", "原创可视配方"],
    ["需要科研画布"], ["viz.render_interactive"], ["保持统计结构，面板用各自单位"], "输出受支持的布局候选"),
};
const theming = entry("chart-theme-designer", "shared", "theme", 30, ["主题令牌", "视觉可访问性"],
  ["所有科研图件"], ["viz.create_plan"], ["仅设置当前图件样式"], "使用可读的图件主题");
const review = entry("chart-quality-reviewer", "shared", "review", 100, ["数据、统计、视觉和可复现性校验"],
  ["任何图件生成、编辑、导出"], ["viz.validate_chart"], ["错误阻断正式成果"], "返回可操作的校验错误");
export const skillRegistry = [orchestrator, ...Object.values(fieldSkills), author.echarts, author.flint, author.matplotlib, theming, review];

export function skillsFor(active: readonly Domain[], engine?: Engine) {
  const chosen = [orchestrator, ...domains.filter(domain => active.includes(domain)).map(domain => fieldSkills[domain])];
  if (!engine) return chosen;
  const authoring = engine === "flint" || engine === "matplotlib" ? [author[engine]] : [];
  return [...chosen, author.echarts, ...authoring, theming, review];
}

export function domainsForMessage(message: string, fallback: Domain) {
  const detected = domains.filter(domain => fieldSkills[domain].triggers.some(trigger => message.toLowerCase().includes(trigger.toLowerCase())));
  return detected.length ? detected : [fallback];
}

export const engineCharts: Record<Engine, readonly ChartKind[]> = {
  echarts: ["trend", "columns", "rank", "stack", "box", "scatter", "correlation", "forecast", "forecast-diagnostics",
    "waterfall", "dumbbell", "flow", "calendar", "grid", "rose", "trend-distribution", "horizontal-bars", "ring", "composition-columns"],
  flint: ["trend", "columns"],
  matplotlib: ["trend", "columns", "rank", "stack", "box", "violin", "density", "scatter", "correlation", "forecast",
    "forecast-diagnostics", "waterfall", "dumbbell", "grid", "rose", "trend-distribution"],
  plotly: ["surface"],
};
