"use client";

import Link from "next/link";
import {
  ArrowRight, ChartArea, ChartBar, ChartColumn, ChartLine, ChartScatter, ChevronDown, Compass,
  Grid3X3, LayoutGrid, Map as MapIcon, RotateCw, Wind,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import type { VreTechnology } from "@/lib/climate-vre";
import { analysisGroups, analysisHref, analysisTopics, type AnalysisTopic } from "@/lib/topic-analysis/catalog";
import { buildCarbonAnalysis, buildRenewableAnalysis, buildWeatherAnalysis, carbonDates, weatherRegions } from "@/lib/topic-analysis/climate";
import {
  buildEconomyAnalysis, buildOutlookAnalysis, buildTradeAnalysis, economyCountries, economyIndicators, economyYears,
  latestEconomyYear, outlookCountries, outlookYears, type EconomyIndicator,
} from "@/lib/topic-analysis/economics";
import { buildFuelAnalysis, buildGenerationAnalysis, buildPowerAnalysis, generationMonths, powerYears, type Fuel, type GenerationProduct } from "@/lib/topic-analysis/energy";
import {
  fuelSeries, generationSeries, publishedAnalysisTopics, type PublishedHistory, type RegionalGeneration, type RenewableScenario,
} from "@/lib/topic-analysis/history";
import type { Analysis, AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { AnalysisFigure, hasChartValues } from "./AnalysisFigure";
import styles from "./page.module.css";

const chartIcons = {
  area: ChartArea, "stacked-area": ChartArea, line: ChartLine, column: ChartColumn, horizontal: ChartBar,
  treemap: LayoutGrid, heatmap: Grid3X3, bubble: ChartScatter, map: MapIcon, rose: Wind,
};
const api = "/api/topic-analysis?topic=";

function useResource<T>(url: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ url: string; attempt: number; data: T | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async response => {
      const data = response.ok ? await response.json() as T : null;
      if (!controller.signal.aborted) setResult({ url, attempt, data });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ url, attempt, data: null });
    });
    return () => controller.abort();
  }, [url, attempt]);

  const current = result && result.url === url && result.attempt === attempt ? result : null;
  return { data: current?.data ?? null, pending: Boolean(url && !current), retry: () => setAttempt(value => value + 1) };
}

