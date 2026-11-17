import type { LineSeriesOption } from "echarts/charts";
import type { TooltipComponentOption } from "echarts/components";
import { reading } from "@/lib/topic-analysis/data-story";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { powerTone } from "@/lib/topic-analysis/power";
import { analysisTone, interpolateColor, researchColors, researchInk, researchRule, verticalFill } from "@/lib/topic-analysis/research-palette";
import type { ChartOptions } from "./plot-options";

const axisLabel = { color: "#586b80", fontSize: 11, hideOverlap: true };
const valueAxis = { type: "value" as const, axisLabel, splitLine: { lineStyle: { color: researchRule } } };
const font = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';

export function powerPlotOptions(spec: AnalysisChartSpec, compact: boolean, highlight?: string): ChartOptions | undefined {
  const tooltip: TooltipComponentOption = {
    show: !compact, trigger: "item", confine: true, renderMode: "richText", backgroundColor: "#fffffff5",
    borderColor: researchRule, borderWidth: 1, textStyle: { color: researchInk, fontSize: 12 },
    valueFormatter: value => typeof value === "number" ? reading(value, spec.unit) : "未单列",
  };
  const base = { animation: false, textStyle: { fontFamily: font, color: researchInk } };
  if (spec.kind === "donut") {
    const total = spec.center.value ?? 0;
    const data = spec.labels.flatMap((name, index) => {
      const value = spec.series[0].values[index];
      return value !== null && value > 0 ? [{ name, value, colors: researchColors[analysisTone(name, index)] }] : [];
    });
    return {
      ...base,
      tooltip: { ...tooltip, formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        return typeof item.value === "number" ? `${item.name}\n${reading(item.value, spec.unit)} · ${reading(item.value / total * 100, "%")}` : "";
      } },
      title: { text: reading(total), subtext: spec.center.unit + " · " + spec.center.label, left: "center", top: "50%", textVerticalAlign: "middle",
        itemGap: 4, textStyle: { color: researchInk, fontSize: compact ? 13 : 20, fontWeight: 710 },
        subtextStyle: { color: axisLabel.color, fontSize: 10 } },
      series: [
        { type: "pie", radius: ["65%", "90%"], padAngle: 1.5, silent: compact, label: { show: false },
          emphasis: { scaleSize: 3 },
          data: data.map(({ name, value, colors }) => ({ name, value, itemStyle: {
            color: verticalFill(colors.light, colors.base), opacity: !highlight || name === highlight ? 1 : 0.43, borderRadius: 3,
          } })) },
        { type: "pie", radius: ["58%", "65%"], padAngle: 1.5, silent: true, label: { show: false },
          data: data.map(({ name, value, colors }) => ({ name, value, itemStyle: { color: colors.base, opacity: !highlight || name === highlight ? 0.78 : 0.28 } })) },
      ],
    };
  }
  if (spec.kind === "sankey") {
    return {
      ...base, tooltip: { ...tooltip, formatter: params => {
        const point = Array.isArray(params) ? params[0] : params;
        const edge = point.dataType === "edge" ? spec.links[point.dataIndex] : undefined;
        return `${edge ? `${edge.source} → ${edge.target}` : point.name}\n${typeof point.value === "number" ? reading(point.value, spec.unit) : ""}`;
      } },
      series: [{
        type: "sankey", silent: compact, draggable: false, nodeAlign: "justify", nodeWidth: 10, nodeGap: 11, left: 6, right: 65, top: 12, bottom: 10,
        label: { color: researchInk, fontSize: 10, width: 62, overflow: "truncate" }, emphasis: { focus: "adjacency", lineStyle: { opacity: 0.75 } },
        itemStyle: { borderWidth: 0 },
        data: spec.nodes.map((item, index) => ({ name: item.name, value: item.value, itemStyle: {
          color: spec.id === "capacity-waterfall" ? item.color : researchColors[analysisTone(item.name, index)].base,
        },
          label: { color: item.name === highlight ? researchColors[powerTone(highlight)].ink : researchInk,
            fontWeight: item.name === highlight || item.name === "净增量" ? 700 : 500 } })),
        links: spec.links.map(link => ({ ...link, lineStyle: { opacity: !highlight || link.source === highlight || link.target === `${highlight}减少` ? 0.53 : 0.23 } })),
        lineStyle: { color: "gradient", opacity: 0.5, curveness: 0.57 },
      }],
    };
  }
  if ((spec.kind === "horizontal" || spec.kind === "column") && spec.series.length === 1) {
    const horizontal = spec.kind === "horizontal";
    const values = spec.series[0].values;
    const extent = Math.max(1, ...values.map(value => Math.abs(value ?? 0)));
    const size = compact ? 7 : values.length > 20 ? 8 : 14;
    const showValue = !compact && (horizontal || values.length <= 12);
    const category = { type: "category" as const, data: [...spec.labels], inverse: horizontal,
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: {
        ...axisLabel, width: horizontal ? 92 : 59, overflow: "truncate" as const, fontSize: compact ? 9 : 11,
      } };
    const axis = { ...valueAxis, ...(spec.id === "generation-by-source" ? { min: 0, max: Math.ceil(extent / 1000) * 1000 } : {}),
      axisLabel: { ...axisLabel, formatter: (value: number) => Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value) } };
    return {
      ...base, tooltip: { ...tooltip, formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        return Array.isArray(item.value) ? `${item.name}\n${reading(Number(item.value[horizontal ? 0 : 1]), spec.unit)}` : "";
      } },
      grid: horizontal ? { left: compact ? 47 : 96, right: compact ? 12 : 63, top: 13, bottom: 29 }
        : { left: compact ? 34 : 49, right: 18, top: 29, bottom: 33 },
      xAxis: horizontal ? axis : category,
      yAxis: horizontal ? category : axis,
      series: [
        { type: "bar", barWidth: 1.6, data: [...values], silent: true, itemStyle: { color: "#cbd7e6" } },
        { type: "scatter", symbolSize: size, silent: compact, encode: { x: 0, y: 1 },
          data: values.flatMap((value, index) => {
            if (value === null) return [];
            const name = spec.labels[index];
            const selected = highlight === name || spec.focus === name;
            const ratio = Math.abs(value) / extent;
            const positive = value < 0 ? researchColors.rose : researchColors.lavender;
            return [{ name, value: horizontal ? [value, index] : [index, value],
              label: { position: horizontal ? (value < 0 ? "left" : "right") : (value < 0 ? "bottom" : "top") },
              itemStyle: { opacity: !highlight || selected ? 1 : .46,
                borderColor: selected ? researchColors.lavender.ink : "transparent", borderWidth: selected ? 2 : 0,
                color: { type: "radial" as const, x: .34, y: .25, r: .68, colorStops: [
                  { offset: 0, color: "#fff" }, { offset: .52, color: interpolateColor(researchColors.ice.light, positive.base, ratio) },
                  { offset: 1, color: interpolateColor(researchColors.ice.ink, positive.ink, ratio) },
                ] }, shadowBlur: 8, shadowColor: "#334c681e", shadowOffsetY: 3,
              } }];
          }),
          label: { show: showValue, distance: 6, color: researchInk, fontSize: 10,
            formatter: item => Array.isArray(item.value) ? reading(Number(item.value[horizontal ? 0 : 1])) : "" },
        },
      ],
    };
  }
  if (spec.kind === "line" || spec.kind === "area") {
    const power = spec.id === "capacity-comparison" || spec.id === "renewable-capacity-share";
    const ribbons = spec.id !== "capacity-comparison";
    const showMarkers = !compact && spec.labels.length <= 50;
    const legend = !compact && spec.series.length > 1;
    const zoom = !compact && spec.zoom && spec.labels.length > 12;
    const series: LineSeriesOption[] = spec.series.map((part, index) => {
      const color = researchColors[analysisTone(part.name, index)];
      const dimmed = Boolean(highlight && spec.series.some(item => item.name === highlight) && part.name !== highlight);
      return {
        type: "line", name: part.name, data: part.values.map((value, i) => ({ value, symbolSize: spec.labels[i] === spec.focus ? 10 : ribbons ? 6 : 4 })),
        silent: compact, color: color.base, smooth: spec.id === "renewable-capacity-share" ? 0.3 : false, smoothMonotone: "x", showSymbol: showMarkers,
        connectNulls: false, symbol: "circle", lineStyle: { color: color.ink, width: 2.2, type: spec.forecast ? "dashed" : "solid", opacity: dimmed ? 0.36 : 0.9 },
        itemStyle: { color: color.base, borderColor: "#fff", borderWidth: 1.5, opacity: dimmed ? 0.36 : 1 },
        areaStyle: spec.forecast || spec.series.length > 3 && !power ? undefined : { color: verticalFill(color.base, `${color.light}22`), opacity: dimmed ? 0.12 : ribbons ? 0.48 : 0.22,
          shadowColor: `${color.ink}18`, shadowBlur: 10, shadowOffsetY: 5 },
        markLine: spec.focus && index === 0 && !compact ? { silent: true, symbol: "none", label: { show: false },
          data: [{ xAxis: spec.focus }], lineStyle: { type: "dashed", color: "#7b91c7" } } : undefined,
      };
    });
    return {
      ...base, tooltip: { ...tooltip, trigger: "axis" },
      grid: { top: 15, bottom: compact ? 24 : zoom ? (legend ? 69 : 53) : legend ? 48 : 32, left: compact ? 41 : 49, right: 24 },
      xAxis: { type: "category", boundaryGap: false, data: [...spec.labels], axisTick: { show: false }, axisLabel,
        axisLine: { lineStyle: { color: researchRule } } },
      yAxis: { ...valueAxis, ...(power ? { min: 0 } : { scale: true }),
        axisLabel: { ...axisLabel, formatter: (value: number) => Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value)
          + (spec.unit === "%" ? "%" : "") } },
      legend: { type: "scroll", show: legend, selectedMode: !power, bottom: 3, textStyle: { color: researchInk } },
      series,
    };
  }
}
