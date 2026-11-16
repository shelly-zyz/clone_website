"use client";

import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { reading } from "@/lib/topic-analysis/data-story";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { AnalysisPlot } from "./AnalysisPlot";
import { mountPowerRibbonScene } from "./power-ribbon-scene";
import styles from "./power.module.css";

export function PowerRibbonChart({ spec, highlight, select }: {
  spec: AnalysisChartSpec;
  highlight?: string;
  select: (year: string, source?: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof mountPowerRibbonScene>>(undefined);
  const selection = useRef(select);
  const view = useRef({ year: spec.focus, highlight });
  const [mode, setMode] = useState<"3d" | "2d" | "unavailable">("3d");
  const [current, setCurrent] = useState<{ year: string; source: string; value: number }>();
  const { labels, series } = spec;

  useEffect(() => { selection.current = select; }, [select]);
  useEffect(() => {
    view.current = { year: spec.focus, highlight };
    scene.current?.update(spec.focus, highlight);
  }, [spec.focus, highlight]);

  useEffect(() => {
    const element = host.current;
    if (mode !== "3d" || !element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      try {
        scene.current = mountPowerRibbonScene(element, labels, series, {
          inspect: setCurrent,
          select: point => selection.current(point.year, point.source),
          unavailable: () => setMode("unavailable"),
        });
      } catch { scene.current = undefined; }
      if (!scene.current) setMode("unavailable");
      else scene.current.update(view.current.year, view.current.highlight);
    }, { rootMargin: "140px" });
    observer.observe(element);
    return () => {
      observer.disconnect();
      scene.current?.dispose();
      scene.current = undefined;
    };
  }, [labels, series, mode]);

  return <div className={styles.ribbons} data-renderer={mode === "3d" ? "webgl" : "echarts"}>
    <div className={styles.ribbonStage}>
      {mode === "3d" ? <>
        <div className={styles.ribbonCanvas} ref={host} role="img" aria-label="按年份和电源分层的三维装机容量图，单位 GW" />
        {current && <div className={styles.ribbonReading}>
          <span>{current.year} 年 · {current.source}</span><strong>{reading(current.value, "GW")}</strong>
        </div>}
      </> : <AnalysisPlot spec={spec} highlight={highlight} onCategory={year => select(year)} />}
    </div>
    <div className={styles.ribbonActions}>
      <p>{mode === "3d" ? "横向拖动旋转 · 点击年度采样点" : mode === "unavailable" ? "当前设备以二维展示同一组年度数据" : "点击年度采样点切换年份"}</p>
      <div role="group" aria-label="曲面视角">
        {mode === "3d" && <>
          <button type="button" aria-label="向左旋转" title="向左旋转" onClick={() => scene.current?.rotate(-1)}><ChevronLeft size={15} /></button>
          <button type="button" aria-label="向右旋转" title="向右旋转" onClick={() => scene.current?.rotate(1)}><ChevronRight size={15} /></button>
          <button type="button" aria-label="缩小图形" title="缩小" onClick={() => scene.current?.zoom(0.9)}><Minus size={15} /></button>
          <button type="button" aria-label="放大图形" title="放大" onClick={() => scene.current?.zoom(1.1)}><Plus size={15} /></button>
          <button type="button" aria-label="还原视角" title="还原视角" onClick={() => scene.current?.reset()}><RotateCcw size={14} /></button>
        </>}
        {mode !== "unavailable" && <button type="button" className={styles.viewMode} onClick={() => {
          setCurrent(undefined);
          setMode(mode === "3d" ? "2d" : "3d");
        }}>{mode === "3d" ? "二维视图" : "三维视图"}</button>}
      </div>
    </div>
  </div>;
}