function subscribeToView(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const readView = () => window.location.hash.slice(1);

function selectView(event: MouseEvent<HTMLAnchorElement>, id: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (readView() !== id) {
    window.history.pushState(null, "", id ? "#" + id : window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  document.getElementById("topic-analysis-page")?.scrollTo({ top: 0, behavior: "instant" });
}

function AnalysisFilter({ label, value, onChange, children }: {
  label: string; value: string; onChange: (value: string) => void; children: ReactNode;
}) {
  return (
    <label className={styles.filter}>
      <span>{label}</span>
      <span className={styles.selectField}>
        <select value={value} onChange={event => onChange(event.target.value)}>{children}</select>
        <ChevronDown size={15} aria-hidden="true" />
      </span>
    </label>
  );
}

function TopicSwitcher({ topic }: { topic: AnalysisTopic }) {
  return (
    <details className={styles.topicSwitcher}>
      <summary>切换专题 <ChevronDown size={16} aria-hidden="true" /></summary>
      <nav aria-label="切换分析专题" className={styles.topicMenu}>
        {analysisGroups.map(group => (
          <div key={group.id}>
            <strong>{group.label}</strong>
            {group.topics.map(item => (
              <Link key={item} href={analysisHref(item)} aria-current={item === topic ? "page" : undefined} prefetch={false}>
                {analysisTopics[item].label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </details>
  );
}

function ChartLink({ spec, active = false }: { spec: AnalysisChartSpec; active?: boolean }) {
  const Icon = chartIcons[spec.kind];
  return (
    <a href={"#" + spec.id} aria-current={active ? "location" : undefined} onClick={event => selectView(event, spec.id)}>
      <Icon size={22} strokeWidth={1.65} aria-hidden="true" />
      <span>{spec.label}</span>
    </a>
  );
}

export function AnalysisWorkbench({ topic }: { topic: AnalysisTopic }) {
  const [powerYear, setPowerYear] = useState(powerYears[0]);
  const [product, setProduct] = useState<GenerationProduct>("electricity");
  const [generationMonth, setGenerationMonth] = useState("");
  const [fuel, setFuel] = useState<Fuel>("raw-coal");
  const [windRegion, setWindRegion] = useState<keyof typeof weatherRegions>("global");
  const [carbonDate, setCarbonDate] = useState(carbonDates[carbonDates.length - 1]);
  const [scenarioRegion, setScenarioRegion] = useState("china");
  const [scenarioYear, setScenarioYear] = useState(2050);
  const [technology, setTechnology] = useState<VreTechnology>("wind");
  const [country, setCountry] = useState("CHN");
  const [economyYear, setEconomyYear] = useState(latestEconomyYear);
  const [economyIndicator, setEconomyIndicator] = useState<EconomyIndicator>("perCapita");
  const [outlookYear, setOutlookYear] = useState(outlookYears[0]);
  const view = useSyncExternalStore(subscribeToView, readView, () => "");

  const published = useResource<PublishedHistory>(publishedAnalysisTopics.some(item => item === topic) ? api + topic : null);
  const scenario = useResource<RenewableScenario>(topic === "renewables" ? api + topic : null);
  const history = published.data?.facts.some(row => row.value !== null) ? published.data : null;
  const months = topic === "generation" ? generationMonths(history, product) : [];
  const displayedMonth = months.includes(generationMonth) ? generationMonth : months.at(-1) ?? "";
  const regional = useResource<RegionalGeneration>(
    topic === "generation" && history && displayedMonth
      ? `${api}generation&month=${displayedMonth}&version=${history.version}` : null,
  );

  const scenarioYears = scenario.data
    ? [...new Set(scenario.data.rows.filter(row => row.region === scenarioRegion).map(row => row.year))].sort((a, b) => b - a)
    : [];
  const displayedScenarioYear = scenarioYears.includes(scenarioYear) ? scenarioYear : scenarioYears[0];

  const onRegion = useCallback((label: string) => {
    const match = economyCountries.find(item => item.label === label);
    if (match) setCountry(match.code);
  }, []);

  let analysis: Analysis | undefined;
  let filters: ReactNode;
  let dataStatus: string | undefined;
  switch (topic) {
    case "power":
      analysis = buildPowerAnalysis(powerYear);
      filters = <AnalysisFilter label="统计年份" value={powerYear} onChange={setPowerYear}>
        {powerYears.map(year => <option key={year} value={year}>{year} 年</option>)}
      </AnalysisFilter>;
      break;
    case "generation":
      analysis = buildGenerationAnalysis(product, displayedMonth, history, regional.data);
      filters = <>
        <AnalysisFilter label="发电指标" value={product} onChange={value => {
          const item = generationSeries.find(series => series.id === value);
          if (item) setProduct(item.id);
        }}>
          {generationSeries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </AnalysisFilter>
        <AnalysisFilter label="查看月份" value={displayedMonth} onChange={setGenerationMonth}>
          {months.length ? months.toReversed().map(month => <option key={month} value={month}>{month}</option>)
            : <option value="">暂无可选月份</option>}
        </AnalysisFilter>
      </>;
      break;
    case "fuels":
      analysis = buildFuelAnalysis(fuel, history);
      filters = <AnalysisFilter label="能源品种" value={fuel} onChange={value => {
        const item = fuelSeries.find(series => series.id === value);
        if (item) setFuel(item.id);
      }}>
        {fuelSeries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </AnalysisFilter>;
      break;
    case "weather":
      analysis = buildWeatherAnalysis(windRegion);
      filters = <AnalysisFilter label="空间范围" value={windRegion} onChange={value => {
        if (value === "global" || value === "north" || value === "south") setWindRegion(value);
      }}>
        {Object.entries(weatherRegions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </AnalysisFilter>;
      break;
    case "renewables":
      dataStatus = scenario.pending ? "读取情景中" : scenario.data?.origin === "database" ? "数据库情景"
        : scenario.data ? "情景归档" : undefined;
      if (scenario.data && displayedScenarioYear) {
        analysis = buildRenewableAnalysis(scenario.data, scenarioRegion, displayedScenarioYear, technology);
        filters = <>
          <AnalysisFilter label="地区" value={scenarioRegion} onChange={setScenarioRegion}>
            {scenario.data.regions.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </AnalysisFilter>
          <AnalysisFilter label="情景年份" value={String(displayedScenarioYear)} onChange={value => setScenarioYear(Number(value))}>
            {scenarioYears.map(year => <option key={year} value={year}>{year} 年</option>)}
          </AnalysisFilter>
          <AnalysisFilter label="季节热力图指标" value={technology} onChange={value => {
            if (value === "wind" || value === "solar") setTechnology(value);
          }}>
            <option value="wind">风电</option><option value="solar">光伏</option>
          </AnalysisFilter>
        </>;
      }
      break;
    case "carbon":
      analysis = buildCarbonAnalysis(carbonDate, history);
      filters = <AnalysisFilter label="日度归档日期" value={carbonDate} onChange={setCarbonDate}>
        {carbonDates.toReversed().map(date => <option key={date} value={date}>{date}</option>)}
      </AnalysisFilter>;
      break;
    case "economy":
    case "trade":
    case "outlook": {
      const forecast = topic === "outlook";
      const years = forecast ? outlookYears : economyYears;
      const countries = forecast ? outlookCountries : economyCountries;
      analysis = topic === "economy" ? buildEconomyAnalysis(country, economyYear, economyIndicator)
        : topic === "trade" ? buildTradeAnalysis(country, economyYear) : buildOutlookAnalysis(country, outlookYear);
      dataStatus = forecast ? "世界银行预测" : "WDI 历史统计";
      filters = <>
        <AnalysisFilter label="国家或地区" value={country} onChange={setCountry}>
          {countries.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
        </AnalysisFilter>
        <AnalysisFilter label={forecast ? "预测年份" : "统计年份"} value={String(forecast ? outlookYear : economyYear)}
          onChange={value => (forecast ? setOutlookYear : setEconomyYear)(Number(value))}>
          {years.map(year => <option key={year} value={year}>{year} 年</option>)}
        </AnalysisFilter>
        {topic === "economy" && <AnalysisFilter label="地图与排行指标" value={economyIndicator} onChange={value => {
          if (value === "total" || value === "perCapita") setEconomyIndicator(value);
        }}>
          {Object.entries(economyIndicators).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </AnalysisFilter>}
      </>;
      break;
    }
  }

  const config = analysisTopics[topic];
  const selected = analysis?.charts.find(spec => spec.id === view);
  const first = selected ?? analysis?.charts.find(hasChartValues);
  const otherCharts = analysis?.charts.filter(spec => spec.id !== first?.id) ?? [];
  const hasPublishedQuery = publishedAnalysisTopics.some(item => item === topic);
  if (hasPublishedQuery) {
    dataStatus = published.pending ? "读取数据库中" : history ? "数据库已发布"
      : topic === "carbon" ? "归档日度数据" : topic === "generation" ? "公开月报选录" : "公开年度公报";
  }

  function emptyMessage(spec: AnalysisChartSpec) {
    if (spec.id === "province-ranking") {
      if (regional.pending || published.pending) return "正在读取已发布的分省发电量。";
      if (!history) return "分省发电量需要已发布数据库。当前可查看全国公开月报。";
      return regional.data ? "这个月份暂无已发布的省级数值。" : "分省数据暂时无法读取。";
    }
    if (spec.id === "carbon-monthly" || spec.id === "carbon-seasonal" || spec.id === "fuel-monthly") {
      return published.pending ? "正在读取数据库中的多年序列。"
        : history ? "当前发布版本没有该指标的有效观测。" : "数据库历史暂不可用。请查看本专题的公报或归档图表。";
    }
  }

  function renderFigure(spec: AnalysisChartSpec, primary = false) {
    return <AnalysisFigure key={spec.id} spec={spec} primary={primary} empty={emptyMessage(spec)}
      onRegion={spec.kind === "map" || (spec.kind === "bubble" && topic === "trade") ? onRegion : undefined} />;
  }

  return (
    <div className={styles.workbench} data-topic={topic}>
      <aside className={styles.workbenchNav}>
        <nav aria-label="专题图表视图" className={styles.chartNav}>
          <a href="#topic-filters" aria-current={!selected ? "location" : undefined} onClick={event => selectView(event, "")}>
            <Compass size={22} strokeWidth={1.65} aria-hidden="true" /><span>概览</span>
          </a>
          {analysis?.charts.map(spec => <ChartLink key={spec.id} spec={spec} active={selected?.id === spec.id} />)}
        </nav>
      </aside>
      <section className={styles.workbenchBody} aria-labelledby="analysis-topic-title">
        <div className={styles.topicHeading}>
          <div>
            <h1 id="analysis-topic-title">{config.title}</h1>
            <p>{analysis?.scope ?? config.description}</p>
          </div>
          <TopicSwitcher topic={topic} />
        </div>
        <div className={styles.filters} id="topic-filters">
          <div className={styles.filterControls} role="group" aria-label="分析筛选">{filters}</div>
          <div className={styles.dataStatus} role="status">
            {dataStatus && <span data-ready={Boolean(history || scenario.data?.origin === "database")}>{dataStatus}</span>}
            {hasPublishedQuery && !published.pending && !history && (
              <button onClick={published.retry} type="button" aria-label="重新读取数据库">
                <RotateCw size={15} aria-hidden="true" />
              </button>
            )}
            {scenario.data && <span className={styles.scenarioDate}>情景数据生成于 {scenario.data.generatedAt.slice(0, 10)}</span>}
            {history && (
              <details className={styles.release}>
                <summary>数据版本</summary>
                <dl>
                  <div><dt>数据集</dt><dd>{history.dataset}</dd></div>
                  <div><dt>发布于</dt><dd>{history.publishedAt.slice(0, 10)} UTC</dd></div>
                  <div><dt>版本</dt><dd>{history.version}</dd></div>
                </dl>
              </details>
            )}
          </div>
        </div>
        {analysis ? (
          <>
            <dl className={styles.metrics} aria-live="polite">
              {analysis.metrics.map(item => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}{item.unit && <span>{item.unit}</span>}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.chartWorkspace}>
              {first && renderFigure(first, true)}
              {selected ? (
                <nav className={styles.moreViews} aria-label="其他图表视图">
                  {otherCharts.map(spec => <ChartLink key={spec.id} spec={spec} />)}
                </nav>
              ) : (
                <div className={styles.chartGrid}>
                  {otherCharts.filter(hasChartValues).map(spec => renderFigure(spec))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className={styles.pending} role="status">
            {scenario.pending ? "正在读取风光情景数据…" : "风光情景暂时无法加载。"}
            {!scenario.pending && <button type="button" onClick={scenario.retry}>重试 <ArrowRight size={14} aria-hidden="true" /></button>}
          </p>
        )}
      </section>
    </div>
  );
}
