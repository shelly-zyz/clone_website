import type { EChartsOption } from "echarts";
import {
  chartNumbers, fieldName, flowLinks, isSankeyData, labelsFor, mean, measurements, numeric,
  type ChartData, type ChartFields, type ChartTemplate,
} from "@/lib/topic-analysis/custom-chart";

export const palettes = {
  lagoon: {
    name: "海风", background: "#fbfdff", ink: "#182e45", muted: "#52677e", rule: "#e0e9f1",
    colors: ["#486ce8", "#0bafaa", "#ed725c", "#8562df", "#e8a329", "#379cd2", "#d85892", "#65852b"],
    scale: ["#e4f8fa", "#8cddd9", "#23b4bf", "#5368dc", "#673ab1"],
  },
  mineral: {
    name: "霞光", background: "#fffdfa", ink: "#34213f", muted: "#69566d", rule: "#efe6ed",
    colors: ["#d9547b", "#df8647", "#674bb9", "#128e9a", "#397bd5", "#9a7a26", "#a65fa6", "#528348"],
    scale: ["#fff3d8", "#ffc987", "#f5826f", "#cd4f8e", "#703a92"],
  },
  midnight: {
    name: "夜色", background: "#17243a", ink: "#f0f6ff", muted: "#b4c5db", rule: "#33445d",
    colors: ["#7b9cff", "#54dcce", "#ff9a81", "#be9aff", "#f9c66a", "#6dc9ff", "#fa87c1", "#b6da73"],
    scale: ["#274569", "#307cb1", "#37c3c4", "#a8dd96", "#ffe08a"],
  },
} as const;

export type PaletteName = keyof typeof palettes;
type Palette = (typeof palettes)[PaletteName];
type ChartResult = { option?: EChartsOption; note?: string; error?: string };

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const compactNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });

function shortName(label: string, length = 14) {
  return label.length > length ? label.slice(0, length - 1) + "…" : label;
}

function ramp(color: string, horizontal = false) {
  return {
    type: "linear" as const, x: 0, y: 0, x2: horizontal ? 1 : 0, y2: horizontal ? 0 : 1,
    colorStops: [{ offset: 0, color: color + (horizontal ? "85" : "72") }, { offset: 1, color: color + (horizontal ? "ff" : "08") }],
  };
}

function axis(palette: Palette) {
  return {
    axisLabel: { color: palette.muted, hideOverlap: true, fontSize: 11 },
    axisLine: { lineStyle: { color: palette.rule } },
    axisTick: { show: false },
    nameTextStyle: { color: palette.muted, fontSize: 11 },
  };
}

function categoryAxis(palette: Palette, labels: string[]) {
  return { ...axis(palette), type: "category" as const, data: labels };
}

function valueAxis(palette: Palette, name?: string, scale = false) {
  return {
    ...axis(palette), type: "value" as const, scale, name: name && shortName(name, 24),
    axisLabel: { ...axis(palette).axisLabel, formatter: (value: number) => compactNumber.format(value) },
    splitLine: { lineStyle: { color: palette.rule } },
  };
}

function grid(compact: boolean, extraBottom = 0) {
  return { left: compact ? 49 : 68, right: compact ? 18 : 34, top: 42, bottom: 46 + extraBottom };
}

function legend(palette: Palette) {
  return { type: "scroll" as const, bottom: 7, textStyle: { color: palette.muted }, pageTextStyle: { color: palette.muted } };
}

function colorAt(palette: Palette, index: number) {
  return palette.colors[index % palette.colors.length];
}

function categoryColor(palette: Palette, index: number, count: number) {
  return count > palette.colors.length ? `hsl(${(index * 137.508 + 218) % 360} 67% ${palette === palettes.midnight ? 69 : 46}%)` : colorAt(palette, index);
}

