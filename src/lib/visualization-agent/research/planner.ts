import { VisualizationError, type ChartKind, type DatasetProfile, type Engine, type FigureModel, type FigurePanel,
  type FigureSeries, type Validation, type VisualizationDataContract, type VisualizationJob, type VisualizationPlan } from "./contracts";
import { engineCharts, skillsFor } from "./registry";
import { contrast, figureDesign } from "./themes";
import { figureInsights } from "./insights";
import { structureCharts } from "./structures";
import { hasEditableDrawing } from "./drawio";

export type Evidence = { data: VisualizationDataContract; profile: DatasetProfile }[];
type Recipe = VisualizationJob["configuration"];

const names: Record<ChartKind, string> = {
  trend: "趋势图", columns: "柱状图", rank: "排序图", stack: "结构堆叠图", box: "箱线图", violin: "小提琴图",
  density: "密度图", scatter: "散点图", correlation: "相关矩阵", forecast: "预测图", "forecast-diagnostics": "预测与误差",
  waterfall: "瀑布图", dumbbell: "哑铃图", flow: "桑基图", calendar: "日历热图", grid: "空间热图",
  surface: "三维网格曲面", rose: "风向玫瑰图", "trend-distribution": "趋势与分布",
  "horizontal-bars": "横向条形图", ring: "双层环图", "composition-columns": "构成柱图",
};

const incompatible = (message: string): never => { throw new VisualizationError("INCOMPATIBLE", message); };
const concise = (value: number) => Number(value.toPrecision(11));

export function quantile(sorted: number[], p: number) {
  const i = (sorted.length - 1) * p;
  return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
}
export function describeNumbers(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { valid: values.length, min: sorted[0], max: sorted.at(-1)!, mean: concise(mean), median: quantile(sorted, 0.5) };
}

function observations(data: VisualizationDataContract) {
  return data.rows.flatMap(row => row.value === null ? [] : [row.value]);
}
function sameMetric(data: VisualizationDataContract[]) {
  return data.every(item => item.metric_id === data[0].metric_id && item.unit === data[0].unit);
}

