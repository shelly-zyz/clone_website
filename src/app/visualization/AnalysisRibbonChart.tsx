"use client";

import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { reading } from "@/lib/topic-analysis/data-story";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { AnalysisPlot } from "./AnalysisPlot";
import { mountAnalysisRibbonScene } from "./analysis-ribbon-scene";
import styles from "./power.module.css";

export function AnalysisRibbonChart({ spec, highlight, select }: {
  spec: AnalysisChartSpec;
  highlight?: string;
  select?: (period: string, series?: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof mountAnalysisRibbonScene>>(undefined);
  const selection = useRef(select);
  const view = useRef({ year: spec.focus, highlight });
  const [mode, setMode] = useState<"3d" | "2d" | "unavailable">("3d");
  const [current, setCurrent] = useState<{ year: string; source: string; value: number }>();
  const { id, labels, series, title, unit } = spec;
  const capacity = id === "capacity-comparison";

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
        scene.current = mountAnalysisRibbonScene(element, labels, series, unit, capacity, {
          inspect: setCurrent,
          select: point => selection.current?.(point.year, point.source),
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
  }, [capacity, labels, series, unit, mode]);

  return <div className={styles.ribbons} data-renderer={mode === "3d" ? "webgl" : "echarts"}>
    <div className={styles.ribbonStage}>
      {mode === "3d" ? <>
        <div className={styles.ribbonCanvas} ref={host} role="img" aria-label={title + "，三维分层曲带，单位 " + unit} />
        {current && <div className={styles.ribbonReading}>
          <span>{current.year}{/^\d{4}$/.test(current.year) && " 年"} · {current.source}</span><strong>{reading(current.value, unit)}</strong>
        </div>}
      </> : <AnalysisPlot spec={spec} highlight={highlight} onCategory={select ? period => select(period) : undefined} />}
    </div>
    <div className={styles.ribbonActions}>
      <p>{mode === "3d" ? (select ? "拖动旋转 · 点击采样点联动筛选" : "拖动旋转 · 悬停采样点查看数值") : select ? "点击采样点联动筛选" : "二维曲带"}</p>
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
