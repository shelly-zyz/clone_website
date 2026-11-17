"use client";

import { Check, CloudSun, Factory, ChartLine, Zap } from "lucide-react";
import type { ReactNode } from "react";
import {
  domains, type ChartKind, type DataStructure, type Domain, type FigureRecommendations, type VisualizationJob,
} from "@/lib/visualization-agent/research/contracts";
import { structureLabels } from "@/lib/visualization-agent/research/structures";
import { allProvinceGeneration, chartNames, chartUses, domainNames, hasCapacity, initialStructures } from "./research-controls";
import styles from "./research.module.css";

const topicIcons = { electricity: Zap, meteorology: CloudSun, carbon: Factory, economy: ChartLine };
const stepLabels = ["选择数据", "选择数据结构", "参考图与样式"];
export type ResearchStep = 1 | 2 | 3;

export function ResearchChartChoices({ domain, draft, step, recommendation, busy, dataInputs, controls, month, year, years,
  onData, onDomain, onChart, onStructure, onMonth, onYear }: {
  domain: Domain;
  draft: VisualizationJob["configuration"];
  step: ResearchStep;
  recommendation?: FigureRecommendations;
  busy: boolean;
  dataInputs: ReactNode;
  controls: ReactNode;
  month: string;
  year: number;
  years: number[];
  onData: () => void;
  onDomain: (domain: Domain) => void;
  onChart: (kind: ChartKind) => void;
  onStructure: (structure: DataStructure) => void;
  onMonth: (month: string) => void;
  onYear: (year: number) => void;
}) {
  const options = recommendation?.choices.map(item => item.structure) ?? initialStructures(draft.datasets);
  const choice = recommendation?.choices.find(item => item.structure === draft.structure);
  return <section className={styles.choices} aria-label="分步制图" data-domain={domain} data-step={step}>
    <ol className={styles.steps}>
      {stepLabels.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
        <span>{index + 1 < step ? <Check size={13} aria-hidden /> : index + 1}</span>{label}
      </li>)}
    </ol>
    {step === 1 ? <>
      <h3>选择专题与指标</h3>
      <div className={styles.topicChoices} role="group" aria-label="选择专题">
        {domains.map(item => {
          const Icon = topicIcons[item];
          return <button key={item} type="button" aria-pressed={domain === item} disabled={busy} onClick={() => onDomain(item)}>
            <Icon size={17} aria-hidden />{domainNames[item]}
          </button>;
        })}
      </div>
      {dataInputs}
    </> : <>
      {step === 2 && <>
        <h3>选择数据结构</h3>
        <div className={styles.structureChoices} role="group" aria-label="数据结构">
          {options.map(item => <button key={item} type="button" data-structure={item} aria-pressed={draft.structure === item}
            disabled={busy} onClick={() => onStructure(item)}>{structureLabels[item]}</button>)}
        </div>
        {draft.structure === "categories" && allProvinceGeneration(draft.datasets) &&
          <label className={styles.stepInput}>对比月份<input type="month" value={month} required
            onChange={event => onMonth(event.target.value)} /></label>}
        {draft.structure === "composition" && hasCapacity(draft.datasets) &&
          <label className={styles.stepInput}>装机统计年份<select value={year} onChange={event => onYear(Number(event.target.value))}>
            {years.map(item => <option key={item}>{item}</option>)}
          </select></label>}
        <button type="button" className={styles.textButton} disabled={busy} onClick={onData}>返回选择数据</button>
      </>}
      {step === 3 && <>
        <div className={styles.choiceHeading}>
          <h3>推荐图样</h3><span>样式示意</span>
        </div>
        <div className={styles.chartChoices} role="group" aria-label="推荐图样">
          {choice?.charts.map(kind => <button key={kind} data-chart={kind} type="button" aria-pressed={draft.kind === kind} disabled={busy}
            onClick={() => onChart(kind)}>
            <ChartReference kind={kind} />
            <span className={styles.chartChoiceText}><strong>{chartNames[kind]}</strong><small>{chartUses[kind]}</small></span>
            {draft.kind === kind && <Check size={15} className={styles.choiceCheck} aria-hidden />}
          </button>)}
        </div>
      </>}
    </>}
    {recommendation && step > 1 && <ul className={styles.coverage} aria-label="数据覆盖">
      {recommendation.datasets.map(item => {
        const time = item.is_forecast ? item.forecast_horizon : item.observation_time;
        return <li key={item.digest + item.title}><strong>{item.title}</strong>
          <span>{time?.start?.slice(0, 10)}{time?.end && time.end !== time.start ? " 至 " + time.end.slice(0, 10) : ""}
            {" · "}{item.sample_count - item.missing} 条有效 · {item.missing} 条缺测</span>
        </li>;
      })}
    </ul>}
    <div className={styles.wizardActions}>{controls}</div>
  </section>;
}

