import type { WorkspaceTopic } from "@/lib/globe-topics";
import type { ChartKind, DatasetRequest, Domain, FigureStyle, VisualizationJob, layouts } from "@/lib/visualization-agent/research/contracts";

export const topicDomain: Record<WorkspaceTopic, Domain> = { power: "electricity", weather: "meteorology", carbon: "carbon", economy: "economy" };
export const domainNames: Record<Domain, string> = { electricity: "电力", meteorology: "气象", carbon: "碳排放", economy: "经济" };
export const chartNames: Record<"auto" | ChartKind, string> = { auto: "智能推荐", trend: "趋势折线", columns: "柱状图", rank: "排序条形",
  stack: "堆叠面积", box: "箱线图", violin: "小提琴图", density: "密度图", scatter: "散点图", correlation: "相关矩阵",
  forecast: "实值与预测", "forecast-diagnostics": "预测与误差", waterfall: "瀑布图", dumbbell: "哑铃图", flow: "桑基图",
  calendar: "日历热图", grid: "空间网格", surface: "三维曲面", rose: "风向玫瑰", "trend-distribution": "趋势与分布" };
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
  electricity: { label: "风电与太阳能月度发电量", prompt: "对比 2024 年 3 月至 2025 年 10 月全国风电和太阳能月度发电量，用浅色趋势图。",
    datasets: [{ kind: "published", query: { ...nbs, product: "wind-power" } }, { kind: "published", query: { ...nbs, product: "solar-power" } }] },
  meteorology: { label: "GFS 温度与风速", prompt: "比较最新发布的 GFS 全球格点平均温度和 100 米风速，分开显示两种量纲。",
    datasets: [{ kind: "published", query: { topic: "meteo", metric_code: "grid_temperature_mean", limit: 120 } },
      { kind: "published", query: { topic: "meteo", metric_code: "grid_wind_speed_100m_mean", limit: 120 } }] },
  carbon: { label: "GRACED 全球排放速率", prompt: "画 2025 年 8 月 GRACED Power 全球电力部门格点排放速率的日度趋势。",
    datasets: [{ kind: "published", query: { topic: "carbon", metric_code: "global_grid_emission_rate_sum",
      start_date: "2025-08-01", end_date: "2025-08-31", limit: 120 } }] },
  economy: { label: "中国 GDP 增速与展望", prompt: "画中国 2015 年至 2025 年实际 GDP 年度增速和 2026 至 2028 年世界银行增长展望。",
    datasets: [{ kind: "economy", metric: "real-growth", country: "CHN", start_year: 2015, end_year: 2025 },
      { kind: "economy", metric: "growth-outlook", country: "CHN", start_year: 2026, end_year: 2028 }] },
};

export const exampleRecipe = (domain: Domain): VisualizationJob["configuration"] => ({
  datasets: presets[domain].datasets, mode: "interactive",
  kind: domain === "meteorology" ? "trend" : "auto",
});

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
