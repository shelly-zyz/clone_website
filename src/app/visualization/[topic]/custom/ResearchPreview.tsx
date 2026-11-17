"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { EChartsType } from "echarts";
import type { VisualizationResult } from "@/lib/visualization-agent/research/contracts";
import { buildECharts } from "@/lib/visualization-agent/research/echarts";
import styles from "./research.module.css";

export function ResearchPreview({ figure, chart, onError }: {
  figure: VisualizationResult; chart: RefObject<EChartsType | null>; onError: () => void;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const interactive = figure.render.kind === "echarts";
  const model = figure.viewport.compact_model;

  useEffect(() => {
    const target = plot.current;
    if (!target || figure.render.kind !== "echarts") return;
    const option = figure.render.option;
    let observer: ResizeObserver | undefined;
    let instance: EChartsType | undefined;
    let stopped = false;
    let size: boolean | undefined;
    void import("echarts").then(({ init }) => {
      if (stopped) return;
      const update = () => {
        if (target.clientWidth === 0) return;
        const compact = target.clientWidth < 570;
        target.dataset.compact = String(compact);
        instance ??= init(target, undefined, { renderer: "canvas" });
        chart.current = instance;
        if (size !== compact) {
          size = compact;
          instance.setOption(compact && model ? buildECharts(model, figure.plan.design, true) : option, { notMerge: true });
        }
        instance.resize();
      };
      update();
      observer = new ResizeObserver(update);
      observer.observe(target);
    }).catch(() => { if (!stopped) onError(); });
    return () => {
      stopped = true;
      observer?.disconnect();
      instance?.dispose();
      if (chart.current === instance) chart.current = null;
    };
  }, [chart, figure, model, onError]);

  if (figure.render.kind === "image") return <picture className={styles.paper}>
    <img src={"data:image/svg+xml;base64," + figure.render.base64} alt={figure.recipe.title ?? figure.plan.reason} />
  </picture>;
  if (!interactive) return null;
  const multiple = figure.viewport.panels > 1;
  const rows = Math.min(6, figure.viewport.rows);
  const panels = Math.min(6, figure.viewport.panels);
  return <div className={styles.plot} ref={plot} data-panels={panels} data-rows={rows} data-multiple={multiple} aria-label="交互式图表" />;
}
