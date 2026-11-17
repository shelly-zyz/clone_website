"use client";

import { ArrowDownToLine, ArrowUpRight, Check, History } from "lucide-react";
import type { ExportFormat, VisualizationResult } from "@/lib/visualization-agent/research/contracts";
import { chartNames, layoutNames, themeNames } from "./research-controls";
import styles from "./research.module.css";

export type ListedFigure = { figure_id: string; title: string; revision: number; at: string };
export type SavedFigure = ListedFigure & { revisions: { id: string; revision: number; title: string; at: string }[] };
const numbers = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });
const localDay = (time: string | null) => time ? time.slice(0, 10) : "—";
const period = (time: string | null, grain: string) => time && grain === "year" ? time.slice(0, 4) + " 年"
  : time && grain === "month" ? time.slice(0, 7) : localDay(time);

export function ResearchInspector({ figure, saved }: { figure?: VisualizationResult; saved?: SavedFigure }) {
  if (!figure) return null;
  return <>
    <details className={styles.details} open>
      <summary>文字分析</summary>
      <div className={styles.findings}>
        {figure.insights.map(({ label, text, sources }, index) => <div key={index}>
          <strong>{label}</strong><p>{text}</p>
          <div className={styles.chips}>{sources.map(source => <a href={"#research-source-" + source} key={source}>来源 {source + 1}</a>)}</div>
        </div>)}
      </div>
    </details>
    <details className={styles.details}>
      <summary><Check size={14} aria-hidden /> 验证与样本</summary>
      <div className={styles.findings}>
        <p>{chartNames[figure.plan.chart]} · {layoutNames[figure.plan.layout]} · {themeNames[figure.plan.design.theme]}</p>
        <p>{figure.plan.skills.join(" · ")}</p>
        {figure.validation.warnings.map(warning => <p key={warning}>{warning}</p>)}
        {figure.plan.transformations.map(item => <p key={item}>{item}</p>)}
        {Object.entries(figure.statistics).filter(([name]) => /^(MAE |RMSE )/.test(name))
          .map(([name, value]) => <p key={name}>{name} · {numbers.format(value)}</p>)}
        {figure.plan.datasets.map((source, index) => <p key={index}>{source.title} · {source.sample_count - source.missing} 个有效样本 · 最小 {numbers.format(source.min)} · 最大 {numbers.format(source.max)} {source.unit}</p>)}
        <p>推荐图型 {figure.plan.candidates.map(kind => chartNames[kind]).join("、")}</p>
      </div>
    </details>
    <details className={styles.details} open>
      <summary>数据来源</summary>
      <div className={styles.findings}>
        {figure.plan.datasets.map((source, index) => <div key={index} id={"research-source-" + index}>
          <strong>{source.title}</strong>
          <p>{source.source_id} · {source.region_label ?? "所示范围"} · {source.unit}</p>
          <p>{source.is_forecast
            ? "预测时段 " + period(source.forecast_horizon?.start ?? null, source.dimensions.time_grain) + " 至 " + period(source.forecast_horizon?.end ?? null, source.dimensions.time_grain)
            : "数据时段 " + period(source.observation_time.start, source.dimensions.time_grain) + " 至 " + period(source.observation_time.end, source.dimensions.time_grain)}</p>
          {source.is_forecast && <p>起报或版次 {source.forecast_origin_period ?? source.forecast_origin} {source.model_version && " · " + source.model_version}</p>}
          {source.rules && <p>{source.rules}</p>}
          <p><span title={source.source_version}>版本 {source.source_version.slice(0, 12)}</span>
            {(source.last_updated_at || source.publication_time) && " · 更新于 " + localDay(source.last_updated_at ?? source.publication_time)}</p>
          <div className={styles.chips}>{source.source_url.map((url, linkIndex) => <a key={url} href={url} target="_blank" rel="noreferrer">
            查阅原始来源{source.source_url.length > 1 ? " " + (linkIndex + 1) : ""}<ArrowUpRight size={13} aria-hidden />
          </a>)}</div>
        </div>)}
      </div>
    </details>
    {saved && <details className={styles.details}>
      <summary><History size={14} aria-hidden /> 修改记录</summary>
      <div className={styles.findings}>{saved.revisions.toReversed().map(item => <p key={item.id}>
        修订 {item.revision} · {item.title} · {localDay(item.at)}
      </p>)}</div>
    </details>}
  </>;
}

export function ResearchExport({ figure, busy, onExport }: { figure: VisualizationResult; busy: boolean; onExport: (format: ExportFormat) => void }) {
  const formats = figure.render.kind === "echarts" ? [...figure.plan.output, "png" as const] : figure.plan.output;
  return <div className={styles.export} aria-label="导出格式">
    <ArrowDownToLine size={16} aria-hidden />
    {formats.map(format => <button type="button" key={format} disabled={busy} onClick={() => onExport(format)}
      aria-label={"导出 " + (format === "python" ? "Python" : format.toUpperCase())}>{format === "python" ? "Python" : format.toUpperCase()}</button>)}
  </div>;
}
