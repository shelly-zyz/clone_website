import { csvParseRows } from "d3-dsv";

export const uploadLimits = { bytes: 2 * 1024 * 1024, rows: 5000, columns: 40 };

export type ChartColumn = { index: number; label: string; kind: "time" | "number" | "category"; distinct: number };
export type ChartData = { name: string; columns: ChartColumn[]; rows: string[][] };
export type ChartFields = { x?: number; y?: number; value?: number; group?: number };
export type ChartField = keyof ChartFields;

export const chartTemplates = {
  heatmap: { name: "矩阵热力图", description: "用颜色比较两个维度", fields: { x: "横轴", y: "纵轴", value: "颜色指标" } },
  trend: { name: "渐变趋势图", description: "按时间追踪指标变化", fields: { x: "时间", value: "指标", group: "分组" } },
  scatter: { name: "多维气泡图", description: "用位置、颜色和大小比较指标", fields: { x: "横轴指标", y: "纵轴指标", value: "气泡大小", group: "颜色分组" } },
  parallel: { name: "平行坐标图", description: "比较多项指标的组合", fields: { group: "颜色分组" } },
  boxplot: { name: "分组箱须图", description: "比较分布、中位数和离群值", fields: { x: "分组", value: "指标" } },
  sankey: { name: "桑基流向图", description: "按流量展示来源和去向", fields: { x: "来源", y: "去向", value: "流量" } },
  graph: { name: "环形关系图", description: "按连接展示节点关系", fields: { x: "来源", y: "去向", value: "权重" } },
  rank: { name: "彩色排名图", description: "从高到低对照类别", fields: { x: "类别", value: "指标" } },
} as const satisfies Record<string, { name: string; description: string; fields: Partial<Record<ChartField, string>> }>;

export type ChartTemplate = keyof typeof chartTemplates;
export type Recommendation = { kind: ChartTemplate; fields: ChartFields };

