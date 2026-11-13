import type {
  BarSeriesOption, HeatmapSeriesOption, LineSeriesOption, MapSeriesOption, ScatterSeriesOption, TreemapSeriesOption,
} from "echarts/charts";
import type {
  DataZoomComponentOption, GridComponentOption, LegendComponentOption, MarkLineComponentOption,
  PolarComponentOption, TooltipComponentOption, VisualMapComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/model";

export const worldMap = "ogw-topic-world";
type ChartOptions = ComposeOption<BarSeriesOption | HeatmapSeriesOption | LineSeriesOption | MapSeriesOption
  | ScatterSeriesOption | TreemapSeriesOption | DataZoomComponentOption | GridComponentOption | LegendComponentOption
  | MarkLineComponentOption | PolarComponentOption | TooltipComponentOption | VisualMapComponentOption>;

const format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const ink = "#263c4c";
const gridColor = "#e3ebee";
const axisLabel = { color: ink, fontSize: 11, hideOverlap: true };
const valueAxis = {
  type: "value" as const, axisLabel: { ...axisLabel, formatter: (value: number) => compactFormat.format(value) },
  splitLine: { lineStyle: { color: gridColor } },
};
const heatColors = ["#dcf5f1", "#68e0c8", "#0fb1bd", "#3976d1", "#6242bc"];
const emissionColors = ["#fff2e1", "#ffd77a", "#ffab53", "#ec655a", "#aa3c81"];
const mapColors = ["#c2f1ed", "#64ded3", "#14adbd", "#3781d6", "#6149b5"];

function labelColor(background: string) {
  const channels = background.slice(1).match(/../g)?.map(pair => {
    const channel = Number.parseInt(pair, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels && 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance !== undefined && luminance > 0.22 ? "#102630" : "#fff";
}

function readValue(value: unknown, unit: string) {
  return typeof value === "number" && Number.isFinite(value) ? format.format(value) + " " + unit : "暂无";
}

function periodSlider(axis: "x" | "y", start: number, end: number): DataZoomComponentOption[] {
  const target = axis === "x" ? { xAxisIndex: 0 } : { yAxisIndex: 0 };
  return [{
    ...target, type: "slider", startValue: start, endValue: end, filterMode: "weakFilter",
    showDataShadow: false, brushSelect: false,
    ...(axis === "x" ? { bottom: 4, height: 18 } : { right: 6, width: 14 }),
    fillerColor: "#2a8da82b", borderColor: "#d3e2e8",
  }];
}

function heatmap(spec: AnalysisChartSpec, compact: boolean, tooltip: TooltipComponentOption): ChartOptions {
  const numberOfYears = spec.series.length;
  const visibleRows = compact ? 12 : 18;
  const latestStart = Math.max(0, numberOfYears - visibleRows);
  const focusRow = spec.series.findIndex(series => series.name === spec.focus);
  const first = focusRow < 0 ? latestStart : Math.max(0, Math.min(latestStart, focusRow - Math.floor(visibleRows / 2)));
  const last = Math.min(numberOfYears, first + visibleRows);
  const rows = compact ? spec.series.slice(first, last) : spec.series;
  const values = rows.flatMap((series, y) => series.values.flatMap((value, x) => value === null ? [] : [[x, y, value]]));
  const numbers = values.map(item => item[2]);
  const min = numbers.length ? Math.min(...numbers) : 0;
  const max = numbers.length ? Math.max(...numbers) : 1;
  const zoom = !compact && latestStart > 0;
  const palette = spec.id.startsWith("carbon-") || spec.id.startsWith("emission-") ? emissionColors : heatColors;
  return {
    tooltip: {
      ...tooltip, trigger: "item", formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        const data = item.value;
        return Array.isArray(data)
          ? `${rows[Number(data[1])]?.name} · ${spec.labels[Number(data[0])]}\n${readValue(data[2], spec.unit)}`
          : "";
      },
    },
    grid: { left: compact ? 36 : 52, right: zoom ? 41 : 13, top: 8, bottom: compact ? 25 : 67 },
    xAxis: {
      type: "category", data: [...spec.labels], axisLabel: { ...axisLabel, fontSize: compact ? 9 : 11 },
      splitArea: { show: true, areaStyle: { color: ["#eef3f5"] } }, axisTick: { show: false },
      axisLine: { show: false },
    },
    yAxis: {
      type: "category", data: rows.map(series => series.name), inverse: true,
      axisLabel: {
        ...axisLabel, fontSize: compact ? 9 : 11,
        formatter: (name: string) => name === spec.focus ? "{selected|" + name + "}" : name,
        rich: { selected: { color: "#086477", fontWeight: 800 } },
      },
      axisTick: { show: false }, axisLine: { show: false },
    },
    visualMap: {
      show: !compact, type: "continuous", min, max: Math.max(min + 0.0001, max), dimension: 2,
      orient: "horizontal", itemWidth: 11, itemHeight: 134, left: "center", bottom: 5,
      text: [readValue(max, spec.unit), readValue(min, spec.unit)],
      formatter: value => compactFormat.format(Number(value)), calculable: false, precision: 2,
      inRange: { color: palette }, textStyle: { color: ink },
    },
    dataZoom: zoom ? periodSlider("y", first, last - 1) : undefined,
    series: [{
      type: "heatmap", name: spec.title, data: values, silent: compact, itemStyle: { borderColor: "#fff", borderWidth: 1.5 },
      emphasis: { itemStyle: { borderColor: "#223b4c", borderWidth: 2 } },
    }],
  };
}

function mapOptions(spec: Extract<AnalysisChartSpec, { kind: "map" }>, compact: boolean, tooltip: TooltipComponentOption): ChartOptions {
  const names = new Map(spec.mapIds.map((id, index) => [id, spec.labels[index]]));
  const pieces = [
    { lt: spec.stops[0], color: mapColors[0] },
    ...spec.stops.slice(1).map((stop, index) => ({ gte: spec.stops[index], lt: stop, color: mapColors[index + 1] })),
    { gte: spec.stops[spec.stops.length - 1], color: mapColors[mapColors.length - 1] },
  ];
  return {
    tooltip: {
      ...tooltip, trigger: "item", formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        return `${names.get(item.name) ?? item.name}\n${readValue(item.value, spec.unit)}`;
      },
    },
    visualMap: {
      type: "piecewise", show: !compact, orient: "horizontal", left: "center", bottom: 6,
      itemWidth: 13, itemHeight: 9, itemGap: 8, textStyle: { color: ink, fontSize: 10 },
      pieces: pieces.map(piece => ({
        ...piece,
        label: "gte" in piece && piece.gte !== undefined
          ? "lt" in piece && piece.lt !== undefined
            ? compactFormat.format(piece.gte) + "–" + compactFormat.format(piece.lt)
            : "≥" + compactFormat.format(piece.gte)
          : "<" + compactFormat.format(spec.stops[0]),
      })),
    },
    series: [{
      type: "map", map: worldMap, nameProperty: "ADM0_A3", silent: compact, roam: false,
      top: 4, bottom: compact ? 4 : 46, left: 7, right: 7,
      itemStyle: { areaColor: "#e9eef0", borderColor: "#fff", borderWidth: 0.55 },
      emphasis: { label: { show: false }, itemStyle: { areaColor: "#ffcd58" } },
      data: spec.mapIds.map((id, index) => ({
        name: id, value: spec.series[0].values[index] ?? undefined,
        ...(spec.labels[index] === spec.focus ? { itemStyle: { borderColor: "#a45719", borderWidth: 1.5 } } : {}),
      })),
    }],
  };
}

function bubble(spec: Extract<AnalysisChartSpec, { kind: "bubble" }>, compact: boolean, tooltip: TooltipComponentOption): ChartOptions {
  const maximum = Math.max(1, ...spec.sizes);
  const data = spec.labels.flatMap((name, index) => {
    const x = spec.series[0].values[index];
    const y = spec.series[1].values[index];
    if (x === null || y === null) return [];
    const focused = name === spec.focus;
    return [{
      name, value: [x, y, spec.sizes[index]], symbolSize: (compact ? 5 : 7) + Math.sqrt(spec.sizes[index] / maximum) * (compact ? 17 : 42),
      itemStyle: {
        color: focused ? "#f37448" : spec.categoryColors?.[index] ?? "#20b8bc",
        ...(focused ? { opacity: 1, borderColor: "#fff", borderWidth: 1.5 } : {}),
      },
      label: focused && !compact ? { show: true, formatter: name, color: ink, position: "top" as const } : undefined,
    }];
  });
  return {
    tooltip: {
      ...tooltip, trigger: "item", formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        const data = item.value;
        return Array.isArray(data) ? [
          item.name, spec.series[0].name + "  " + readValue(data[0], spec.xUnit),
          spec.series[1].name + "  " + readValue(data[1], spec.unit), spec.sizeName + "  " + readValue(data[2], spec.sizeUnit),
        ].join("\n") : "";
      },
    },
    grid: { left: 47, right: compact ? 13 : 25, top: compact ? 13 : 43, bottom: compact ? 28 : 60 },
    xAxis: {
      ...valueAxis, type: spec.xLog ? "log" : "value",
      name: compact ? undefined : `${spec.series[0].name}（${spec.xUnit}）`,
      nameLocation: "center", nameGap: 34, nameTextStyle: { color: ink },
    },
    yAxis: {
      ...valueAxis, name: compact ? undefined : `${spec.series[1].name}（${spec.unit}）`,
      nameTextStyle: { color: ink, align: "left" }, nameGap: 16,
    },
    series: [{
      type: "scatter", data: data.sort((a, b) => Number(a.name === spec.focus) - Number(b.name === spec.focus) || b.value[2] - a.value[2]), silent: compact, color: "#31b4bc",
      itemStyle: { opacity: 0.76, borderColor: "#397b98", borderWidth: 0.65 },
      emphasis: { focus: "self", scale: 1.12, label: { show: true, formatter: "{b}", position: "top", color: ink } },
    }],
  };
}

function treemap(spec: AnalysisChartSpec, compact: boolean, tooltip: TooltipComponentOption): ChartOptions {
  return {
    tooltip: { ...tooltip, trigger: "item" },
    series: [{
      type: "treemap", left: 0, right: 0, top: 0, bottom: 0,
      roam: false, nodeClick: false, breadcrumb: { show: false }, silent: compact, sort: "desc",
      label: { show: true, fontSize: compact ? 10 : 14, fontWeight: 600, overflow: "truncate" },
      itemStyle: { gapWidth: 2, borderColor: "#fff" },
      data: spec.labels.flatMap((name, index) => {
        const value = spec.series[0].values[index];
        if (value === null || value <= 0) return [];
        const color = spec.categoryColors?.[index] ?? spec.color;
        return { name, value, itemStyle: { color }, label: { color: labelColor(color) } };
      }),
    }],
  };
}

function rose(spec: AnalysisChartSpec, compact: boolean, tooltip: TooltipComponentOption): ChartOptions {
  const colors = ["#45bac0", "#319bd0", "#637edc", "#9a80d7", "#e98277", "#ecae59", "#5ab99d", "#30a8aa"];
  return {
    polar: { radius: compact ? "65%" : "69%", center: ["50%", "50%"] },
    angleAxis: {
      type: "category", data: [...spec.labels], startAngle: 112.5,
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...axisLabel, fontSize: compact ? 10 : 13 },
      splitLine: { show: true, lineStyle: { color: gridColor } },
    },
    radiusAxis: {
      type: "value", min: 0, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { ...axisLabel, show: !compact, formatter: "{value}%" }, splitLine: { lineStyle: { color: gridColor } },
    },
    tooltip: { ...tooltip, trigger: "item" },
    series: [{
      type: "bar", coordinateSystem: "polar", silent: compact, name: spec.series[0].name, barWidth: "78%",
      data: spec.series[0].values.map((value, index) => ({ value, itemStyle: { color: colors[index] } })),
    }],
  };
}

