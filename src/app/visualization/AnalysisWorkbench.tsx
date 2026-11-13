"use client";

import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { globeTopicOrder, type WorkspaceTopic } from "@/lib/globe-topics";
import { analysisHref, analysisTopics } from "@/lib/topic-analysis/catalog";
import {
  buildCarbonAnalysis, buildEconomyAnalysis, buildPowerAnalysis, buildWeatherAnalysis, carbonDates, economyCountries,
  economyYears, formatAnalysisValue, latestEconomyYear, powerYears, weatherRegions, type AnalysisChartSpec,
} from "@/lib/topic-analysis/data";
import { AnalysisPlot } from "./AnalysisPlot";
import styles from "./page.module.css";

function AnalysisFilter({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.filter}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}

function AnalysisChart({ spec }: { spec: AnalysisChartSpec }) {
  const hasValues = spec.series.some(series => series.values.some(value => value !== null));
  return (
    <figure id={spec.id} className={styles.chartCard} aria-labelledby={spec.id + "-title"}>
      <h2 id={spec.id + "-title"}>{spec.title}</h2>
      <p className={styles.chartCaption}>{spec.caption}</p>
      {hasValues
        ? <AnalysisPlot spec={spec} />
        : <p className={styles.chartEmpty}>当前范围暂无已发布数值。</p>}
      <div className={styles.chartSource}>
        <span>单位 {spec.unit}</span>
        {spec.sources.map(({ label, href }) => (
          <a key={label} href={href} target="_blank" rel="noreferrer">{label}</a>
        ))}
      </div>
      {hasValues && (
        <details className={styles.chartData}>
          <summary>查看数值</summary>
          <div className={styles.tableScroll}>
            <table aria-label={spec.title + " 数值"}>
              <thead>
                <tr>
                  <th scope="col">分组</th>
                  {spec.series.map(item => <th scope="col" key={item.name}>{item.name}（{spec.unit}）</th>)}
                </tr>
              </thead>
              <tbody>
                {spec.labels.map((label, index) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {spec.series.map(item => <td key={item.name}>{formatAnalysisValue(item.values[index] ?? null)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}

export function AnalysisWorkbench({ topic }: { topic: WorkspaceTopic }) {
  const [powerYear, setPowerYear] = useState<typeof powerYears[number]>(powerYears[0]);
  const [windRegion, setWindRegion] = useState<keyof typeof weatherRegions>("global");
  const [carbonDate, setCarbonDate] = useState(carbonDates[carbonDates.length - 1]);
  const [country, setCountry] = useState("CHN");
  const [economyYear, setEconomyYear] = useState(latestEconomyYear);
  const config = analysisTopics[topic];

  let analysis;
  let filters: ReactNode;
  switch (topic) {
    case "power":
      analysis = buildPowerAnalysis(powerYear);
      filters = <AnalysisFilter label="统计年份" value={powerYear} onChange={(value) => {
        const selected = powerYears.find(year => year === value);
        if (selected) setPowerYear(selected);
      }}>
        {powerYears.map(year => <option key={year} value={year}>{year} 年</option>)}
      </AnalysisFilter>;
      break;
    case "weather":
      analysis = buildWeatherAnalysis(windRegion);
      filters = <AnalysisFilter label="空间范围" value={windRegion} onChange={(value) => {
        if (value === "global" || value === "north" || value === "south") setWindRegion(value);
      }}>
        {Object.entries(weatherRegions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </AnalysisFilter>;
      break;
    case "carbon":
      analysis = buildCarbonAnalysis(carbonDate);
      filters = <AnalysisFilter label="查看日期" value={carbonDate} onChange={setCarbonDate}>
        {carbonDates.toReversed().map(date => <option key={date} value={date}>{date}</option>)}
      </AnalysisFilter>;
      break;
    case "economy":
      analysis = buildEconomyAnalysis(country, economyYear);
      filters = <>
        <AnalysisFilter label="国家或地区" value={country} onChange={setCountry}>
          {economyCountries.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
        </AnalysisFilter>
        <AnalysisFilter label="历史统计截至" value={String(economyYear)} onChange={value => setEconomyYear(Number(value))}>
          {economyYears.map(year => <option key={year} value={year}>{year} 年</option>)}
        </AnalysisFilter>
      </>;
      break;
  }

  return (
    <div className={styles.workbench} data-topic={topic}>
      <aside className={styles.workbenchNav}>
        <nav aria-label="切换专题" className={styles.topicNav}>
          {globeTopicOrder.map(item => (
            <Link key={item} href={analysisHref(item)} aria-current={item === topic ? "page" : undefined}>
              {analysisTopics[item].label}
            </Link>
          ))}
        </nav>
        <nav aria-label="本页图表" className={styles.chartNav}>
          <h2>本页图表</h2>
          {analysis.charts.map(chart => (
            <a href={"#" + chart.id} key={chart.id}><ArrowDown size={13} aria-hidden="true" />{chart.title}</a>
          ))}
        </nav>
      </aside>
      <section className={styles.workbenchBody} aria-labelledby="analysis-topic-title">
        <div className={styles.topicHeading}>
          <h1 id="analysis-topic-title">{config.title}</h1>
          <p>{analysis.scope}</p>
        </div>
        <div className={styles.filters} role="group" aria-label="分析筛选">{filters}</div>
        <dl className={styles.metrics} aria-live="polite">
          {analysis.metrics.map(item => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}{item.unit && <span>{item.unit}</span>}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.chartGrid}>
          {analysis.charts.map(spec => <AnalysisChart key={spec.id} spec={spec} />)}
        </div>
      </section>
    </div>
  );
}
