"use client";

import { BarChart, HeatmapChart, LineChart, MapChart, ScatterChart, TreemapChart } from "echarts/charts";
import { DataZoomComponent, GeoComponent, GridComponent, LegendComponent, MarkLineComponent, PolarComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { getMap, init, registerMap, use as registerCharts, type ECElementEvent, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef, useState } from "react";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { chartOptions, worldMap } from "./plot-options";
import styles from "./page.module.css";

registerCharts([
  BarChart, HeatmapChart, LineChart, MapChart, ScatterChart, TreemapChart, CanvasRenderer,
  DataZoomComponent, GeoComponent, GridComponent, LegendComponent, MarkLineComponent, PolarComponent, TooltipComponent, VisualMapComponent,
]);

type WorldGeometry = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { ADM0_A3: string }; geometry: unknown }[];
};
let worldRequest: Promise<void> | undefined;

function loadWorld() {
  if (getMap(worldMap)) return Promise.resolve();
  worldRequest ??= fetch("/data/natural-earth/ne_50m_admin_0_countries.geojson").then(async response => {
    if (!response.ok) throw new Error("Map unavailable");
    const geometry = await response.json() as WorldGeometry;
    geometry.features = geometry.features.filter(feature => feature.properties?.ADM0_A3 !== "ATA");
    registerMap(worldMap, JSON.stringify(geometry));
  }).catch((error: unknown) => {
    worldRequest = undefined;
    throw error;
  });
  return worldRequest;
}

export function AnalysisPlot({ spec, compact = false, onRegion }: {
  spec: AnalysisChartSpec;
  compact?: boolean;
  onRegion?: (label: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const [visible, setVisible] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!visible || !element) return;
    const instance = init(element, undefined, { renderer: "canvas" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [visible]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    if (spec.kind !== "map") {
      instance.setOption(chartOptions(spec, compact), { notMerge: true });
      if (spec.kind !== "bubble" || !onRegion || compact) return;
      const onClick = (event: ECElementEvent) => onRegion(event.name);
      instance.on("click", onClick);
      return () => { instance.off("click", onClick); };
    }
    let active = true;
    loadWorld().then(() => {
      if (active) instance.setOption(chartOptions(spec, compact), { notMerge: true });
    }).catch(() => {
      if (active) setMapError(true);
    });
    const onClick = (event: ECElementEvent) => {
      const index = spec.mapIds.indexOf(String(event.name));
      if (index >= 0 && spec.series[0].values[index] !== null) onRegion?.(spec.labels[index]);
    };
    if (onRegion && !compact) instance.on("click", onClick);
    return () => {
      active = false;
      instance.off("click", onClick);
    };
  }, [visible, spec, compact, mapAttempt, onRegion]);

  return (
    <div className={compact ? styles.previewPlot : styles.chartPlot} data-chart-kind={spec.kind}>
      <div ref={container} className={styles.plotCanvas} aria-hidden={compact || undefined}
        role={compact ? undefined : "img"} aria-label={compact ? undefined : spec.title} />
      {mapError && !compact && (
        <p className={styles.mapError}>地图边界加载失败。<button type="button" onClick={() => {
          setMapError(false);
          setMapAttempt(attempt => attempt + 1);
        }}>重新加载</button></p>
      )}
    </div>
  );
}