function heatmap(data: ChartData, fields: ChartFields, palette: Palette, compact: boolean): ChartResult {
  const { x, y, value } = fields;
  if (x === undefined || y === undefined || value === undefined || x === y) return { error: "请选择两个不同的维度和一个数值指标。" };
  const allX = labelsFor(data, x);
  const allY = labelsFor(data, y);
  const columns = allX.slice(0, 48);
  const rows = allY.slice(0, 26);
  const xIndex = new Map(columns.map((name, index) => [name, index]));
  const yIndex = new Map(rows.map((name, index) => [name, index]));
  const cells = new Map<string, { x: number; y: number; values: number[] }>();
  for (const row of data.rows) {
    const xi = xIndex.get(row[x]);
    const yi = yIndex.get(row[y]);
    const amount = numeric(row[value]);
    if (xi === undefined || yi === undefined || amount === null) continue;
    const key = xi + "," + yi;
    const cell = cells.get(key) ?? { x: xi, y: yi, values: [] };
    cell.values.push(amount);
    cells.set(key, cell);
  }
  if (!cells.size) return { error: "所选字段没有可绘制的有效数值。" };
  const values = [...cells.values()].map(cell => [cell.x, cell.y, mean(cell.values)]);
  const bounds = values.map(cell => cell[2]);
  const min = Math.min(...bounds);
  const max = Math.max(...bounds);
  const showNumbers = values.length <= (compact ? 24 : 75);
  return {
    note: "同一格内的记录取平均值，空格表示缺少数据。" +
      (columns.length < allX.length || rows.length < allY.length ? " 图中最多展示前 48 列、26 行。" : ""),
    option: {
      grid: { left: compact ? 48 : 74, right: 14, top: 14, bottom: 72 },
      xAxis: { ...categoryAxis(palette, columns), axisLabel: { ...axis(palette).axisLabel, formatter: (label: string) => shortName(label, 8) } },
      yAxis: { ...categoryAxis(palette, rows), inverse: true, axisLabel: { ...axis(palette).axisLabel, formatter: (label: string) => shortName(label, compact ? 4 : 8) } },
      visualMap: {
        type: "continuous", dimension: 2, min, max: max === min ? max + Math.max(1, Math.abs(max) * 0.01) : max,
        inRange: { color: [...palette.scale] }, bottom: 12, left: "center", orient: "horizontal",
        itemWidth: 10, itemHeight: compact ? 88 : 150, text: [number.format(max), number.format(min)], textStyle: { color: palette.muted },
      },
      tooltip: {
        formatter: params => {
          const point = (Array.isArray(params) ? params[0] : params).value;
          return Array.isArray(point) ? `${columns[Number(point[0])]} · ${rows[Number(point[1])]}\n${fieldName(data, value)}  ${number.format(Number(point[2]))}` : "";
        },
      },
      series: [{
        type: "heatmap", name: fieldName(data, value), data: values,
        itemStyle: { borderRadius: rows.length <= 12 ? 4 : 0, borderWidth: 2, borderColor: palette.background },
        label: { show: showNumbers, formatter: params => {
          const point = Array.isArray(params.value) ? Number(params.value[2]) : NaN;
          const high = (point - min) / (max - min || 1) >= 0.62;
          return `{${high !== (palette === palettes.midnight) ? "light" : "dark"}|${number.format(point)}}`;
        }, rich: { light: { color: "#fff", fontSize: 10 }, dark: { color: "#132e47", fontSize: 10 } } },
        emphasis: { itemStyle: { borderColor: palette.ink } },
      }],
    },
  };
}

function trend(data: ChartData, fields: ChartFields, palette: Palette, compact: boolean): ChartResult {
  const { x, value, group } = fields;
  if (x === undefined || value === undefined) return { error: "请选择时间和数值指标。" };
  const times = labelsFor(data, x);
  const names = group === undefined ? [fieldName(data, value)] : labelsFor(data, group);
  const groups = new Map<string, Map<string, number[]>>();
  for (const row of data.rows) {
    const key = group === undefined ? names[0] : row[group];
    const time = row[x];
    const measurement = numeric(row[value]);
    if (!key || !time || measurement === null) continue;
    const periods = groups.get(key) ?? new Map<string, number[]>();
    const points = periods.get(time) ?? [];
    points.push(measurement);
    periods.set(time, points);
    groups.set(key, periods);
  }
  if (!groups.size) return { error: "所选时间和指标没有同时有效的记录。" };
  const zoom = times.length > 36;
  return {
    note: "同一时间和分组内的记录取平均值，缺失记录保留断点。",
    option: {
      legend: group === undefined ? undefined : { ...legend(palette), bottom: zoom ? 30 : 7 },
      grid: grid(compact, (group === undefined ? 0 : 16) + (zoom ? 22 : 0)),
      tooltip: { trigger: "axis" },
      xAxis: { ...categoryAxis(palette, times), boundaryGap: false },
      yAxis: valueAxis(palette, fieldName(data, value), true),
      dataZoom: zoom ? [{ type: "slider", bottom: 7, height: 16, showDataShadow: false, startValue: times.length - 36, endValue: times.length - 1 }] : undefined,
      series: names.filter(name => groups.has(name)).map((name, index) => {
        const color = colorAt(palette, index);
        const values = groups.get(name);
        return {
          type: "line", name, symbol: "circle", showSymbol: times.length <= 18, symbolSize: 6,
          data: times.map(time => {
            const items = values?.get(time);
            return items?.length ? mean(items) : null;
          }),
          lineStyle: { color, width: 2.5 }, itemStyle: { color, borderColor: palette.background, borderWidth: 1 },
          areaStyle: group === undefined ? { color: ramp(color) } : undefined,
          emphasis: { focus: "series" },
        };
      }),
    },
  };
}

