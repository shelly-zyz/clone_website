"use client";

import dynamic from "next/dynamic";
import { ChevronDown, Layers3 } from "lucide-react";
import { useState } from "react";
import { reading, type DataStory } from "@/lib/topic-analysis/data-story";
import type { AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { powerStory } from "@/lib/topic-analysis/power-insights";
import { explorerMeasures, powerChartIds, powerExplorer, powerSources, powerYearRecord, type PowerChartId } from "@/lib/topic-analysis/power";
import { AnalysisTable, hasChartValues } from "./AnalysisFigure";
import { AnalysisPlot } from "./AnalysisPlot";
import styles from "./power.module.css";

const RibbonChart = dynamic(() => import("./PowerRibbonChart").then(module => module.PowerRibbonChart), {
  ssr: false, loading: () => <div className={styles.ribbonStage} />,
});

const descriptions = {
  "capacity-comparison": ["装机演变", "年度装机 · 三维分层曲带"],
  "capacity-mix": ["装机结构", "年末容量与构成"],
  "capacity-waterfall": ["增量贡献", "相邻两年装机净变化"],
  "renewable-capacity-share": ["风光占比", "全国装机结构的变化"],
  "generation-by-source": ["发电对比", "已发布的分电源发电量"],
} as const;

function Insight({ story, id }: { story: DataStory; id: string }) {
  return <aside className={styles.insight} aria-labelledby={`${id}-findings`} aria-live="polite">
    <h3 id={`${id}-findings`}>关键洞察</h3>
    <ul>{story.highlights.map(({ label, text }) => <li key={label}><strong>{label}</strong><p>{text}</p></li>)}</ul>
  </aside>;
}

function Report({ story, spec, defaultOpen }: { story: DataStory; spec: AnalysisChartSpec; defaultOpen?: boolean }) {
  const [tab, setTab] = useState(1);
  return <details className={styles.report} open={defaultOpen || undefined}>
    <summary>深度分析报告 <ChevronDown size={15} aria-hidden /></summary>
    <div className={styles.reportBody}>
      <div className={styles.reportTabs} role="group" aria-label="解读维度">
        {story.sections.map(({ label }, index) => <button type="button" key={label}
          aria-pressed={index === tab} onClick={() => setTab(index)}>{label}</button>)}
      </div>
      <p aria-live="polite">{story.sections[tab].text}</p>
      <details className={styles.evidence}>
        <summary>分析依据 <ChevronDown size={13} aria-hidden /></summary>
        <p>{spec.caption}</p>
        <ul>{spec.sources.map(source => <li key={source.href}><a href={source.href} target="_blank" rel="noreferrer">{source.label}</a></li>)}</ul>
      </details>
    </div>
  </details>;
}

function PowerFigure({ spec, id, year, source, expanded, update }: {
  spec: AnalysisChartSpec; id: PowerChartId; year: string; source?: string; expanded: boolean;
  update: (year?: string, source?: string) => void;
}) {
  const record = powerYearRecord(year);
  const highlight = record.parts.find(part => part.id === source)?.name;
  const story = powerStory(id, year, source);
  const shape = powerChartIds.indexOf(id) + 1;
  const [label, description] = descriptions[id];
  const annual = id === "capacity-comparison" || id === "renewable-capacity-share";
  const displayed = hasChartValues(spec);
  function select(name: string) {
    const part = record.parts.find(part => part.name === name || `${part.name}减少` === name);
    if (part) update(undefined, part.id === source ? "" : part.id);
  }
  return <figure className={styles.figure} id={id} data-panel={id} data-active-view={expanded || undefined} aria-labelledby={`${id}-title`}>
    <header className={styles.figureHeader}>
      <div>
        <p><b>{String(shape).padStart(2, "0")}</b>{label}</p>
        <h2 id={`${id}-title`}>{spec.title}</h2>
        <span>{description}</span>
      </div>
      <span className={styles.yearBadge}>{annual ? `${spec.labels[0]}—${spec.labels.at(-1)}` : year} 年</span>
    </header>
    <div className={styles.figureBody}>
      <div className={styles.chartContent}>
        {id === "capacity-comparison" ? <>
          <RibbonChart spec={spec} highlight={highlight} select={(nextYear, name) => update(nextYear, record.parts.find(item => item.name === name)?.id)} />
          <div className={styles.sourceButtons} role="group" aria-label="曲带电源">
            {powerSources.map(part => <button type="button" data-tone={part.tone} key={part.id} aria-pressed={source === part.id}
              onClick={() => select(part.name)}><i aria-hidden />{part.name}</button>)}
          </div>
        </> : id === "capacity-mix" && displayed ? <div className={styles.composition}>
          <div className={styles.plot}><AnalysisPlot spec={spec} highlight={highlight} onCategory={select} /></div>
          <ul className={styles.ringLegend}>{record.parts.map(part => <li key={part.id}>
            <button type="button" data-tone={part.tone} aria-pressed={part.id === source} onClick={() => select(part.name)}>
              <i aria-hidden /><span>{part.name}<small>{reading(part.capacity, "GW")}</small></span>
              <b>{part.share > 0 && part.share < 0.01 ? "<0.01%" : reading(part.share, "%")}</b>
            </button>
          </li>)}</ul>
        </div> : displayed ? <div className={styles.plot}>
          <AnalysisPlot spec={spec} highlight={highlight} onCategory={(name, target) => {
            if (annual && spec.labels.includes(name)) update(name);
            else if (target?.endsWith("减少")) select(target);
            else select(name);
          }} />
        </div> : <p className={styles.empty}>{spec.caption}</p>}
        {id === "generation-by-source" && <p className={styles.rankKey}><i aria-hidden />发电量：低到高（TWh）</p>}
      </div>
      <Insight story={story} id={id} />
    </div>
    <figcaption className={styles.caption}>{spec.caption}</figcaption>
    <div className={styles.figureFooter}>
      <Report story={story} spec={spec} defaultOpen={id === "capacity-comparison" && !expanded} />
      {displayed && <AnalysisTable spec={spec} />}
    </div>
  </figure>;
}

function Explorer({ year, source, update }: {
  year: string; source?: string; update: (year?: string, source?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [measure, setMeasure] = useState<keyof typeof explorerMeasures>("capacity");
  const spec = powerExplorer(measure, year, powerSources.find(item => item.id === source)?.name);
  return <details className={styles.explorer} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Layers3 size={17} aria-hidden /> 多维数据探索 <ChevronDown size={16} aria-hidden /></summary>
    {open && <div className={styles.explorerBody}>
      <p>按年份和电源比较已发布数值。点击一个格子，联动本页筛选。</p>
      <div className={styles.reportTabs} role="group" aria-label="探索指标">
        {Object.entries(explorerMeasures).map(([key, [label, unit]]) => <button key={key} type="button" aria-pressed={key === measure}
          onClick={() => setMeasure(key as keyof typeof explorerMeasures)}>{label} · {unit}</button>)}
      </div>
      <div className={styles.plot}><AnalysisPlot spec={spec} onCategory={(value, label) => update(value, powerSources.find(item => item.name === label)?.id)} /></div>
      <p>{spec.caption}</p>
      <AnalysisTable spec={spec} />
    </div>}
  </details>;
}

export function PowerDashboard({ charts, active, year, source, update }: {
  charts: AnalysisChartSpec[]; active?: string; year: string; source?: string; update: (year?: string, source?: string) => void;
}) {
  const shown = active ? charts.filter(spec => spec.id === active) : charts;
  const sources = [...new Map(shown.flatMap(spec => spec.sources.map(item => [item.href, item] as const))).values()];
  return <>
    <div className={styles.grid} data-focused={Boolean(active)}>
      {shown.map(spec => {
        const id = powerChartIds.find(item => item === spec.id);
        return id && <PowerFigure key={spec.id} id={id} spec={spec} year={year} source={source} expanded={Boolean(active)} update={update} />;
      })}
    </div>
    {!active && <Explorer year={year} source={source} update={update} />}
    <details className={styles.sources}>
      <summary>数据来源与统计口径 <ChevronDown size={15} aria-hidden /></summary>
      <p>装机为全国年末发电装机，单位 GW；发电量为各年度公报的规模以上工业统计，单位 TWh。</p>
      <ul>{sources.map(item => <li key={item.href}><a href={item.href} target="_blank" rel="noreferrer">{item.label}</a></li>)}</ul>
    </details>
  </>;
}

export function InterimPowerRelease() {
  return <details className={styles.interim}>
    <summary>2026 年前三季度 · 阶段数据 <ChevronDown size={14} aria-hidden /></summary>
    <div>
      <p>截至 2026 年 9 月底，累计发电装机约 4,130 GW，其中太阳能约 1,310 GW、风电约 700 GW。阶段值单独展示，年度图表仍采用年末公报。</p>
      <a href="https://www.nea.gov.cn/20261026/7e48f52542c94c0f99c166262453627d/c.html" target="_blank" rel="noreferrer">国家能源局 · 2026-10-26</a>
    </div>
  </details>;
}
