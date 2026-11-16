import type { LineSeriesOption } from "echarts/charts";
import type { TooltipComponentOption } from "echarts/components";
import { reading } from "@/lib/topic-analysis/data-story";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { powerTone } from "@/lib/topic-analysis/power";
import { interpolateColor, researchColors, researchInk, researchRule, verticalFill } from "@/lib/topic-analysis/research-palette";
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
  if (spec.id === "capacity-mix" && spec.kind === "donut") {
    const total = spec.center.value ?? 0;
    const data = spec.labels.flatMap((name, index) => {
      const value = spec.series[0].values[index];
      return value !== null && value > 0 ? [{ name, value, colors: researchColors[powerTone(name)] }] : [];
    });
    return {
      ...base,
      tooltip: { ...tooltip, formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        return typeof item.value === "number" ? `${item.name}\n${reading(item.value, "GW")} · ${reading(item.value / total * 100, "%")}` : "";
      } },
      title: { text: reading(total), subtext: "GW · 年末总装机", left: "center", top: "50%", textVerticalAlign: "middle",
        itemGap: 4, textStyle: { color: researchInk, fontSize: compact ? 15 : 21, fontWeight: 710 },
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
  if (spec.id === "capacity-waterfall" && spec.kind === "sankey") {
    return {
      ...base, tooltip: { ...tooltip, formatter: params => {
        const point = Array.isArray(params) ? params[0] : params;
        const edge = point.dataType === "edge" ? spec.links[point.dataIndex] : undefined;
        return `${edge ? `${edge.source} → ${edge.target}` : point.name}\n${typeof point.value === "number" ? reading(point.value, spec.unit) : ""}`;
      } },
      series: [{
        type: "sankey", draggable: false, nodeAlign: "justify", nodeWidth: 10, nodeGap: 11, left: 6, right: 65, top: 12, bottom: 10,
        label: { color: researchInk, fontSize: 10, width: 62, overflow: "truncate" }, emphasis: { focus: "adjacency", lineStyle: { opacity: 0.75 } },
        itemStyle: { borderWidth: 0 },
        data: spec.nodes.map(item => ({ name: item.name, value: item.value, itemStyle: { color: item.color },
          label: { color: item.name === highlight ? researchColors[powerTone(highlight)].ink : researchInk,
            fontWeight: item.name === highlight || item.name === "净增量" ? 700 : 500 } })),
        links: spec.links.map(link => ({ ...link, lineStyle: { opacity: !highlight || link.source === highlight || link.target === `${highlight}减少` ? 0.53 : 0.23 } })),
        lineStyle: { color: "gradient", opacity: 0.5, curveness: 0.57 },
      }],
    };
  }
  if (spec.id === "generation-by-source") {
    const values = spec.series[0].values;
    const extent = Math.max(1, ...values.map(value => value ?? 0));
    return {
      ...base, tooltip: { ...tooltip, formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        return Array.isArray(item.value) ? `${item.name}\n${reading(Number(item.value[0]), "TWh")}` : "";
      } },
      grid: { left: 64, right: 76, top: 14, bottom: 31 },
      xAxis: { ...valueAxis, min: 0, max: Math.ceil(extent / 1000) * 1000 },
      yAxis: { type: "category", data: [...spec.labels], inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel },
      series: [
        { type: "bar", barWidth: 1.5, data: [...values], silent: true, itemStyle: { color: "#ccd8e5" } },
        { type: "scatter", symbolSize: 18, encode: { x: 0, y: 1 },
          data: values.flatMap((value, index) => value === null ? [] : [{ name: spec.labels[index], value: [value, index], itemStyle: {
            opacity: !highlight || highlight === spec.labels[index] ? 1 : 0.42,
            color: { type: "radial" as const, x: 0.34, y: 0.25, r: 0.68, colorStops: [
              { offset: 0, color: "#fff" }, { offset: 0.52, color: interpolateColor(researchColors.ice.light, researchColors.rose.base, value / extent) },
              { offset: 1, color: interpolateColor(researchColors.ice.ink, researchColors.rose.ink, value / extent) },
            ] }, shadowBlur: 8, shadowColor: "#334c681e", shadowOffsetY: 3,
          } }]),
          label: { show: true, position: "right", distance: 7, color: researchInk, fontSize: 11,
            formatter: item => Array.isArray(item.value) ? reading(Number(item.value[0])) : "" },
        },
      ],
    };
  }
  if (spec.id === "capacity-comparison" || spec.id === "renewable-capacity-share") {
    const ribbons = spec.id === "renewable-capacity-share";
    const series: LineSeriesOption[] = spec.series.map((part, index) => {
      const color = researchColors[powerTone(part.name)];
      const dimmed = Boolean(highlight && spec.series.some(item => item.name === highlight) && part.name !== highlight);
      return {
        type: "line", name: part.name, data: part.values.map((value, i) => ({ value, symbolSize: spec.labels[i] === spec.focus ? 10 : ribbons ? 6 : 4 })),
        silent: compact, color: color.base, smooth: ribbons ? 0.3 : false, smoothMonotone: "x", showSymbol: !compact,
        connectNulls: false, symbol: "circle", lineStyle: { color: color.ink, width: 2, opacity: dimmed ? 0.36 : 0.9 },
        itemStyle: { color: color.base, borderColor: "#fff", borderWidth: 1.5, opacity: dimmed ? 0.36 : 1 },
        areaStyle: { color: verticalFill(color.base, `${color.light}22`), opacity: dimmed ? 0.16 : ribbons ? 0.62 : 0.22,
          shadowColor: `${color.ink}18`, shadowBlur: 10, shadowOffsetY: 5 },
        markLine: spec.focus && index === 0 && !compact ? { silent: true, symbol: "none", label: { show: false },
          data: [{ xAxis: spec.focus }], lineStyle: { type: "dashed", color: "#7b91c7" } } : undefined,
      };
    });
    return {
      ...base, tooltip: { ...tooltip, trigger: "axis" },
      grid: { top: 15, bottom: compact ? 24 : 44, left: compact ? 41 : 49, right: 24 },
      xAxis: { type: "category", boundaryGap: false, data: [...spec.labels], axisTick: { show: false }, axisLabel,
        axisLine: { lineStyle: { color: researchRule } } },
      yAxis: { ...valueAxis, min: 0, ...(ribbons ? { axisLabel: { ...axisLabel, formatter: "{value}%" } } : {}) },
      legend: { show: ribbons && !compact, selectedMode: false, bottom: 3, textStyle: { color: researchInk } },
      series,
    };
  }
}
