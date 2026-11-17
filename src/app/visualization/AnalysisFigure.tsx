"use client";

import { ChevronDown, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { chartStory } from "@/lib/topic-analysis/chart-story";
import { formatAnalysisValue, hasChartValues, type AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { AnalysisInsights, AnalysisNarrative } from "./AnalysisNarrative";
import { AnalysisPlot } from "./AnalysisPlot";
import styles from "./page.module.css";

export function AnalysisTable({ spec }: { spec: AnalysisChartSpec }) {
  const [expanded, setExpanded] = useState(false);
  const names = spec.kind === "heatmap" ? spec.labels.map(String) : spec.series.map((series, index) => {
    const unit = series.unit ?? (spec.kind === "bubble" && index === 0 ? spec.xUnit : spec.unit);
    return `${series.name}（${unit}）`;
  });
  if (spec.kind === "bubble") names.push(`${spec.sizeName}（${spec.sizeUnit}）`);
  const rows = spec.kind === "heatmap"
    ? spec.series.map(item => ({ label: item.name, values: item.values }))
    : spec.labels.map((label, index) => {
      const values = spec.series.map(item => item.values[index] ?? null);
      if (spec.kind === "bubble") values.push(spec.sizes[index] ?? null);
      return { label, values };
    });
  return (
    <details className={styles.chartData} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className={styles.disclosure}>
        <Table2 size={14} strokeWidth={1.8} aria-hidden="true" />
        查看数值 <ChevronDown className={styles.chevron} size={14} strokeWidth={1.8} aria-hidden="true" />
      </summary>
      {expanded && (
        <div className={styles.tableScroll}>
          <table aria-label={spec.title + " 数值"}>
            <thead>
              <tr>
                <th scope="col">分组</th>
                {names.map(name => <th scope="col" key={name}>{name}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, values }, row) => (
                <tr key={row}>
                  <th scope="row">{label}</th>
                  {values.map((value, index) => <td key={index}>{formatAnalysisValue(value)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export function AnalysisFigure({ spec, primary, empty, onCategory, controls }: {
  spec: AnalysisChartSpec;
  primary?: boolean;
  empty?: string;
  controls?: ReactNode;
  onCategory?: (label: string, row?: string) => void;
}) {
  const hasValues = hasChartValues(spec);
  const story = chartStory(spec, empty);
  return (
    <figure id={spec.id} className={primary ? styles.primaryChart : styles.chartCard} data-active-view={primary || undefined} aria-labelledby={spec.id + "-title"}>
      <div className={styles.chartHead}>
        <h2 id={spec.id + "-title"}>{spec.title}</h2>
        <span className={styles.chartUnit}>{spec.kind === "bubble" ? "交互气泡图" : spec.unit}</span>
      </div>
      {controls && <div className={styles.chartControls} role="group" aria-label="对比筛选">{controls}</div>}
      <div className={styles.figureAnalysis}>
        {hasValues ? <AnalysisPlot spec={spec} onCategory={onCategory} />
          : <p className={styles.chartEmpty}>{empty ?? "当前筛选范围暂无已发布数值。"}</p>}
        <AnalysisInsights id={spec.id} story={story} />
      </div>
      <figcaption className={styles.chartCaption}>{spec.caption}</figcaption>
      <div className={styles.chartFooter}>
        <AnalysisNarrative story={story} caption={spec.caption} sources={spec.sources} />
        {hasValues && <AnalysisTable spec={spec} />}
      </div>
    </figure>
  );
}