function withCalendarGaps(x: string[], grain: string) {
  if (!["day", "month", "year"].includes(grain)) return x;
  return x.flatMap((time, index) => {
    if (!index) return [time];
    const next = new Date(x[index - 1]);
    if (grain === "day") next.setUTCDate(next.getUTCDate() + 1);
    if (grain === "month") next.setUTCMonth(next.getUTCMonth() + 1);
    if (grain === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
    const boundary = next.toISOString();
    return boundary < time ? [boundary, time] : [time];
  });
}

function timeline(items: VisualizationDataContract[], title: string, kind: FigurePanel["kind"] = "trend"): FigurePanel {
  const axis = [...new Set(items.flatMap(item => item.rows.map(point => new Date(point.timestamp!).toISOString())))].sort();
  const grains = new Set(items.map(item => item.dimensions.time_grain));
  const x = grains.size === 1 ? withCalendarGaps(axis, items[0].dimensions.time_grain) : axis;
  const series: FigureSeries[] = [];
  const uniqueName = (name: string) => {
    const matches = series.filter(item => item.name === name || item.name.startsWith(name + " · 第")).length;
    return matches ? name + " · 第" + (matches + 1) + "组" : name;
  };
  for (const item of items) {
    const index = new Map(item.rows.map(point => [new Date(point.timestamp!).toISOString(), point]));
    const forecasts = item.rows.some(point => point.bounds);
    const suffix = item.is_forecast ? " · 预测" : "";
    const seriesName = item.title + suffix + (item.model_version ? " " + item.model_version : "");
    series.push({ name: uniqueName(seriesName), unit: item.unit, data: x.map(at => index.get(at)?.value ?? null), forecast: item.is_forecast,
      ...(forecasts ? { interval: x.map(at => index.get(at)?.bounds ?? null) } : {}) });
    if (item.rows.some(point => point.actual !== undefined && point.actual !== null)) {
      series.push({ name: uniqueName(item.title + " · 对照实值"), unit: item.unit, data: x.map(at => index.get(at)?.actual ?? null) });
    }
  }
  return { kind, title, x, axis: "time", time_grain: grains.size === 1 ? items[0].dimensions.time_grain : undefined, series };
}

function distribution(items: VisualizationDataContract[], kind: "box" | "violin" | "density"): FigurePanel[] {
  const unitGroups = new Map<string, VisualizationDataContract[]>();
  for (const item of items) {
    const group = unitGroups.get(item.unit) ?? [];
    group.push(item);
    unitGroups.set(item.unit, group);
    const values = observations(item);
    const minimum = kind === "box" ? 4 : 8;
    if (values.length < minimum || kind !== "box" && Math.max(...values) === Math.min(...values)) {
      incompatible(item.title + "需要至少 " + minimum + " 条有效记录" + (kind === "box" ? "。" : "且样本存在变化。"));
    }
  }
  return [...unitGroups].map(([unit, members]) => ({
    kind, title: members.length === 1 ? members[0].title + "分布" : "同单位样本分布", axis: "category", x: members.map(item => item.title),
    series: members.map(item => ({ name: item.title, unit, data: observations(item) })),
  }));
}

function category(items: VisualizationDataContract[], kind: "rank" | "horizontal-bars" | "columns" | "dumbbell" | "waterfall" | "rose"): FigurePanel[] {
  if (kind === "dumbbell") {
    if (items.length !== 2 || !items.every(item => item.dimensions.shape === "category") || !sameMetric(items)) {
      return incompatible("哑铃图需要两个同指标、同单位的类别截面。");
    }
    const right = new Map(items[1].rows.map(row => [row.region_id, row]));
    const pairs = items[0].rows.flatMap(row => {
      const value = right.get(row.region_id)?.value;
      return row.value === null || value == null ? [] : [{ label: row.label, a: row.value, b: value }];
    });
    if (!pairs.length) return incompatible("两份数据没有可匹配的有效类别。");
    return [{ kind, title: "同类别对比", axis: "category", x: pairs.map(pair => pair.label), series: items.map((item, i) =>
      ({ name: item.title + " · " + (item.observation_time.start?.slice(0, 10) ?? ""), unit: item.unit, data: pairs.map(pair => i ? pair.b : pair.a) })) }];
  }
  return items.map(item => {
    if ((kind === "rank" || kind === "horizontal-bars") && item.dimensions.shape !== "category") incompatible("排行需要可比较的类别截面。");
    if (kind === "waterfall" && (item.dimensions.shape !== "category" || !/贡献|变动|净变化|delta|contribution/i.test(item.title + item.metric_id + item.aggregation_method))) {
      incompatible("瀑布图需要已发布或已计算的增减贡献量。");
    }
    if (kind === "rose" && (item.dimensions.shape !== "category" || !/风向|direction/i.test(item.title + item.metric_id) ||
      item.rows.some(row => row.value !== null && row.value < 0))) incompatible("风向玫瑰图需要真实方向分组及非负的频数或比例。");
    if (item.dimensions.shape === "time" && kind === "columns") return timeline([item], item.title, kind);
    if (item.dimensions.shape !== "category") return incompatible("当前数据不是可用于图表的类别截面。");
    const rows = kind === "rank" || kind === "horizontal-bars" ? item.rows.toSorted((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)) : item.rows;
    return { kind, title: item.title, axis: "category", x: rows.map(row => row.label), series: [{ name: item.title, unit: item.unit, data: rows.map(row => row.value) }] };
  });
}

function scopeOf(data: VisualizationDataContract) {
  const regions = [...new Set(data.rows.map(row => row.region_id))].sort();
  return regions.map(region => region === "000000000000" ? "CHN" : region === "WLD" ? "WLT" : region).join(",");
}

function matched(items: VisualizationDataContract[]) {
  const first = items[0];
  if (!items.every(item => item.dimensions.shape === "time" && item.time_zone === first.time_zone &&
    item.dimensions.time_grain === first.dimensions.time_grain && scopeOf(item) === scopeOf(first) &&
    (item.data_type === "scenario") === (first.data_type === "scenario") &&
    item.is_forecast === first.is_forecast && (!item.is_forecast ||
      (item.forecast_origin ?? item.forecast_origin_period) === (first.forecast_origin ?? first.forecast_origin_period)))) {
    return incompatible("无法对齐这些序列。关系计算需要相同地域、时区、粒度与观测或起报口径。");
  }
  const index = items.map(item => new Map(item.rows.map(row => [new Date(row.timestamp!).toISOString(), row.value])));
  return [...index[0]].flatMap(([key]) => {
    const point = index.map(values => values.get(key));
    return point.every(value => typeof value === "number") ? [point as number[]] : [];
  });
}

function pearson(a: number[], b: number[]) {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const av = mean(a), bv = mean(b);
  let cross = 0, avar = 0, bvar = 0;
  a.forEach((value, index) => {
    const x = value - av, y = b[index] - bv;
    cross += x * y; avar += x ** 2; bvar += y ** 2;
  });
  if (avar === 0 || bvar === 0) return incompatible("相关系数需要各变量都有有效变化。");
  return concise(Math.max(-1, Math.min(1, cross / Math.sqrt(avar * bvar))));
}

function relationship(items: VisualizationDataContract[], kind: "scatter" | "correlation", stats: Record<string, number>): FigurePanel {
  if (items.length < 2 || kind === "scatter" && items.length !== 2) return incompatible("关系图需要恰当数目的独立序列。");
  const paired = matched(items);
  const minimum = kind === "scatter" ? 3 : 5;
  if (paired.length < minimum) return incompatible("匹配后的完整观测少于 " + minimum + " 期。");
  stats["配对样本"] = paired.length;
  const columns = items.map((_, index) => paired.map(row => row[index]));
  if (items.length === 2 && columns.every(values => values.some(value => value !== values[0]))) {
    stats.pearson_r = pearson(columns[0], columns[1]);
  }
  if (kind === "scatter") return { kind, title: items[0].title + "与" + items[1].title, axis: "number", x: [],
    x_unit: items[0].title + "（" + items[0].unit + "）", points: paired.map(row => [row[0], row[1]]),
    series: [{ name: items[1].title, unit: items[1].unit, data: [] }] };
  const labels = items.map(item => item.title);
  const cells = columns.flatMap((a, x) => columns.map((b, y): [number, number, number] => [x, y, pearson(a, b)]));
  return { kind, title: "Pearson 相关系数", axis: "category", x: labels, row_labels: labels, cells,
    series: [{ name: "Pearson r", unit: "r", data: [] }] };
}

function flows(item: VisualizationDataContract): FigurePanel {
  if (item.dimensions.shape !== "flow") return incompatible("桑基图需要带起点、终点和流量的已发布关系表。");
  const links = item.rows.map(row => ({ source: row.label, target: row.target!, value: row.value! }));
  const totals = new Map<string, { outgoing: number; incoming: number; targets: string[] }>();
  function node(name: string) {
    const total = totals.get(name) ?? { outgoing: 0, incoming: 0, targets: [] };
    totals.set(name, total);
    return total;
  }
  const ordered = new Set<string>(), visiting = new Set<string>();
  function visit(name: string) {
    if (visiting.has(name)) incompatible("流向包含循环，无法用当前桑基配方解释。");
    if (ordered.has(name)) return;
    visiting.add(name);
    totals.get(name)?.targets.forEach(visit);
    visiting.delete(name);
    ordered.add(name);
  }
  if (links.length > 150) incompatible("桑基图最多呈现 150 条已核对的流向。");
  for (const link of links) {
    const source = node(link.source);
    source.targets.push(link.target);
    source.outgoing += link.value;
    node(link.target).incoming += link.value;
  }
  for (const [name, node] of totals) {
    if (node.incoming && node.outgoing && Math.abs(node.incoming - node.outgoing) > Math.max(node.incoming, node.outgoing) * 1e-6) {
      incompatible(name + "的流入与流出不守恒。");
    }
    visit(name);
  }
  return { kind: "flow", title: item.title, x: [], axis: "category", links, series: [{ name: item.title, unit: item.unit, data: [] }] };
}

function spatial(item: VisualizationDataContract): FigurePanel {
  if (item.dimensions.shape !== "grid" || !item.grid || item.rows.length !== item.grid.lon.length * item.grid.lat.length) {
    return incompatible("空间图需要坐标完整的矩形规则网格及原始缺测掩码。");
  }
  const { lon, lat } = item.grid;
  const regular = (axis: number[]) => {
    const step = axis[1] - axis[0];
    return Math.abs(step) > 0 && axis.slice(1).every((value, i) => Math.abs(value - axis[i] - step) < Math.abs(step) * 1e-6);
  };
  if (!regular(lon) || !regular(lat)) incompatible("空间图需要经纬度方向上等距且唯一的坐标。");
  const longitude = new Map(lon.map((x, index) => [x, index]));
  const latitude = new Map(lat.map((y, index) => [y, index]));
  const cells = item.rows.flatMap(row => {
    const x = longitude.get(row.coordinates?.[0] ?? NaN), y = latitude.get(row.coordinates?.[1] ?? NaN);
    if (x === undefined || y === undefined) return incompatible("格点位置超出声明坐标。");
    return row.value === null ? [] : [[x, y, row.value] as [number, number, number]];
  });
  return { kind: "grid", title: item.title, axis: "category", x: lon.map(String), row_labels: lat.map(String), cells,
    series: [{ name: item.title, unit: item.unit, data: [] }] };
}

function forecastPanels(data: VisualizationDataContract[], chart: "forecast" | "forecast-diagnostics", stats: Record<string, number>) {
  const first = data[0];
  const predictions = data.filter(item => item.is_forecast);
  if (!predictions.length || !data.every(item => item.dimensions.shape === "time" && item.unit === first.unit &&
    item.metric_id === first.metric_id && item.dimensions.time_grain === first.dimensions.time_grain && scopeOf(item) === scopeOf(first))) {
    return incompatible("预测图需要同一指标、范围、频率和单位的预测与可比历史序列。");
  }
  const panels = [timeline(data, "实值与预测", "forecast")];
  if (chart === "forecast") return panels;
  const estimates = predictions.flatMap((item, index) => {
    const values = item.rows.flatMap(row => row.actual == null || row.value === null ? [] : [row.value - row.actual]);
    const time = item.rows.flatMap(row => row.actual == null || row.value === null ? [] : [row.timestamp!]);
    if (!values.length) return [];
    const model = item.model_id ?? item.title;
    const name = predictions.length === 1 ? model : (index + 1) + " " + model;
    stats["MAE " + name] = concise(values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length);
    stats["RMSE " + name] = concise(Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length));
    return [{ name, values, time }];
  });
  if (!estimates.length) return incompatible("计算预测误差需要同一结果中的配对实值。请选已完成的回测。");
  const intervals = [...new Set(estimates.flatMap(estimate => estimate.time))].sort();
  panels.push({ kind: "columns", title: "逐期误差（预测值减实值）", axis: "time", time_grain: first.dimensions.time_grain, x: intervals, series: estimates.map(estimate => {
    const indexed = new Map(estimate.time.map((time, index) => [time, estimate.values[index]]));
    return { name: estimate.name, unit: first.unit, data: intervals.map(time => indexed.get(time) ?? null) };
  }) });
  const samples = estimates.filter(estimate => estimate.values.length >= 4);
  if (samples.length) panels.push({ kind: "box", title: "预测误差分布", axis: "category", x: samples.map(sample => sample.name),
    series: samples.map(sample => ({ name: sample.name, unit: first.unit, data: sample.values })) });
  return panels;
}