function scatter(data: ChartData, fields: ChartFields, palette: Palette, compact: boolean): ChartResult {
  const { x, y, value, group } = fields;
  if (x === undefined || y === undefined || x === y) return { error: "请选择两个不同的数值列作为横纵轴。" };
  const points = data.rows.flatMap(row => {
    const first = numeric(row[x]);
    const second = numeric(row[y]);
    const size = value === undefined ? null : numeric(row[value]);
    const name = group === undefined ? "数据点" : row[group] || "未分组";
    return first === null || second === null ? [] : [{ name, first, second, size }];
  });
  if (!points.length) return { error: "所选横纵轴没有同时有效的记录。" };
  const maxSize = Math.max(0, ...points.map(point => point.size ?? 0));
  const names = [...new Set(points.map(point => point.name))];
  return {
    note: value === undefined ? undefined : `气泡大小表示 ${fieldName(data, value)}，非正值与空值用最小点表示。`,
    option: {
      grid: grid(compact, group === undefined ? 0 : 16),
      legend: group === undefined ? undefined : legend(palette),
      xAxis: { ...valueAxis(palette, fieldName(data, x), true), nameLocation: "middle", nameGap: 28 },
      yAxis: valueAxis(palette, fieldName(data, y), true),
      tooltip: {
        formatter: params => {
          const point = (Array.isArray(params) ? params[0] : params).value;
          if (!Array.isArray(point)) return "";
          return [group === undefined ? "" : String(point[3]),
            `${fieldName(data, x)}  ${number.format(Number(point[0]))}`,
            `${fieldName(data, y)}  ${number.format(Number(point[1]))}`,
            value === undefined ? "" : `${fieldName(data, value)}  ${point[2] === null ? "缺失" : number.format(Number(point[2]))}`,
          ].filter(Boolean).join("\n");
        },
      },
      series: names.map((name, index) => {
        const color = categoryColor(palette, index, names.length);
        return {
          name, type: "scatter", progressive: 0,
          data: points.filter(point => point.name === name).map(point => ({
            value: [point.first, point.second, point.size, name],
            symbolSize: value === undefined || maxSize <= 0 ? 9 : 4 + Math.sqrt(Math.max(0, point.size ?? 0) / maxSize) * 23,
          })),
          itemStyle: { color, opacity: 0.78, borderColor: palette.background, borderWidth: 1.2 }, emphasis: { focus: "series" },
        };
      }),
    },
  };
}

function parallel(data: ChartData, fields: ChartFields, palette: Palette, compact: boolean): ChartResult {
  const metrics = chartNumbers(data).slice(0, compact ? 4 : 6);
  const points = data.rows.flatMap(row => {
    const values = metrics.map(metric => numeric(row[metric.index]));
    if (values.some(value => value === null)) return [];
    return [{ name: fields.group === undefined ? "数据记录" : row[fields.group] || "未分组", values: values as number[] }];
  });
  if (!points.length) return { error: "没有在各数值列上都有值的记录。" };
  const names = [...new Set(points.map(point => point.name))];
  return {
    note: `当前指标为${metrics.map(metric => metric.label).join("、")}。可拖动坐标轴上的区间筛选；缺少任一指标的记录未绘制。`,
    option: {
      parallel: {
        left: compact ? 29 : 63, right: compact ? 32 : 61, top: 50, bottom: 41,
        parallelAxisDefault: { ...axis(palette), nameGap: 17, nameLocation: "end", axisLine: { lineStyle: { color: palette.muted } } },
      },
      parallelAxis: metrics.map(({ label }, dim) => ({ type: "value", dim, name: shortName(label, compact ? 5 : 12), scale: true })),
      legend: fields.group === undefined ? undefined : legend(palette),
      series: names.map((name, index) => ({
        name, type: "parallel", data: points.filter(point => point.name === name).map(point => point.values),
        lineStyle: { color: categoryColor(palette, index, names.length), width: 1.5, opacity: points.length > 100 ? 0.2 : 0.54 },
        inactiveOpacity: 0.07, activeOpacity: 0.92, progressive: 0,
      })),
    },
  };
}