function cartesian(spec: AnalysisChartSpec, compact: boolean, tooltip: TooltipComponentOption): ChartOptions {
  const horizontal = spec.kind === "horizontal";
  const stacked = spec.kind === "stacked-area";
  const filled = stacked || spec.kind === "area";
  const line = filled || spec.kind === "line";
  const multiple = spec.series.length > 1;
  const zoom = spec.zoom && spec.labels.length > 12 && !compact;
  const categoryAxis = {
    type: "category" as const, data: [...spec.labels], inverse: horizontal, boundaryGap: !line,
    axisTick: { show: false }, axisLine: { lineStyle: { color: gridColor } },
    axisLabel: { ...axisLabel, fontSize: compact ? 9 : 11, width: horizontal ? (compact ? 54 : 91) : 78, overflow: "truncate" as const },
  };
  const series: (BarSeriesOption | LineSeriesOption)[] = spec.series.map((item, index) => {
    const color = item.color ?? spec.color;
    if (line) {
      return {
        type: "line", name: item.name, data: [...item.values], color, silent: compact,
        stack: stacked ? "composition" : undefined,
        lineStyle: { width: stacked ? 1.2 : compact ? 2 : 2.5, type: spec.forecast ? "dashed" : "solid" },
        areaStyle: filled ? { opacity: stacked ? 0.9 : 0.2 } : undefined,
        showSymbol: spec.labels.length <= 15, symbolSize: compact ? 4 : 6,
        markLine: spec.focus && !compact && index === 0 ? {
          silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#657686", type: "dashed" },
          data: [{ xAxis: spec.focus }],
        } : undefined,
      };
    }
    return {
      type: "bar", name: item.name, color, silent: compact,
      data: item.values.map((value, index) => spec.categoryColors?.[index]
        ? { value, itemStyle: { color: spec.categoryColors[index] } } : value),
      barMaxWidth: horizontal ? (compact ? 13 : 22) : (compact ? 26 : 48),
    };
  });
  return {
    tooltip: { ...tooltip, axisPointer: { type: line ? "line" : "shadow" } },
    legend: { type: "scroll", show: multiple && !compact, bottom: 2, textStyle: { color: ink, fontSize: 11 } },
    grid: {
      top: 13, bottom: compact ? 27 : zoom || multiple ? 58 : 35,
      left: horizontal ? (compact ? 65 : 105) : 49, right: compact ? 12 : 23,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : { ...valueAxis, scale: line && !filled },
    dataZoom: zoom ? periodSlider("x", Math.max(0, spec.labels.length - 60), spec.labels.length - 1)
      .map(item => multiple ? { ...item, bottom: 29 } : item) : undefined,
    series,
  };
}

export function chartOptions(spec: AnalysisChartSpec, compact: boolean): ChartOptions {
  const tooltip: TooltipComponentOption = {
    show: !compact, confine: true, renderMode: "richText", trigger: "axis",
    textStyle: { color: ink, fontSize: 12 }, valueFormatter: value => readValue(value, spec.unit),
  };
  const base = { animation: false, textStyle: { fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' } };
  switch (spec.kind) {
    case "heatmap": return { ...base, ...heatmap(spec, compact, tooltip) };
    case "map": return { ...base, ...mapOptions(spec, compact, tooltip) };
    case "bubble": return { ...base, ...bubble(spec, compact, tooltip) };
    case "treemap": return { ...base, ...treemap(spec, compact, tooltip) };
    case "rose": return { ...base, ...rose(spec, compact, tooltip) };
    default: return { ...base, ...cartesian(spec, compact, tooltip) };
  }
}
