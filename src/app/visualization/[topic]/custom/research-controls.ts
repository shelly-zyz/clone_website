import type { WorkspaceTopic } from "@/lib/globe-topics";
import { chartKinds, type BusinessDataset, type ChartKind, type DataStructure, type DatasetProfile, type DatasetRequest,
  type Domain, type FigureStyle, type VisualizationJob, type layouts } from "@/lib/visualization-agent/research/contracts";
import { structureCharts } from "@/lib/visualization-agent/research/structures";

export const topicDomain: Record<WorkspaceTopic, Domain> = { power: "electricity", weather: "meteorology", carbon: "carbon", economy: "economy" };
export const domainNames: Record<Domain, string> = { electricity: "电力与能源", meteorology: "气象与气候", carbon: "碳排放", economy: "经济与贸易" };
export const chartNames: Record<"auto" | ChartKind, string> = { auto: "智能推荐", trend: "趋势折线", columns: "对比柱图", rank: "排序点图",
  "horizontal-bars": "横向条形图", ring: "双层环图", "composition-columns": "构成柱图",
  stack: "构成堆叠图", box: "箱线图", violin: "小提琴图", density: "密度图", scatter: "关系散点图", correlation: "相关矩阵",
  forecast: "实值与预测", "forecast-diagnostics": "预测与误差", waterfall: "瀑布图", dumbbell: "哑铃图", flow: "桑基图",
  calendar: "日历热图", grid: "空间热图", surface: "三维曲面", rose: "风向玫瑰", "trend-distribution": "趋势与分布" };
export const themeNames: Record<NonNullable<FigureStyle["theme"]>, string> = { "academic-light": "学术白底", "academic-monochrome": "学术灰度",
  "editorial-modern": "浅色青蓝", "scientific-spectrum": "科研连续色", "dashboard-glass": "灰蓝面板", "dark-analytics": "深色分析" };
export const layoutNames: Record<typeof layouts[number], string> = { auto: "自动排版", focus: "主图与副图", vertical: "上下排列",
  horizontal: "左右并排", "2x2": "两列网格", "3x2": "三列网格" };
export const productNames: Record<string, string> = { electricity: "全部电源", "thermal-power": "火电", "hydro-power": "水电",
  "wind-power": "风电", "solar-power": "太阳能", "nuclear-power": "核电", "raw-coal": "原煤", "crude-oil": "原油",
  "crude-processing": "原油加工量", "natural-gas": "天然气" };

export const promptExamples: Record<Domain, string> = {
  electricity: "用 2025 年 12 月各省发电量做排序点图。",
  meteorology: "把美国东南部回放的降水率画成空间热图。",
  carbon: "把 2025 年 8 月全球电力部门日度排放速率画成日历热图。",
  economy: "画中国 2015 年以来的实际 GDP 增速和世界银行增长展望。",
};

export const chartUses: Record<ChartKind, string> = {
  stack: "看同地区、同期的电源发电量构成", "composition-columns": "对比每个分项的装机量",
  columns: "对比各期或各类别的数值", rank: "用圆点和细线显示类别排名",
  "horizontal-bars": "用横条显示类别数值及排序", ring: "以全国年末总装机为分母看各电源占比",
  dumbbell: "对比同一组地区在两个时期的差异", trend: "看连续观测的长期变化", box: "比较中位数、离散度和异常值",
  violin: "比较样本分布形状", density: "看样本的密集区间", scatter: "比较两个同期且同范围的指标",
  correlation: "查看多项配对指标的相关性", forecast: "区分历史实值与同口径预测", "forecast-diagnostics": "对比实值并呈现回测误差",
  waterfall: "拆解已核对的增减贡献量", flow: "呈现已核对的起点、终点和流量",
  calendar: "用日期与颜色查看日度高低值", grid: "用经纬度和颜色呈现规则格点", surface: "看规则网格的三维起伏",
  rose: "呈现真实方向分组的频数或占比", "trend-distribution": "同时观察时间变化与样本分布",
};

export function metricId(data: DatasetRequest): string {
  switch (data.kind) {
    case "published": return "published:" + data.query.metric_code;
    case "economy": return "economy:" + data.metric;
    case "replay-grid": case "gfs-grid": return data.kind + ":" + data.field;
    default: return data.kind;
  }
}

export function datasetLabel(data: DatasetRequest, catalog: BusinessDataset[], profile?: DatasetProfile) {
  return catalog.find(item => item.id === metricId(data))?.label ?? profile?.title ??
    (data.kind === "published" ? data.query.metric_code : undefined) ??
    ({ result: "我的问数结果", "forecast-job": "预测或回测结果", approved: "已审核归档" } as Record<string, string>)[data.kind] ?? "指标";
}

const isGeneration = (data: DatasetRequest): data is Extract<DatasetRequest, { kind: "published" }> & {
  query: Extract<Extract<DatasetRequest, { kind: "published" }>["query"], { topic: "power" }>;
} => data.kind === "published" && data.query.topic === "power" &&
  (!data.query.metric_code || data.query.metric_code === "electricity_generation_current");

export const allProvinceGeneration = (data: DatasetRequest[]) => data.length > 0 && data.every(isGeneration);
export const hasCapacity = (data: DatasetRequest[]) => data.length === 1 && data[0].kind === "annual-capacity";

export function initialStructures(data: DatasetRequest[]): DataStructure[] {
  if (!data.length) return [];
  if (data.every(item => item.kind === "gfs-grid" || item.kind === "replay-grid")) return ["grid"];
  const options: DataStructure[] = ["timeline"];
  if (allProvinceGeneration(data)) options.push("categories");
  if (hasCapacity(data) || data.length > 1 && allProvinceGeneration(data)) options.push("composition");
  if (data.length > 1) options.push("relationship");
  if (data.some(item => item.kind === "forecast-job" || item.kind === "economy" && item.metric === "growth-outlook" ||
    item.kind === "published" && item.query.topic === "meteo")) options.push("forecast");
  if (data.some(item => item.kind === "approved" || item.kind === "result")) options.push("categories", "flow", "grid", "composition", "forecast");
  return [...new Set(options)];
}

export function structureDataset(data: DatasetRequest[], structure: DataStructure, month: string, year: number): DatasetRequest[] {
  return data.map(item => {
    if (item.kind === "annual-capacity") return { ...item, composition_year: structure === "composition" ? year : undefined };
    if (isGeneration(item)) {
      if (structure === "categories" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        const [year, number] = month.split("-").map(Number);
        const day = new Date(Date.UTC(year, number, 0)).getUTCDate();
        return { ...item, query: { ...item.query, province_comparison: true, region_code: "000000000000",
          start_date: month + "-01", end_date: month + "-" + day } };
      }
      return { ...item, query: { ...item.query, province_comparison: undefined } };
    }
    return item;
  });
}

export function selectedStructure(recipe: VisualizationJob["configuration"], kind: ChartKind) {
  if (recipe.structure) return recipe.structure;
  if (recipe.datasets.some(data => data.kind === "annual-capacity" && data.composition_year !== undefined)) return "composition";
  if (recipe.datasets.some(data => isGeneration(data) && data.query.province_comparison)) return "categories";
  return (Object.keys(structureCharts) as DataStructure[]).find(structure => structureCharts[structure].includes(kind));
}

export const interactiveOnly = (kind?: ChartKind) => Boolean(kind && chartKinds.includes(kind) &&
  (["calendar", "flow", "horizontal-bars", "ring", "composition-columns"] as ChartKind[]).includes(kind));