function quartile(values: number[], fraction: number) {
  const index = (values.length - 1) * fraction;
  const low = Math.floor(index);
  return values[low] + (values[Math.ceil(index)] - values[low]) * (index - low);
}

function boxplot(data: ChartData, fields: ChartFields, palette: Palette, compact: boolean): ChartResult {
  const { x, value } = fields;
  if (x === undefined || value === undefined) return { error: "请选择一个分组字段和一个数值指标。" };
  const all = [...measurements(data, x, value)].filter(([, items]) => items.length >= 4);
  const groups = all.slice(0, 14);
  if (!groups.length) return { error: "每组至少需要 4 个有效数值才能计算箱须。" };
  const outliers: number[][] = [];
  const boxes = groups.map(([name, values], index) => {
    const sorted = values.sort((a, b) => a - b);
    const q1 = quartile(sorted, 0.25);
    const median = quartile(sorted, 0.5);
    const q3 = quartile(sorted, 0.75);
    const range = (q3 - q1) * 1.5;
    const inliers = sorted.filter(point => point >= q1 - range && point <= q3 + range);
    sorted.filter(point => point < q1 - range || point > q3 + range).forEach(point => outliers.push([index, point]));
    const color = colorAt(palette, index);
    return { name, value: [inliers[0], q1, median, q3, inliers[inliers.length - 1]], itemStyle: { color: color + "50", borderColor: color, borderWidth: 2 } };
  });
  return {
    note: "箱体表示第 25 至 75 百分位，圆点表示超出 1.5 倍四分位距的值。每组至少 4 条有效记录。" +
      (all.length > groups.length ? " 图中展示前 14 组。" : ""),
    option: {
      grid: grid(compact),
      xAxis: { ...categoryAxis(palette, groups.map(([name]) => name)), axisLabel: { ...axis(palette).axisLabel, formatter: (label: string) => shortName(label, 9) } },
      yAxis: valueAxis(palette, fieldName(data, value), true),
      series: [
        { name: fieldName(data, value), type: "boxplot", data: boxes, boxWidth: [12, 36] },
        { name: "离群值", type: "scatter", data: outliers, symbolSize: 7, itemStyle: { color: palette.colors[2] } },
      ],
    },
  };
}

function rank(data: ChartData, fields: ChartFields, palette: Palette, compact: boolean): ChartResult {
  const averages = [...measurements(data, fields.x, fields.value)]
    .map(([name, values]) => ({ name, value: fields.value === undefined ? values.length : mean(values) }))
    .sort((a, b) => b.value - a.value);
  if (!averages.length) return { error: "所选类别与指标没有同时有效的记录。" };
  const rows = averages.slice(0, 12);
  const title = fieldName(data, fields.value) || "记录数";
  return {
    note: `${fields.value === undefined ? "按记录数排名。" : "同一类别有多条记录时，按均值排名。"}${averages.length > rows.length ? " 展示前 12 项。" : ""}`,
    option: {
      grid: { left: compact ? 67 : 107, right: compact ? 62 : 81, top: 32, bottom: 41 },
      xAxis: { ...valueAxis(palette, title), nameLocation: "middle", nameGap: 28 },
      yAxis: { ...categoryAxis(palette, rows.map(row => row.name)), inverse: true, axisLabel: { ...axis(palette).axisLabel, formatter: (name: string) => shortName(name, compact ? 6 : 12) } },
      series: [{
        type: "bar", name: title, barMaxWidth: 20, label: { show: true, position: "right", color: palette.ink, formatter: params => compactNumber.format(Number(params.value)) },
        data: rows.map((row, index) => ({ ...row, itemStyle: { color: ramp(colorAt(palette, index), true), borderRadius: 6 } })),
      }],
    },
  };
}

