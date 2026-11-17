import type { WorkspaceTopic } from "@/lib/globe-topics";
import type { ChartKind, DatasetProfile, DatasetRequest, Domain, FigureStyle, VisualizationJob, layouts } from "@/lib/visualization-agent/research/contracts";

export const topicDomain: Record<WorkspaceTopic, Domain> = { power: "electricity", weather: "meteorology", carbon: "carbon", economy: "economy" };
export const domainNames: Record<Domain, string> = { electricity: "电力与能源", meteorology: "气象与气候", carbon: "碳排放", economy: "经济与贸易" };
export const chartNames: Record<"auto" | ChartKind, string> = { auto: "智能推荐", trend: "趋势折线", columns: "对比柱图", rank: "分类排行",
  stack: "构成堆叠图", box: "箱线图", violin: "小提琴图", density: "密度图", scatter: "关系散点图", correlation: "相关矩阵",
  forecast: "实值与预测", "forecast-diagnostics": "预测与误差", waterfall: "瀑布图", dumbbell: "哑铃图", flow: "桑基图",
  calendar: "日历热图", grid: "空间热图", surface: "三维曲面", rose: "风向玫瑰", "trend-distribution": "趋势与分布" };
export const themeNames: Record<NonNullable<FigureStyle["theme"]>, string> = { "academic-light": "学术白底", "academic-monochrome": "学术灰度",
  "editorial-modern": "浅色青蓝", "scientific-spectrum": "科研连续色", "dashboard-glass": "灰蓝面板", "dark-analytics": "深色分析" };
export const layoutNames: Record<typeof layouts[number], string> = { auto: "自动排版", focus: "主图与副图", vertical: "上下排列",
  horizontal: "左右并排", "2x2": "两列网格", "3x2": "三列网格" };
export const economyNames = { "real-growth": "实际 GDP 增速 · WDI", gdp: "名义 GDP · WDI", "gdp-per-capita": "人均 GDP · WDI",
  exports: "商品与服务出口 · WDI", "growth-outlook": "实际 GDP 增速展望 · GEP" };
export const productNames: Record<string, string> = { electricity: "全部电源", "thermal-power": "火电", "hydro-power": "水电",
  "wind-power": "风电", "solar-power": "太阳能", "nuclear-power": "核电", "raw-coal": "原煤", "crude-oil": "原油",
  "crude-processing": "原油加工量", "natural-gas": "天然气" };

const nbs = { topic: "power", metric_code: "electricity_generation_current", region_code: "000000000000", start_date: "2024-03-01", end_date: "2025-10-31", limit: 120 } as const;
export const presets: Record<Domain, { label: string; prompt: string; datasets: DatasetRequest[] }> = {
  electricity: { label: "风电与太阳能月度发电量", prompt: "把 2024 年 3 月至 2025 年 10 月全国风电和太阳能月度发电量做成构成堆叠图。",
    datasets: [{ kind: "published", query: { ...nbs, product: "wind-power" } }, { kind: "published", query: { ...nbs, product: "solar-power" } }] },
  meteorology: { label: "GFS 温度与风速", prompt: "比较最新发布的 GFS 全球格点平均温度和 100 米风速，分开显示两种量纲。",
    datasets: [{ kind: "published", query: { topic: "meteo", metric_code: "grid_temperature_mean", limit: 120 } },
      { kind: "published", query: { topic: "meteo", metric_code: "grid_wind_speed_100m_mean", limit: 120 } }] },
  carbon: { label: "GRACED 全球排放速率", prompt: "把 2025 年 8 月 GRACED Power 全球电力部门日度排放速率画成日历热图。",
    datasets: [{ kind: "published", query: { topic: "carbon", metric_code: "global_grid_emission_rate_sum",
      start_date: "2025-08-01", end_date: "2025-08-31", limit: 120 } }] },
  economy: { label: "中国 GDP 增速与展望", prompt: "画中国 2015 年至 2025 年实际 GDP 年度增速和 2026 至 2028 年世界银行增长展望。",
    datasets: [{ kind: "economy", metric: "real-growth", country: "CHN", start_year: 2015, end_year: 2025 },
      { kind: "economy", metric: "growth-outlook", country: "CHN", start_year: 2026, end_year: 2028 }] },
};