function ChartReference({ kind }: { kind: ChartKind }) {
  const blue = "#537ba7", mint = "#66b3ac", purple = "#a894cc", pale = "#dce6ef";
  let marks: ReactNode;
  switch (kind) {
    case "ring":
      marks = <><circle cx="77" cy="40" r="25" fill="none" stroke={blue} strokeWidth="11" />
        <circle cx="77" cy="40" r="25" fill="none" stroke={mint} strokeWidth="11" strokeDasharray="64 157" transform="rotate(-90 77 40)" />
        <circle cx="77" cy="40" r="17" fill="none" stroke={purple} strokeWidth="3" strokeDasharray="62 106" /></>;
      break;
    case "rank": case "horizontal-bars": case "dumbbell": {
      const dumbbell = kind === "dumbbell", dots = kind !== "horizontal-bars";
      marks = [109, 86, 64, 47].map((width, index) => <g key={width}>
        <rect x={dumbbell ? 29 + index * 8 : 21} y={15 + index * 14} rx="2" width={width} height={dots ? 2 : 7} fill={dots ? pale : blue} />
        {dots && <circle cx={dumbbell ? 29 + index * 8 + width : 21 + width} cy={16 + index * 14} r="4" fill={index % 2 ? mint : blue} />}
        {dumbbell && <circle cx={29 + index * 8} cy={16 + index * 14} r="4" fill={purple} />}
      </g>);
      break;
    }
    case "calendar": case "grid": case "correlation": case "surface":
      marks = Array.from({ length: 35 }, (_, index) => <rect key={index} x={24 + index % 7 * 16} y={9 + Math.floor(index / 7) * 13}
        width="14" height="11" rx="1.4" fill={[pale, "#a8d2d2", mint, "#91acc8", blue][(index + Math.floor(index / 7) * 2) % 5]} />);
      break;
    case "scatter":
      marks = [[32, 57], [42, 61], [48, 50], [62, 47], [63, 54], [76, 35], [84, 45], [92, 31], [100, 36], [112, 20], [128, 18]].map(([x, y]) =>
        <circle key={x} cx={x} cy={y} r="3.5" fill={mint} stroke={blue} />);
      break;
    case "density":
      marks = <><path d="M18 68C48 67 48 23 76 22S111 67 138 68Z" fill={mint} opacity=".43" />
        <path d="M18 67C48 66 48 23 76 22S111 67 138 67" fill="none" stroke={blue} strokeWidth="2" />
        <path d="M18 67C43 67 74 34 96 35S123 65 138 67" fill="none" stroke={purple} strokeWidth="2" /></>;
      break;
    case "trend-distribution": case "forecast-diagnostics":
      marks = <><path d="M23 38L48 30L67 33L88 21L105 25L133 15" fill="none" stroke={blue} strokeWidth="2.5" />
        <path d="M22 47h111" stroke={pale} />
        {[48, 78, 106].map((x, i) => <rect key={x} x={x - 7} y={53 + (i % 2) * 4} width="14" height="11" rx="2" fill={i % 2 ? mint : purple} />)}
      </>;
      break;
    case "box": case "violin":
      marks = [44, 78, 111].map((x, i) => <g key={x}>
        <path d={"M" + x + " " + (13 + i * 3) + " V64"} stroke={blue} />
        {kind === "violin" ?
          <ellipse cx={x} cy={38 + i * 3} rx={9 + i} ry={17 - i} fill={i % 2 ? mint : purple} /> :
          <rect x={x - 10} y={27 + i * 4} width="20" height={24 - i * 3} rx="2" fill={i % 2 ? mint : purple} />}
        <path d={"M" + (x - 9) + " " + (40 + i * 2) + " h18"} stroke={blue} />
      </g>);
      break;
    case "stack":
      marks = <><path d="M18 55L42 47L66 50L88 38L112 42L138 34V69H18Z" fill={mint} opacity=".7" />
        <path d="M18 43L42 28L66 38L88 22L112 27L138 12V34L112 42L88 38L66 50L42 47L18 55Z" fill={purple} opacity=".8" /></>;
      break;
    case "trend": case "forecast":
      marks = <><path d="M18 57L45 47L70 51L89 33" stroke={blue} strokeWidth="3" fill="none" />
        <path d="M89 33L110 39L136 20" stroke={kind === "trend" ? blue : mint} strokeWidth="3"
          strokeDasharray={kind === "trend" ? undefined : "4 4"} fill="none" /></>;
      break;
    case "flow":
      marks = <><path d="M24 23C65 23 85 20 134 20" fill="none" stroke={blue} strokeWidth="14" opacity=".6" />
        <path d="M24 43C64 43 86 51 134 51" fill="none" stroke={mint} strokeWidth="12" opacity=".65" />
        <path d="M24 27C62 27 90 43 134 46" fill="none" stroke={purple} strokeWidth="6" opacity=".65" /></>;
      break;
    case "rose":
      marks = <g transform="translate(78 39)">{[0, 60, 120, 180, 240, 300].map((angle, i) =>
        <rect key={angle} x="-6" y={-14 - i * 3} width="12" height={14 + i * 3} rx="3" transform={"rotate(" + angle + ")"} fill={i % 2 ? blue : mint} />)}</g>;
      break;
    default:
      marks = [36, 56, 45, 64, 32].map((height, index) => <rect key={index} x={25 + index * 23} y={69 - height + (kind === "waterfall" ? index * 2 : 0)}
        width="14" height={kind === "waterfall" ? height * .65 : height} rx="2" fill={kind === "composition-columns" ? [blue, mint, purple][index % 3] : blue} />);
  }
  return <svg className={styles.chartReference} viewBox="0 0 156 80" aria-hidden="true">
    <rect width="156" height="80" rx="7" fill="#f4f8fa" />
    {kind !== "ring" && kind !== "rose" && kind !== "flow" && <path d="M18 12V69H140" stroke={pale} fill="none" />}
    {marks}
  </svg>;
}
