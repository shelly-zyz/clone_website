"use client";

import { BarChart, LineChart, TreemapChart, type BarSeriesOption, type LineSeriesOption, type TreemapSeriesOption } from "echarts/charts";
import {
  GridComponent, LegendComponent, MarkLineComponent, TooltipComponent,
  type GridComponentOption, type LegendComponentOption, type MarkLineComponentOption, type TooltipComponentOption,
} from "echarts/components";
import { init, use as registerCharts, type ComposeOption, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/data";
import styles from "./page.module.css";

registerCharts([BarChart, LineChart, TreemapChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

type ChartOptions = ComposeOption<
  BarSeriesOption | LineSeriesOption | TreemapSeriesOption | GridComponentOption | LegendComponentOption | MarkLineComponentOption | TooltipComponentOption
>;
const values = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const compactValues = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const ink = "#31464e";
const gridColor = "#e0e7e8";
const axisLabel = { color: ink, fontSize: 11 };
const valueAxis = { type: "value" as const, axisLabel: { ...axisLabel, formatter: (value: number) => compactValues.format(value) },
  splitLine: { lineStyle: { color: gridColor } } };

function options(spec: AnalysisChartSpec, compact: boolean): ChartOptions {
  const tooltip: TooltipComponentOption = {
    show: !compact,
    confine: true,
    renderMode: "richText",
    trigger: spec.kind === "treemap" ? "item" : "axis",
    valueFormatter: value => typeof value === "number" ? values.format(value) + " " + spec.unit : "暂无",
  };
  if (spec.kind === "treemap") {
    const data = spec.labels.flatMap((name, index) => {
      const value = spec.series[0].values[index];
      return value === null ? [] : [{ name, value, itemStyle: { color: spec.categoryColors?.[index] ?? spec.color } }];
    });
    return {
      animation: false, tooltip,
      series: [{
        type: "treemap", data, left: 0, right: 0, top: 1, bottom: 0,
        roam: false, nodeClick: false, breadcrumb: { show: false }, silent: compact,
        label: { show: true, color: "#fff", fontSize: compact ? 11 : 13 },
        itemStyle: { gapWidth: 2, borderColor: "#fff" },
      }],
    };
  }

  const horizontal = spec.kind === "horizontal";
  const line = spec.kind === "line";
  const multiple = spec.series.length > 1;
  const categoryAxis = {
    type: "category" as const, data: [...spec.labels], inverse: horizontal, boundaryGap: !line,
    axisTick: { show: false }, axisLine: { lineStyle: { color: gridColor } },
    axisLabel: { ...axisLabel, hideOverlap: true, width: horizontal ? 88 : 64, overflow: "truncate" as const },
  };
  const series: (BarSeriesOption | LineSeriesOption)[] = spec.series.map(item => {
    const color = item.color ?? spec.color;
    if (line) {
      return {
        type: "line", name: item.name, data: [...item.values], color, silent: compact,
        lineStyle: { width: compact ? 2 : 3, type: spec.forecast ? "dashed" : "solid" },
        areaStyle: compact ? { opacity: 0.09 } : undefined,
        showSymbol: spec.labels.length <= 12, symbolSize: compact ? 4 : 6,
        markLine: spec.focus && !compact ? {
          silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#6f8087", type: "dashed" },
          data: [{ xAxis: spec.focus }],
        } : undefined,
      };
    }
    return {
      type: "bar", name: item.name, color, silent: compact,
      data: item.values.map((value, index) => spec.categoryColors?.[index]
        ? { value, itemStyle: { color: spec.categoryColors[index] } } : value),
      barMaxWidth: compact ? 38 : 48,
    };
  });
  return {
    animation: false,
    tooltip: { ...tooltip, axisPointer: { type: line ? "line" : "shadow" } },
    legend: { show: multiple && !compact, bottom: 1, textStyle: { color: ink } },
    grid: {
      top: 13, bottom: multiple && !compact ? 56 : 30,
      left: horizontal ? 100 : 48, right: compact ? 13 : 24,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : { ...valueAxis, scale: line },
    series,
  };
}

export function AnalysisPlot({ spec, compact = false }: { spec: AnalysisChartSpec; compact?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = init(element, undefined, { renderer: "canvas" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => { chart.current?.setOption(options(spec, compact), { notMerge: true }); }, [spec, compact]);

  return (
    <div className={compact ? styles.previewPlot : styles.chartPlot} ref={container}
      aria-hidden={compact ? true : undefined} role={compact ? undefined : "img"} aria-label={compact ? undefined : spec.title} />
  );
}