export function planFigure(job: VisualizationJob, evidence: Evidence, available: readonly Engine[]) {
  const { configuration: request } = job;
  const items = evidence.map(item => item.data);
  if (!items.length || items.some(item => !observations(item).length)) return incompatible("情报空白。没有可用于此图的有效数据。");
  if (new Set(evidence.map(item => JSON.stringify(item.profile.query))).size !== evidence.length) {
    return incompatible("同一数据引用重复。请选择不同变量或时期。");
  }
  const grid = items.every(item => item.dimensions.shape === "grid");
  const time = items.every(item => item.dimensions.shape === "time");
  const categories = items.every(item => item.dimensions.shape === "category");
  const flow = items.every(item => item.dimensions.shape === "flow");
  const predict = items.some(item => item.is_forecast) && time && sameMetric(items);
  const minimum = Math.min(...items.map(item => observations(item).length));
  const candidates: ChartKind[] = grid ? ["grid", "surface"] : flow ? ["flow"] : categories
    ? ["rank", "columns", "horizontal-bars", ...(items.length === 2 && sameMetric(items) ? ["dumbbell" as const] : [])]
    : time ? [...(predict ? ["forecast" as const] : []), "trend", "columns", ...(minimum >= 4 ? ["trend-distribution" as const, "box" as const] : []),
      ...(minimum >= 8 ? ["violin" as const, "density" as const] : []), ...(items.length >= 2 ? ["correlation" as const] : [])] : [];
  const allowed = request.structure && structureCharts[request.structure];
  const chart = request.kind && request.kind !== "auto" ? request.kind : candidates.find(kind => !allowed || allowed.includes(kind));
  if (!chart) return incompatible("选择可比较的数据形状，或为不同形状分别创建图件。");
  if (allowed && !allowed.includes(chart)) return incompatible("该图样与所选数据结构不匹配。");
  if (request.structure === "timeline" && !time || request.structure === "categories" && !categories) {
    return incompatible("请选择与图样匹配的时间序列或类别截面。");
  }
  const paper = request.mode === "paper" || request.engine === "matplotlib" || chart === "violin" || chart === "density";
  if (request.mode === "interactive" && (chart === "violin" || chart === "density" || request.engine === "matplotlib")) {
    return incompatible("当前小提琴和密度配方请使用论文模式。");
  }
  const engine: Engine = request.engine && request.engine !== "auto" ? request.engine : paper ? "matplotlib" : chart === "surface" ? "plotly" : "echarts";
  if ((paper && engine !== "matplotlib") || !engineCharts[engine].includes(chart)) {
    return incompatible(engine + " 当前没有 " + names[chart] + " 的受控配方。请选择兼容的图型或引擎。");
  }
  if (!available.includes(engine)) throw new VisualizationError("ENGINE_UNAVAILABLE", engine + " 当前未配置，图型与数据选择已保留。");
  const style = figureDesign(request.style, paper);
  const statistics: Record<string, number> = {};
  const warnings: string[] = [];
  const transformations: string[] = [];
  items.forEach((item, index) => {
    const numbers = observations(item);
    Object.entries(describeNumbers(numbers)).forEach(([key, value]) => { statistics[(index + 1) + " " + key] = value; });
    if (item.missing_mask.some(Boolean)) warnings.push(item.title + "有 " + item.missing_mask.filter(Boolean).length + " 条缺测，原样保留。");
    if (item.truncated) warnings.push(item.title + "达到查询行数上限，图件和统计只覆盖已返回记录。");
    if (item.is_forecast && !item.interval_method) warnings.push(item.title + "只提供点预测。");
    transformations.push(...item.transform_history);
  });
  const units = [...new Set(items.map(item => item.unit))];
  let panels: FigurePanel[];
  switch (chart) {
    case "grid": case "surface": panels = items.map(spatial); break;
    case "flow": panels = items.map(flows); break;
    case "scatter": case "correlation":
      panels = [relationship(items, chart, statistics)];
      transformations.push("按地区、时间和口径匹配，只使用完整配对。");
      warnings.push("关系或相关系数不能作为因果推断。");
      break;
    case "forecast": case "forecast-diagnostics":
      panels = forecastPanels(items, chart, statistics);
      if (chart === "forecast-diagnostics") {
        transformations.push("逐期按预测值减对照实值计算误差及 MAE、RMSE。");
        if (!panels.some(panel => panel.kind === "box")) warnings.push("误差箱线需要至少 4 期匹配样本。当前显示逐期误差。");
      }
      break;
    case "ring": case "composition-columns": {
      if (items.length !== 1 || !categories || items[0].dataset_id !== "nbs_annual_power_capacity" || items[0].series_id !== "composition" ||
        items[0].rows.some(row => row.value === null || row.value < 0) || !items[0].rows.some(row => (row.value ?? 0) > 0)) {
        return incompatible("请选择同年全国年末装机的互斥分项。");
      }
      panels = category(items, "columns").map(panel => ({ ...panel, kind: chart }));
      break;
    }
    case "columns": case "rank": case "horizontal-bars": case "waterfall": case "dumbbell": case "rose":
      panels = category(items, chart); break;
    case "box": case "violin": case "density":
      panels = distribution(items, chart);
      transformations.push(chart === "box" ? "箱线标记四分位数和 1.5 倍四分位距外的点。" : "密度用 Scott 带宽估计。");
      break;
    case "stack":
      if (!time || !sameMetric(items) || items.length < 2 || !items.every(item => item.domain === "electricity" &&
        item.metric_id === "electricity_generation_current" && item.series_id !== "electricity" && scopeOf(item) === scopeOf(items[0]) &&
        item.source_version === items[0].source_version && observations(item).every(value => value >= 0)) ||
        new Set(items.map(item => item.series_id)).size !== items.length) {
        return incompatible("结构堆叠需要同口径、互斥且可加的月度电源本期值。禁止混入总量或累计值。");
      }
      panels = [timeline(items, "已选电源发电量构成", "stack")];
      for (let index = 0; index < panels[0].x.length; index++) {
        if (panels[0].series.some(series => series.data[index] === null)) panels[0].series.forEach(series => { series.data[index] = null; });
      }
      if (!panels[0].series.some(series => series.data.some(value => value !== null))) return incompatible("缺少同期完整分项。");
      transformations.push("各分项均有公布值的月份才显示总厚度。");
      break;
    case "calendar":
      if (!time || items.some(item => item.dimensions.time_grain !== "day")) return incompatible("日历需要日度序列。");
      panels = items.flatMap(item => [...new Set(item.rows.map(row => row.timestamp!.slice(0, 4)))].map(year =>
        timeline([{ ...item, rows: item.rows.filter(row => row.timestamp!.startsWith(year)) }], year + "年 · " + item.title, "calendar")));
      break;
    default:
      if (!time) return incompatible("趋势需要按时点标注的序列。");
      panels = units.map(unit => timeline(items.filter(item => item.unit === unit), items.filter(item => item.unit === unit).map(item => item.title).join(" / ")));
      if (units.length > 1) warnings.push("不同量纲分面显示，各保留独立单位。");
      if (chart === "trend-distribution") panels.push(...distribution(items, "box"));
  }
  if (!panels.length || panels.length > 6) return incompatible("当前画布每张图可容纳一至六个面板。请缩小范围。");
  if (engine === "flint" && (panels.length !== 1 || panels[0].series.length !== 1 || items[0].is_forecast)) {
    return incompatible("Flint 的本站适配器只接收单系列观测图。多系列需用 ECharts 或论文模式。");
  }
  const layout = request.layout && request.layout !== "auto" ? request.layout
    : panels.length > 4 ? "3x2" : panels.length === 3 ? "focus" : panels.length === 4 ? "2x2" : panels.length === 2 ? "horizontal" : "vertical";
  const columns = layout === "vertical" ? 1 : layout === "3x2" ? 3 : 2;
  if (panels.length > (layout === "focus" ? 5 : layout === "2x2" ? 4 : 6) || layout === "horizontal" && panels.length > 2) {
    return incompatible("面板数量超过所选布局的容量。");
  }
  const model: FigureModel = {
    title: request.title ?? (items.length === 1 ? items[0].title :
      chart === "forecast" && new Set(items.map(item => item.title)).size === 1 ? items[0].title + "与预测" : names[chart]), panels,
    columns: Math.min(columns, panels.length), focus: layout === "focus" && panels.length > 1,
  };
  const activeDomains = [...new Set(items.map(item => item.domain))];
  const validations = ["项目授权及来源", "数据缺测与主键", "单位与统计条件", "画布与对比度", "唯一渲染器"];
  const plan: VisualizationPlan = {
    version: 1, chart, candidates: [...new Set([chart, ...candidates.filter(kind => kind !== "surface" || available.includes("plotly"))])],
    reason: names[chart] + " · " + (request.kind && request.kind !== "auto" ? "按指定图型校验" : "按数据维度推荐"),
    fields: [...new Set(items.flatMap(item => [item.metric_id, item.dimensions.shape === "grid" ? "longitude / latitude" :
      item.dimensions.shape === "category" ? "region_id" : "timestamp", "value"]))],
    skills: skillsFor(activeDomains, engine).map(skill => skill.skill_id), engine, renderer: engine === "flint" ? "echarts" : engine,
    layout, design: style, output: engine === "matplotlib" ? ["svg", "png", "pdf", "json", "python"] : ["svg", "json"],
    validations, transformations: [...new Set(transformations)], datasets: evidence.map(item => item.profile),
  };
  if (hasEditableDrawing(model)) plan.output.push("drawio");
  if (contrast(style.foreground, style.background) < 4.5) throw new VisualizationError("VALIDATION_FAILED", "图件文字对比度不足。");
  if (paper && style.height_mm / (model.focus ? Math.ceil((panels.length - 1) / model.columns) + 1 : Math.ceil(panels.length / model.columns)) < 36) {
    throw new VisualizationError("VALIDATION_FAILED", "版面高度不足。请增加图件高度或减少子图。");
  }
  const validation: Validation = { status: "valid", checks: validations.map((detail, index) => ({ id: "v" + (index + 1), detail })), warnings };
  return { model, plan, validation, statistics, insights: figureInsights(evidence, statistics) };
}

export type PreparedFigure = ReturnType<typeof planFigure>;
export type { Recipe };