type Example = { label: string; datasets: DatasetRequest[] };
export const examples: Record<Domain, Example[]> = {
  electricity: [presets.electricity, { label: "2025 年 12 月各省发电量", datasets: [{ kind: "published",
    query: { ...nbs, product: "electricity", province_comparison: true, start_date: "2025-12-01", end_date: "2025-12-31" } }] }],
  meteorology: [presets.meteorology, { label: "美国东南部卫星回放降水", datasets: [
    { kind: "replay-grid", id: "us-southeast-2026-09-26", field: "rain", archive: true },
  ] }],
  carbon: [presets.carbon, { label: "排放速率与非零格点数", datasets: [presets.carbon.datasets[0],
    { kind: "published", query: { topic: "carbon", metric_code: "global_grid_nonzero_cell_count",
      start_date: "2025-08-01", end_date: "2025-08-31", limit: 120 } },
  ] }],
  economy: [presets.economy, { label: "中国历史 GDP 与出口", datasets: [
    { kind: "economy", metric: "gdp", country: "CHN", start_year: 2015, end_year: 2024 },
    { kind: "economy", metric: "exports", country: "CHN", start_year: 2015, end_year: 2024 },
  ] }],
};

export const exampleRecipe = (domain: Domain, example = 0): VisualizationJob["configuration"] => ({
  domain, datasets: examples[domain][example].datasets, mode: "interactive",
});

export const chartUses: Record<ChartKind, string> = {
  stack: "看同地区、同期的不同电源发电量构成",
  columns: "对比各期或各类别的数值",
  rank: "给同一时期的地区或类别排序",
  dumbbell: "对比同一组地区在两个时期的差异",
  trend: "看连续观测的长期变化",
  box: "比较中位数、离散度和异常值",
  violin: "比较样本分布形状",
  density: "看单批或多批样本的密集区间",
  scatter: "比较两个同期且同口径的指标",
  correlation: "查看多项配对指标的相关性",
  forecast: "区分历史实值与同口径预测",
  "forecast-diagnostics": "对比实值并呈现回测误差",
  waterfall: "拆解已核对的增减贡献量",
  flow: "呈现已核对的起点、终点和流量",
  calendar: "用日期与颜色查看日度高低值",
  grid: "用经纬度和颜色呈现规则格点",
  surface: "看规则网格的三维起伏",
  rose: "呈现真实方向分组的频数或占比",
  "trend-distribution": "同时观察时间变化与样本分布",
};

export const topicCharts: Record<Domain, ChartKind[]> = {
  electricity: ["stack", "columns", "rank", "box", "scatter", "trend", "dumbbell", "forecast", "waterfall", "correlation"],
  meteorology: ["grid", "box", "columns", "correlation", "rose", "trend", "forecast", "forecast-diagnostics", "calendar"],
  carbon: ["calendar", "columns", "box", "flow", "correlation", "trend", "rank", "waterfall", "grid"],
  economy: ["forecast", "columns", "scatter", "box", "dumbbell", "trend", "correlation", "rank", "waterfall"],
};

type Shape = DatasetProfile["dimensions"]["shape"];

function dataShape(source: DatasetRequest): Shape | undefined {
  switch (source.kind) {
    case "published": return source.query.topic === "power" && source.query.province_comparison ? "category" : "time";
    case "economy": case "forecast-job": return "time";
    case "gfs-grid": case "replay-grid": return "grid";
  }
}