export function numeric(value?: string | null) {
  if (!value || !/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrder(value: string, allowYear: boolean) {
  const match = /^(\d{4})(?:[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?月?日?)?$/.exec(value);
  if (!match || (!match[2] && !allowYear)) return null;
  const year = Number(match[1]);
  const month = Number(match[2] ?? 1);
  const day = Number(match[3] ?? 1);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : null;
}

const terminalFields = {
  from: /^(source|from|origin|起点|来源|源节点|流出|发送方)(?:[\s_-]*(?:id|name|名称|编号|地区|省份))?$/i,
  to: /^(target|to|destination|终点|去向|目标|目标节点|流入|接收方)(?:[\s_-]*(?:id|name|名称|编号|地区|省份))?$/i,
};

export function readChartData(name: string, input: string): ChartData {
  const [header, ...rows] = csvParseRows(input.replace(/^\uFEFF/, ""), row => row.map(value => value.trim()))
    .filter(row => row.some(Boolean));
  if (!header?.length || !rows.length) throw new Error("CSV 需要一行表头和至少一行数据。");
  if (header.length > uploadLimits.columns || rows.length > uploadLimits.rows) {
    throw new Error("CSV 最多支持 5,000 行数据和 40 列。");
  }
  if (header.some(label => !label) || new Set(header).size !== header.length) {
    throw new Error("表头中的列名不能为空或重复。");
  }
  if (rows.some(row => row.length !== header.length)) {
    throw new Error("有数据行的列数与表头不一致，请检查逗号以及双引号。");
  }
  const columns = header.map((label, index): ChartColumn => {
    const values = new Set(rows.map(row => row[index]).filter(Boolean));
    const items = [...values];
    const dates = items.length && items.every(value => dateOrder(value, /^(year|年份?|年度)$/i.test(label)) !== null);
    const numbers = items.length && items.every(value => numeric(value) !== null);
    const kind = terminalFields.from.test(label) || terminalFields.to.test(label)
      ? "category" : dates ? "time" : numbers ? "number" : "category";
    return { index, label, kind, distinct: values.size };
  });
  return { name, columns, rows };
}

export function fieldName(data: ChartData, index?: number) {
  return index === undefined ? "" : (data.columns[index]?.label ?? "");
}

export function labelsFor(data: ChartData, index?: number) {
  if (index === undefined) return data.rows.map((_, row) => String(row + 1));
  const labels = [...new Set(data.rows.map(row => row[index]).filter(Boolean))];
  return data.columns[index]?.kind === "time"
    ? labels.sort((a, b) => (dateOrder(a, true) ?? 0) - (dateOrder(b, true) ?? 0))
    : labels;
}

export function chartNumbers(data: ChartData) {
  return data.columns.filter(column => column.kind === "number" && column.distinct > 0);
}

export function availableFields(data: ChartData, kind: ChartTemplate, field: ChartField, fields: ChartFields) {
  if (field === "value" || (kind === "scatter" && (field === "x" || field === "y"))) return chartNumbers(data);
  if (kind === "trend" && field === "x") return data.columns.filter(column => column.kind === "time");
  if (kind === "sankey" || kind === "graph") return data.columns.filter(column => column.distinct > 0);
  return data.columns.filter(column => column.distinct > 0 && column.kind !== "number" &&
    (field !== "group" || (column.index !== fields.x && column.distinct <= 10)));
}

export function optionalField(kind: ChartTemplate, field: ChartField) {
  return field === "group" || (field === "value" && ["scatter", "graph", "sankey", "rank"].includes(kind))
    || (field === "x" && kind === "rank");
}

export function measurements(data: ChartData, dimension?: number, metric?: number) {
  const groups = new Map<string, number[]>();
  for (const [index, row] of data.rows.entries()) {
    const key = dimension === undefined ? String(index + 1) : row[dimension];
    const value = metric === undefined ? 1 : numeric(row[metric]);
    if (!key || value === null) continue;
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

export function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value / values.length, 0);
}

export function flowLinks(data: ChartData, fields: ChartFields) {
  const { x, y, value } = fields;
  if (x === undefined || y === undefined || x === y) return [];
  const links = new Map<string, { source: string; target: string; value: number }>();
  for (const row of data.rows) {
    const source = row[x];
    const target = row[y];
    const weight = value === undefined ? 1 : numeric(row[value]);
    if (!source || !target || weight === null) continue;
    const key = JSON.stringify([source, target]);
    const previous = links.get(key)?.value ?? 0;
    links.set(key, { source, target, value: previous + weight });
  }
  return [...links.values()].filter(link => Number.isFinite(link.value));
}

export function isSankeyData(links: ReturnType<typeof flowLinks>) {
  if (!links.length || links.some(link => link.value <= 0)) return false;
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const { source, target } of links) {
    const targets = outgoing.get(source) ?? [];
    targets.push(target);
    outgoing.set(source, targets);
    if (!indegree.has(source)) indegree.set(source, 0);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([node]) => node);
  for (let head = 0; head < queue.length; head++) {
    for (const target of outgoing.get(queue[head]) ?? []) {
      const degree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, degree);
      if (degree === 0) queue.push(target);
    }
  }
  return queue.length === indegree.size;
}

export function recommendCharts(data: ChartData): Recommendation[] {
  const numbers = chartNumbers(data);
  const dimensions = data.columns.filter(column => column.kind !== "number" && column.distinct > 0);
  const time = dimensions.find(column => column.kind === "time" && column.distinct > 1);
  const category = dimensions.filter(column => column.kind === "category");
  const group = category.find(column => column.distinct >= 2 && column.distinct <= 10);
  const usableCategories = category.filter(column => column.distinct >= 2 && column.distinct <= 30);
  const value = numbers[0]?.index;
  const from = dimensions.find(column => terminalFields.from.test(column.label))?.index;
  const to = dimensions.find(column => terminalFields.to.test(column.label))?.index;
  const weight = numbers.find(column => /value|weight|flow|amount|流量|流向量|权重|输送量|交易量/i.test(column.label))?.index ?? value;
  const items: Recommendation[] = [];

  if (from !== undefined && to !== undefined) {
    const fields = { x: from, y: to, value: weight };
    const links = flowLinks(data, fields);
    if (isSankeyData(links)) items.push({ kind: "sankey", fields });
    if (links.length) items.push({ kind: "graph", fields });
  }

  const heatX = time ?? usableCategories[0];
  const heatY = usableCategories.find(column => column.index !== heatX?.index);
  if (heatX && heatY && value !== undefined) {
    const pairs = new Set(data.rows.filter(row => row[heatX.index] && row[heatY.index] && numeric(row[value]) !== null)
      .map(row => JSON.stringify([row[heatX.index], row[heatY.index]])));
    if (pairs.size >= 4) items.push({ kind: "heatmap", fields: { x: heatX.index, y: heatY.index, value } });
  }
  if (time) {
    const trendMetric = numbers.find(column => new Set(data.rows
      .filter(row => row[time.index] && row[column.index]).map(row => row[time.index])).size >= 2);
    if (trendMetric) {
      const trendGroup = group && data.rows.some(row => row[time.index] && row[trendMetric.index] && row[group.index]);
      items.push({ kind: "trend", fields: { x: time.index, value: trendMetric.index, group: trendGroup ? group?.index : undefined } });
    }
  }
  for (const [index, x] of numbers.entries()) {
    const y = numbers.slice(index + 1).find(column => data.rows.some(row => row[x.index] && row[column.index]));
    if (!y) continue;
    const size = numbers.find(column => column !== x && column !== y &&
      data.rows.some(row => row[x.index] && row[y.index] && (numeric(row[column.index]) ?? 0) > 0));
    items.push({ kind: "scatter", fields: { x: x.index, y: y.index, value: size?.index, group: group?.index } });
    break;
  }
  const parallel = numbers.slice(0, 6);
  if (parallel.length >= 3 && data.rows.some(row => parallel.every(column => row[column.index]))) {
    items.push({ kind: "parallel", fields: { group: group?.index } });
  }
  const distribution = usableCategories.find(column => [...measurements(data, column.index, value).values()]
    .filter(values => values.length >= 4).length >= 2);
  if (distribution && value !== undefined) items.push({ kind: "boxplot", fields: { x: distribution.index, value } });
  const rankDimension = group?.index ?? category[0]?.index ?? dimensions[0]?.index;
  if (rankDimension !== undefined || value !== undefined) {
    const rankMetric = rankDimension === undefined || value === undefined || data.rows.some(row => row[rankDimension] && row[value])
      ? value : undefined;
    items.push({ kind: "rank", fields: { x: rankDimension, value: rankMetric } });
  }

  return items;
}

const regions = ["华北", "华东", "华中", "华南", "西北"];
export const sampleData = readChartData("区域能碳样例.csv", [
  "月份,区域,碳排放（ktCO₂）,用电量（GWh）,绿电占比（%）",
  ...Array.from({ length: 12 }, (_, month) => regions.map((region, index) => {
    const emissions = Math.round(51 + 11 * index + 9 * Math.sin(month / 1.7 + index) + month * 1.8);
    const power = Math.round(104 + 15 * index + 11 * Math.cos(month / 2 + index) + month * 3.3);
    const renewables = 22 + (month * 3 + index * 7) % 42;
    return [`2025-${String(month + 1).padStart(2, "0")}`, region, emissions, power, renewables].join(",");
  })).flat(),
].join("\n"));
