"use client";

import { ChevronDown, Table2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { chartStory } from "@/lib/topic-analysis/chart-story";
import { reading } from "@/lib/topic-analysis/data-story";
import { formatAnalysisValue, hasChartValues, type AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { analysisTone, hasLayeredRibbons } from "@/lib/topic-analysis/research-palette";
import { AnalysisInsights, AnalysisNarrative } from "./AnalysisNarrative";
import { AnalysisPlot } from "./AnalysisPlot";
import styles from "./page.module.css";
import powerStyles from "./power.module.css";

const RibbonChart = dynamic(() => import("./AnalysisRibbonChart").then(module => module.AnalysisRibbonChart), {
  ssr: false, loading: () => <div className={powerStyles.ribbonStage} />,
});

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

export function AnalysisFigure({ spec, primary, lead, empty, onCategory, controls }: {
  spec: AnalysisChartSpec;
  primary?: boolean;
  lead?: boolean;
  empty?: string;
  controls?: ReactNode;
  onCategory?: (label: string, row?: string) => void;
}) {
  const hasValues = hasChartValues(spec);
  const story = chartStory(spec, empty);
  const [seriesFocus, setSeriesFocus] = useState<string>();
  const ribbons = hasLayeredRibbons(spec.id) && spec.labels.length >= 2 &&
    spec.series.every(series => series.values.every(value => value === null || value >= 0));
  const composition = spec.kind === "donut" ? spec : undefined;
  const focus = composition?.labels.includes(spec.focus ?? "") ? spec.focus : undefined;
  return (
    <figure id={spec.id} className={`${powerStyles.figure} ${powerStyles.topicFigure}`} data-lead={lead || undefined}
      data-active-view={primary || undefined} aria-labelledby={spec.id + "-title"}>
      <header className={powerStyles.figureHeader}>
        <div><p>{spec.label}</p><h2 id={spec.id + "-title"}>{spec.title}</h2></div>
        <span className={powerStyles.yearBadge}>{spec.kind === "bubble" ? spec.xUnit + " / " + spec.unit : spec.unit}</span>
      </header>
      {controls && <div className={styles.chartControls} role="group" aria-label="对比筛选">{controls}</div>}
      <div className={powerStyles.figureBody}>
        {!hasValues ? <p className={powerStyles.empty}>{empty ?? "当前筛选范围暂无已发布数值。"}</p>
          : ribbons ? <div>
            <RibbonChart spec={spec} highlight={seriesFocus} select={onCategory} />
            <div className={powerStyles.sourceButtons} role="group" aria-label="选择曲带">
              {spec.series.map((series, index) => <button key={series.name} type="button" data-tone={analysisTone(series.name, index)}
                aria-pressed={seriesFocus === series.name} onClick={() => setSeriesFocus(value => value === series.name ? undefined : series.name)}>
                <i aria-hidden />{series.name}
              </button>)}
            </div>
          </div>
          : composition ? <div className={`${powerStyles.composition} ${powerStyles.topicComposition}`}>
            <div className={powerStyles.plot}><AnalysisPlot spec={spec} onCategory={onCategory} highlight={focus} /></div>
            <ul className={`${powerStyles.ringLegend} ${powerStyles.topicRingLegend}`} aria-label="图示构成">
              {composition.labels.map((label, index) => {
                const value = composition.series[0].values[index];
                const total = composition.center.value ?? 0;
                if (value == null || value <= 0) return null;
                const row = <><i aria-hidden /><span>{label}<small>{reading(value, spec.unit)}</small></span>
                  <b>{total > 0 ? reading(value / total * 100, "%") : "暂无"}</b></>;
                return <li key={label} data-tone={analysisTone(label, index)}>
                  {onCategory ? <button type="button" aria-pressed={label === focus} onClick={() => onCategory(label)}>{row}</button>
                    : <div className={powerStyles.ringRow}>{row}</div>}
                </li>;
              })}
            </ul>
          </div> : <div className={powerStyles.plot}><AnalysisPlot spec={spec} onCategory={onCategory} /></div>}
        <AnalysisInsights id={spec.id} story={story} />
      </div>
      <figcaption className={powerStyles.caption}>{spec.caption}</figcaption>
      <div className={powerStyles.figureFooter}>
        <AnalysisNarrative story={story} caption={spec.caption} sources={spec.sources} />
        {hasValues && <AnalysisTable spec={spec} />}
      </div>
    </figure>
  );
}