export function chartRequirement(kind: ChartKind, sources: DatasetRequest[], profiles?: DatasetProfile[]): string | undefined {
  const shapes = sources.map((source, index) => profiles?.[index]?.dimensions.shape ?? dataShape(source));
  const allows = (...allowed: Shape[]) => shapes.every(shape => !shape || allowed.includes(shape));
  const count = sources.length;
  const enough = (n: number) => profiles?.some(profile => profile.sample_count - profile.missing < n) !== true;
  switch (kind) {
    case "stack": {
      const power = sources.flatMap(source => source.kind === "published" && source.query.topic === "power" ? [source.query] : []);
      const knownOther = sources.some(source => source.kind !== "result" && source.kind !== "approved" &&
        (source.kind !== "published" || source.query.topic !== "power"));
      if (!allows("time") || count < 2 || knownOther || power.some(query => query.product === "electricity" || query.province_comparison ||
        query.metric_code && query.metric_code !== "electricity_generation_current") || power.length > 1 &&
        (new Set(power.map(query => query.region_code)).size > 1 ||
          power.every(query => query.product) && new Set(power.map(query => query.product)).size !== power.length)) return "选至少两种同地区的电源月度本期值，排除总量";
      break;
    }
    case "grid": case "surface": if (!allows("grid")) return "请选择经纬度网格来源"; break;
    case "flow": if (!allows("flow")) return "请选择包含起点、终点和流量的来源"; break;
    case "rank": case "rose": case "waterfall": case "dumbbell":
      if (kind === "dumbbell" && count !== 2) return "请选择两个同指标的类别截面";
      if (!allows("category")) return "请选择地区或分类截面";
      if (kind === "rose" && profiles?.some(source => !/风向|direction/i.test(source.title + source.metric_id))) return "请选择风向频数或比例";
      if (kind === "waterfall" && profiles?.some(source => !/贡献|变动|净变化|delta|contribution/i.test(source.title + source.metric_id + source.aggregation_method))) return "请选择增减贡献量";
      break;
    case "calendar":
      if (!allows("time") || profiles?.some(source => source.dimensions.time_grain !== "day") ||
        sources.some(source => source.kind === "economy" || source.kind === "published" && source.query.topic === "power")) return "请选择日度时间序列";
      break;
    case "scatter": case "correlation":
      if (kind === "scatter" && count !== 2) return "请选择两个可配对的指标";
      if (count < 2 || !allows("time")) return "请选择两个或更多可配对的时间序列";
      if (sources.every(source => source.kind === "economy")) {
        const first = sources[0];
        if (sources.some(source => source.country !== first.country || (source.metric === "growth-outlook") !== (first.metric === "growth-outlook"))) {
          return "请选择同一经济体的历史指标，或同版预测";
        }
      }
      if (profiles?.some(source => source.dimensions.time_grain !== profiles[0].dimensions.time_grain || source.is_forecast !== profiles[0].is_forecast)) {
        return "请选择同频率且观测或预测口径一致的数据";
      }
      break;
    case "forecast": case "forecast-diagnostics": {
      const prediction = sources.some(source => source.kind === "forecast-job" || source.kind === "result" || source.kind === "approved" ||
        source.kind === "economy" && source.metric === "growth-outlook" || source.kind === "published" && source.query.topic === "meteo");
      if (!allows("time") || !prediction || profiles?.every(source => !source.is_forecast)) return "请选择含预测的同口径数据";
      if (kind === "forecast-diagnostics" && !sources.some(source => ["forecast-job", "result", "approved"].includes(source.kind))) return "请选择含配对实值的回测任务";
      if (profiles?.some(source => source.metric_id !== profiles[0].metric_id || source.unit !== profiles[0].unit ||
        source.dimensions.time_grain !== profiles[0].dimensions.time_grain)) return "预测与实值需要同指标、同频率和同单位";
      break;
    }
    case "columns": if (!allows("time", "category")) return "请选择时间序列或类别截面"; break;
    case "box": case "violin": case "density": case "trend-distribution": {
      const minimum = kind === "violin" || kind === "density" ? 8 : 4;
      if (!allows("time", "category")) return "请选择数值序列或类别样本";
      if (kind === "trend-distribution" && !allows("time")) return "请选择时间序列";
      if (!enough(minimum) || sources.some(source => source.kind === "economy" && source.metric === "growth-outlook")) return "每份来源至少需要 " + minimum + " 条有效记录";
      break;
    }
    case "trend": if (!allows("time")) return "请选择连续时间序列";
  }
}

export const sourceType = (data: DatasetRequest) => data.kind === "published"
  ? ({ power: "electricity", meteo: "meteorology", carbon: "carbon" } as const)[data.query.topic] : data.kind;
export const sourceTypes = [
  ["electricity", "国家统计局 · 电力"], ["meteorology", "NOAA GFS · 全球均值"], ["carbon", "GRACED Power · 碳排放"],
  ["economy", "World Bank · 宏观经济"], ["gfs-grid", "NOAA GFS · 全球网格"], ["replay-grid", "卫星回放 · 区域网格"],
  ["result", "小云问数结果"], ["forecast-job", "预测或回测任务"], ["approved", "批准的数据归档"],
] as const;
export const newSource = (type: string): DatasetRequest => {
  if (type === "result") return { kind: "result", result_id: "" };
  if (type === "forecast-job") return { kind: "forecast-job", job_id: "" };
  if (type === "approved") return { kind: "approved", id: "" };
  if (type === "replay-grid") return { kind: "replay-grid", id: "us-southeast-2026-09-26", field: "rain", archive: true };
  if (type === "gfs-grid") return { kind: "gfs-grid", field: "temperature" };
  return presets[type as Domain].datasets[0];
};
