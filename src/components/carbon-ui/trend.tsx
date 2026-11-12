"use client";

import { useEffect, useRef } from "react";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { init, use as registerECharts, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { CarbonState } from "./components";
import styles from "./carbon-ui.module.css";

registerECharts([LineChart, AriaComponent, GridComponent, TooltipComponent, CanvasRenderer]);

export type CarbonTrendPoint = { label: string; value: number | null };

export function CarbonTrend({ label, unit, points, theme = "dark" }: {
  label: string;
  unit: string;
  points: readonly CarbonTrendPoint[];
  theme?: "dark" | "light";
}) {
  if (!points.some((point) => point.value !== null)) {
    return <CarbonState kind="empty" title="暂无趋势数据" />;
  }

  return <TrendCanvas label={label} unit={unit} points={points} theme={theme} />;
}

function TrendCanvas({ label, unit, points, theme }: {
  label: string;
  unit: string;
  points: readonly CarbonTrendPoint[];
  theme: "dark" | "light";
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const instance = init(container.current);
    chart.current = instance;

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!container.current || !chart.current) return;
    const tokens = getComputedStyle(container.current);
    const line = tokens.getPropertyValue("--carbon-chart-line").trim();
    const fill = tokens.getPropertyValue("--carbon-chart-fill").trim();
    const text = tokens.getPropertyValue("--carbon-muted").trim();
    const grid = tokens.getPropertyValue("--carbon-line").trim();
    const format = new Intl.NumberFormat("zh-CN");

    chart.current.setOption({
      animation: false,
      aria: { enabled: true },
      textStyle: { color: text, fontFamily: "Inter, system-ui, sans-serif" },
      grid: { top: 20, bottom: 10, left: 6, right: 16, outerBoundsMode: "same" },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        confine: true,
        valueFormatter: (value: unknown) => typeof value === "number" ? `${format.format(value)} ${unit}` : "—",
      },
      xAxis: {
        type: "category",
        data: points.map((point) => point.label),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: grid } },
        axisLabel: { hideOverlap: true, color: text },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: grid, type: "dashed" } },
      },
      series: [{
        name: `${label}（${unit}）`,
        type: "line",
        data: points.map((point) => point.value),
        showSymbol: points.length <= 12,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2.5, color: line },
        itemStyle: { color: line },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: fill }, { offset: 1, color: "transparent" }],
          },
        },
      }],
    });
  }, [label, unit, points, theme]);

  return <div ref={container} className={styles.trend} role="img" aria-label={`${label}，单位 ${unit}`} />;
}