function flow(data: ChartData, fields: ChartFields, palette: Palette, compact: boolean, kind: "sankey" | "graph"): ChartResult {
  const allLinks = flowLinks(data, fields);
  if (!allLinks.length) return { error: "请选择两个不同的节点字段，且至少有一条有效连线。" };
  if (kind === "sankey" && !isSankeyData(allLinks)) return { error: "桑基图需要正数流量且方向不能形成循环。可切换到环形关系图。" };

  const limit = kind === "graph" ? 90 : 50;
  const links = [...allLinks].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, limit);
  const weights = new Map<string, number>();
  for (const { source, target, value } of links) {
    weights.set(source, (weights.get(source) ?? 0) + Math.abs(value));
    weights.set(target, (weights.get(target) ?? 0) + Math.abs(value));
  }
  const labels = [...weights.keys()];
  const indexes = new Map(labels.map((name, index) => [name, index]));
  const name = fieldName(data, fields.value) || "记录数";
  const note = `相同端点的连线按${fields.value === undefined ? "记录数合并" : "权重求和"}。` +
    (links.length < allLinks.length ? ` 展示权重绝对值最大的 ${limit} 条连线。` : "");

  if (kind === "sankey") {
    return {
      note, option: { series: [{
        type: "sankey", name, left: 21, right: compact ? 56 : 111, top: 21, bottom: 23,
        nodeWidth: compact ? 11 : 16, nodeGap: 12, draggable: false,
        label: { color: palette.ink, formatter: params => shortName(params.name, compact ? 5 : 12) },
        data: labels.map((node, index) => ({ name: node, itemStyle: { color: categoryColor(palette, index, labels.length), borderRadius: 3 } })),
        links, lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.46 }, emphasis: { focus: "adjacency" },
      }] },
    };
  }
  const maximum = Math.max(1, ...weights.values());
  return {
    note, option: { series: [{
      type: "graph", name, layout: "circular", circular: { rotateLabel: false }, roam: true,
      left: compact ? 54 : 91, right: compact ? 54 : 91, top: 45, bottom: 45,
      label: { show: labels.length <= (compact ? 12 : 24), color: palette.ink, formatter: params => shortName(params.name, compact ? 5 : 12), position: "right" },
      labelLayout: { hideOverlap: true },
      data: labels.map((node, index) => ({
        name: node, symbolSize: 9 + Math.sqrt((weights.get(node) ?? 0) / maximum) * 27,
        itemStyle: { color: categoryColor(palette, index, labels.length), borderColor: palette.background, borderWidth: 1.5 },
      })),
      links: links.map(link => ({
        ...link,
        lineStyle: { color: categoryColor(palette, indexes.get(link.source) ?? 0, labels.length), width: 1 + 4 * Math.sqrt(Math.abs(link.value) / maximum) },
      })),
      edgeSymbol: ["none", labels.length <= 18 ? "arrow" : "none"], edgeSymbolSize: 7,
      lineStyle: { curveness: 0.26, opacity: 0.42 }, emphasis: { focus: "adjacency", label: { show: true } },
    }] },
  };
}

export function buildChart(data: ChartData, kind: ChartTemplate, fields: ChartFields, paletteName: PaletteName, compact: boolean): ChartResult {
  const palette = palettes[paletteName];
  const result = kind === "heatmap" ? heatmap(data, fields, palette, compact)
    : kind === "trend" ? trend(data, fields, palette, compact)
    : kind === "scatter" ? scatter(data, fields, palette, compact)
    : kind === "parallel" ? parallel(data, fields, palette, compact)
    : kind === "boxplot" ? boxplot(data, fields, palette, compact)
    : kind === "rank" ? rank(data, fields, palette, compact)
    : flow(data, fields, palette, compact, kind);
  if (!result.option) return result;
  return {
    ...result,
    option: {
      animation: false, backgroundColor: palette.background, color: [...palette.colors],
      textStyle: { color: palette.ink, fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' },
      ...result.option,
      tooltip: {
        trigger: "item", renderMode: "richText", confine: true, backgroundColor: palette.background,
        borderColor: palette.rule, textStyle: { color: palette.ink, fontSize: 12 },
        valueFormatter: value => typeof value === "number" ? number.format(value) : (value == null ? "缺失" : String(value)),
        ...result.option.tooltip,
      },
    },
  };
}
