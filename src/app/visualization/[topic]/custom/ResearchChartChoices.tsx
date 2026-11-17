"use client";

import {
  ChartArea, ChartBar, ChartCandlestick, ChartColumn, ChartLine, ChartScatter, ChartSpline, Check, CloudSun,
  Factory, Gauge, GitBranch, Grid3X3, CalendarDays, Radar, Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  chartKinds, domains, type ChartKind, type DatasetProfile, type Domain, type VisualizationJob,
} from "@/lib/visualization-agent/research/contracts";
import { chartNames, chartRequirement, chartUses, domainNames, examples, topicCharts } from "./research-controls";
import styles from "./research.module.css";

const topicIcons = { electricity: Zap, meteorology: CloudSun, carbon: Factory, economy: ChartLine };
const chartIcons = {
  stack: ChartArea, columns: ChartColumn, rank: ChartBar, dumbbell: ChartScatter, trend: ChartLine, box: ChartCandlestick,
  violin: ChartCandlestick, density: ChartArea, scatter: ChartScatter, correlation: Grid3X3, forecast: ChartSpline,
  "forecast-diagnostics": ChartCandlestick, waterfall: ChartColumn, flow: GitBranch, calendar: CalendarDays,
  grid: Grid3X3, surface: ChartArea, rose: Radar, "trend-distribution": Gauge,
} satisfies Record<ChartKind, typeof ChartLine>;

export function ResearchChartChoices({ domain, draft, profiles, paperAvailable, busy, generate, onDomain, onExample, onChart }: {
  domain: Domain;
  draft: VisualizationJob["configuration"];
  profiles?: DatasetProfile[];
  paperAvailable?: boolean;
  busy: boolean;
  generate: ReactNode;
  onDomain: (domain: Domain) => void;
  onExample: (index: number) => void;
  onChart: (kind: ChartKind) => void;
}) {
  const reason = (kind: ChartKind) => chartRequirement(kind, draft.datasets, profiles)
    ?? (paperAvailable === false && (kind === "density" || kind === "violin") ? "此图需要论文绘图引擎" : undefined);
  const proposed = topicCharts[domain].map(kind => ({ kind, reason: reason(kind) }));
  const ready = proposed.filter(item => !item.reason);
  const remaining = proposed.filter(item => item.reason);
  const featured = [...ready, ...remaining].slice(0, 5);
  if (draft.kind && draft.kind !== "auto" && !featured.some(item => item.kind === draft.kind)) {
    featured.splice(4, 1, { kind: draft.kind, reason: reason(draft.kind) });
  }
  const more = chartKinds.filter(kind => kind !== "surface" && !featured.some(item => item.kind === kind));
  return <section className={styles.choices} aria-label="专题与图样" data-domain={domain}>
    <div className={styles.choiceHeading}>
      <h3>制图专题</h3>
      <label className={styles.exampleSelect}><span>示例数据</span>
        <select value="" disabled={busy} onChange={event => onExample(Number(event.target.value))}>
          <option value="" disabled>载入 {domainNames[domain]}示例</option>
          {examples[domain].map(({ label }, index) => <option key={label} value={index}>{label}</option>)}
        </select>
      </label>
    </div>
    <div className={styles.topicChoices} role="group" aria-label="选择专题">
      {domains.map(item => {
        const Icon = topicIcons[item];
        return <button key={item} type="button" aria-pressed={domain === item} disabled={busy} onClick={() => onDomain(item)}>
          <Icon size={17} aria-hidden />{domainNames[item]}
        </button>;
      })}
    </div>
    <div className={styles.choiceHeading}>
      <h3>推荐图样</h3>
      <div className={styles.choiceActions}>
        <span>{draft.kind && draft.kind !== "auto" ? "已选 " + chartNames[draft.kind] : "选择一种图样"}</span>
        {generate}
      </div>
    </div>
    <div className={styles.chartChoices} role="group" aria-label="推荐图样">
      {featured.map(({ kind, reason }) => {
        const Icon = chartIcons[kind];
        const selected = draft.kind === kind;
        return <button key={kind} data-chart={kind} type="button" aria-pressed={selected} disabled={busy || Boolean(reason)}
          onClick={() => onChart(kind)}>
          <span className={styles.chartIcon}><Icon size={23} strokeWidth={1.6} aria-hidden /></span>
          <span className={styles.chartChoiceText}><strong>{chartNames[kind]}</strong><small>{reason ?? chartUses[kind]}</small></span>
          {selected && <Check size={15} className={styles.choiceCheck} aria-hidden />}
        </button>;
      })}
    </div>
    <details className={styles.moreChoices}>
      <summary>更多图样与数据要求</summary>
      <div className={styles.extraChoices}>
        {more.map(kind => {
          const Icon = chartIcons[kind];
          const unavailable = reason(kind);
          return <button key={kind} data-chart={kind} type="button" disabled={busy || Boolean(unavailable)} onClick={() => onChart(kind)}>
            <Icon size={16} aria-hidden /><span><strong>{chartNames[kind]}</strong><small>{unavailable ?? chartUses[kind]}</small></span>
          </button>;
        })}
      </div>
    </details>
  </section>;
}
