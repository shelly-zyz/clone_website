"use client";

import Link from "next/link";
import {
  ArrowRight, CalendarDays, ChartArea, ChartBar, ChartColumn, ChartLine, ChartPie, ChartScatter, Check, ChevronDown, ChevronRight,
  Compass, GitBranch, GitCompareArrows, Grid3X3, LayoutGrid, Map as MapIcon, RotateCw, Wind,
} from "lucide-react";
import { useEffect, useId, useState, type MouseEvent, type ReactNode } from "react";
import { chinaProvinces, chineseLabelMatches, findChinaProvince } from "@/lib/china-provinces";
import { readWorkspaceContext } from "@/lib/workspace-context";
import { analysisGroups, analysisHref, analysisTopics, type AnalysisTopic } from "@/lib/topic-analysis/catalog";
import {
  buildCarbonAnalysis, buildRenewableAnalysis, buildWeatherAnalysis, carbonArchiveLatitudeComparison, carbonDates,
  carbonComparisonTrend, carbonPeriods, carbonRateUnit, gracedSource, weatherRegions, type CarbonGrain, type CarbonPeriod,
} from "@/lib/topic-analysis/climate";
import {
  buildEconomicComparison, buildEconomyAnalysis, buildOutlookAnalysis, buildTradeAnalysis,
  economyComparisonModes, economyCountries, economyIndicators, economyYears, latestEconomyYear, outlookCountries, outlookYears,
} from "@/lib/topic-analysis/economics";
import {
  buildFuelAnalysis, buildGenerationAnalysis, buildPowerAnalysis, generationMonths, monthKey, monthLabels, officialProvincial, powerYears,
} from "@/lib/topic-analysis/energy";
import {
  fuelSeries, generationSeries, publishedAnalysisTopics, type PublishedHistory, type RegionalGeneration, type RenewableScenario,
} from "@/lib/topic-analysis/history";
import type { Analysis, AnalysisChartSpec } from "@/lib/topic-analysis/model";
import { PeriodComparison } from "./PeriodComparison";
import { updateAnalysisQuery, useAnalysisQuery } from "./useAnalysisLocation";
import { AnalysisFigure, hasChartValues } from "./AnalysisFigure";
import { useAnalysisAnchor } from "./useAnalysisAnchor";
import styles from "./page.module.css";

const chartIcons = {
  area: ChartArea, "stacked-area": ChartArea, line: ChartLine, column: ChartColumn, horizontal: ChartBar,
  treemap: LayoutGrid, heatmap: Grid3X3, bubble: ChartScatter, map: MapIcon, rose: Wind,
  donut: ChartPie, sankey: GitBranch, waterfall: ChartColumn, calendar: CalendarDays, boxplot: ChartBar, "range-band": ChartArea,
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

function selectView(event: MouseEvent<HTMLAnchorElement>, id: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  updateAnalysisQuery({}, id);
  document.getElementById("topic-analysis-page")?.scrollTo({ top: 0, behavior: "instant" });
}

function AnalysisFilter({ label, value, onChange, children }: {
  label: string; value: string; onChange: (value: string) => void; children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={styles.filter}>
      <label htmlFor={id}>{label}</label>
      <span className={styles.selectField}>
        <select id={id} value={value} onChange={event => onChange(event.target.value)}>{children}</select>
        <ChevronDown className={styles.chevron} size={15} strokeWidth={1.8} aria-hidden="true" />
      </span>
    </div>
  );
}

function TopicSwitcher({ topic, query }: { topic: AnalysisTopic; query: URLSearchParams }) {
  return (
    <details className={styles.topicSwitcher}>
      <summary className={styles.disclosure}>
        切换专题 <ChevronDown className={styles.chevron} size={15} strokeWidth={1.8} aria-hidden="true" />
      </summary>
      <nav aria-label="切换分析专题" className={styles.topicMenu}>
        {analysisGroups.map(group => (
          <div key={group.id}>
            <strong>{group.label}</strong>
            {group.topics.map(item => (
              <Link key={item} href={relatedAnalysisHref(topic, item, query)} aria-current={item === topic ? "page" : undefined} prefetch={false}>
                <span>{analysisTopics[item].label}</span>
                {item === topic ? <Check size={15} strokeWidth={2} aria-hidden="true" />
                  : <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />}
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

const defaultCarbonDate = carbonDates[carbonDates.length - 1];

function relatedAnalysisHref(current: AnalysisTopic, next: AnalysisTopic, query: URLSearchParams) {
  if (analysisTopics[current].globe !== analysisTopics[next].globe) return analysisHref(next);
  const keys = next === "economy" || next === "trade" || next === "outlook"
    ? ["country", "year", "startYear", "targetYear", "metric"]
    : next === "generation" || next === "power" || next === "fuels"
      ? ["month", "year", "region", "product", "version"]
      : ["region", "year", "technology"];
  const nextQuery = new URLSearchParams();
  for (const key of keys) {
    const value = query.get(key);
    if (value) nextQuery.set(key, value);
  }
  return nextQuery.size ? analysisHref(next) + "?" + nextQuery.toString() : analysisHref(next);
}

function select(value: string | null | undefined, label: string) {
  updateAnalysisQuery({ [label]: value ?? undefined });
}

function displayDate(value: string | undefined, options: readonly string[], fallback: string) {
  return value && options.includes(value) ? value : fallback;
}

function csvDownload(rows: readonly (readonly (string | number | null)[])[]) {
  const csv = rows.map(row => row.map(value => {
    if (value === null) return "";
    return typeof value === "number" ? String(value) : '"' + value.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
  return "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + csv);
}

function PeriodOptions({ options, value }: { options: readonly string[]; value: string }) {
  return <>
    {value && !options.includes(value) && <option value={value}>{value}（暂无）</option>}
    {!value && <option value="">暂无可选时期</option>}
    {options.map(option => <option key={option} value={option}>{option}</option>)}
  </>;
}

function CarbonComparison({ history, query, period, grain }: {
  history: PublishedHistory | null;
  query: URLSearchParams;
  period: string;
  grain: CarbonGrain;
}) {
  const context = readWorkspaceContext(query);
  const periodOptions = carbonPeriods(grain, history).toReversed();
  const key = grain === "day" ? "date" : "month";
  const compareKey = grain === "day" ? "compareDate" : "compareMonth";
  const month = query.get("compareMonth");
  const requested = grain === "day" ? context.compareDate : month && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
  const alternate = requested || periodOptions.find(item => item.period !== period)?.period || period;
  const first = periodOptions.find(item => item.period === period);
  const second = periodOptions.find(item => item.period === alternate);
  const options = periodOptions.map(item => item.period);
  const version = history?.version ?? "2025-08 GRACED Power 归档";
  const describe = (item: CarbonPeriod | undefined) => item?.rate == null ? "暂无所选时期的排放速率"
    : `${item.coverage} 个有值日帧 · ${item.grids?.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) ?? "暂无"} ${grain === "month" ? "月均非零格点" : "个非零格点"}`;
  const chart = grain === "day" && !history ? carbonArchiveLatitudeComparison(period, alternate)
    : carbonComparisonTrend(periodOptions, period, alternate, grain);
  const exportHref = first?.rate != null || second?.rate != null ? csvDownload([
    ["比较", "时期（UTC）", "空间", "数据集", "版本", "有效日帧", "速率（kgC/h）", "非零格点"],
    ["A", period, "全球", "GRACED Power", version, first?.coverage ?? null, first?.rate ?? null, first?.grids ?? null],
    ["B", alternate, "全球", "GRACED Power", version, second?.coverage ?? null, second?.rate ?? null, second?.grids ?? null],
  ]) : undefined;
  return (
    <div>
      <PeriodComparison id="carbon-comparison" title="全球电力排放速率对比"
        caption={history ? (grain === "day" ? "同一发布版本的两个全球日帧。日期为 UTC。"
          : "同一发布版本的两个月均速率。每月按有值日帧平均，并显示覆盖天数。")
          : "使用 2025 年 8 月 GRACED Power 归档。按相同空间范围和单位比较。"}
        first={{
          heading: "基准时期", value: first?.rate ?? null, detail: describe(first),
          controls: <AnalysisFilter label={grain === "day" ? "A 日度日期" : "A 月份"} value={period} onChange={value => select(value, key)}>
            <PeriodOptions options={options} value={period} />
          </AnalysisFilter>,
        }}
        second={{
          heading: "对照时期", value: second?.rate ?? null, detail: describe(second),
          controls: <AnalysisFilter label={grain === "day" ? "B 日度日期" : "B 月份"} value={alternate} onChange={value => select(value, compareKey)}>
            <PeriodOptions options={options} value={alternate} />
          </AnalysisFilter>,
        }}
        unit={carbonRateUnit} source={gracedSource}
        onSwap={period && alternate && alternate !== period ? () => updateAnalysisQuery({ [key]: alternate, [compareKey]: period }) : undefined}
        exportHref={exportHref}
      />
      {chart && <div className={styles.comparisonBelow}><AnalysisFigure spec={chart} /></div>}
    </div>
  );
}

const generationCompareId = "province-comparison";
const carbonCompareId = "carbon-comparison";

function ComparisonLink({ id, active = false }: { id: string; active?: boolean }) {
  return <a href={"#" + id} aria-current={active ? "location" : undefined} onClick={event => selectView(event, id)}>
    <GitCompareArrows size={22} strokeWidth={1.65} aria-hidden="true" /><span>A/B 对比</span>
  </a>;
}
const historicalCompareId = "economic-comparison";

function ProvinceComparison({ data, pending, available, primary, alternate, scope, unit }: {
  data: RegionalGeneration | null;
  pending: boolean;
  available: boolean;
  primary: string;
  alternate: string;
  scope: string;
  unit: string;
}) {
  const first = data?.regions.find(item => item.code === primary);
  const second = data?.regions.find(item => item.code === alternate);
  const describe = (value: number | null | undefined) => pending ? "读取该期分省数据中"
    : !available ? "已发布数据库暂不可用"
      : value == null ? "该省暂无此报告期的数值" : "已发布的省级本期值";
  const options = chinaProvinces.map(item => <option key={item.code} value={item.code}>{item.name}</option>);
  const exportHref = data && (first?.value != null || second?.value != null) ? csvDownload([
    ["比较", "地区", "月份", "版本", "指标", unit],
    ["A", findChinaProvince(primary)?.name ?? primary, data.month, data.version, scope, first?.value ?? null],
    ["B", findChinaProvince(alternate)?.name ?? alternate, data.month, data.version, scope, second?.value ?? null],
  ]) : undefined;
  return <PeriodComparison id={generationCompareId} title={scope + " · 省际对照"}
    caption="两个省级地区共享月份、发电指标和发布版本。原始缺测保持为空。"
    first={{
      heading: "基准地区", value: first?.value ?? null, detail: describe(first?.value),
      controls: <AnalysisFilter label="A 省级地区" value={primary} onChange={value => select(value, "region")}>{options}</AnalysisFilter>,
    }}
    second={{
      heading: "对照地区", value: second?.value ?? null, detail: describe(second?.value),
      controls: <AnalysisFilter label="B 省级地区" value={alternate} onChange={value => select(value, "compareRegion")}>{options}</AnalysisFilter>,
    }}
    unit={unit} source={officialProvincial} exportHref={exportHref}
    onSwap={primary !== alternate ? () => updateAnalysisQuery({ region: alternate, compareRegion: primary }) : undefined}
  />;
}

export function AnalysisWorkbench({ topic, initialQuery }: { topic: AnalysisTopic; initialQuery: string }) {
  const query = useAnalysisQuery(initialQuery);
  const context = readWorkspaceContext(query);
  const view = useAnalysisAnchor();
  const year = String(context.year ?? "");
  const powerYear = displayDate(year, powerYears, powerYears[0]);
  const product = generationSeries.find(item => item.id === context.product) ?? generationSeries[0];
  const fuel = fuelSeries.find(item => item.id === query.get("fuel"))?.id ?? fuelSeries[0].id;
  const windRegion = context.region === "north" || context.region === "south" ? context.region : "global";
  const scenarioRegion = context.region ?? "china";
  const scenarioYear = context.year ?? 2050;
  const technology = context.technology ?? "wind";
  const version = query.get("version");
  const releaseVersion = version && /^[a-f0-9]{64}$/.test(version) ? version : null;
  const hasPublishedQuery = publishedAnalysisTopics.some(item => item === topic);
  const published = useResource<PublishedHistory>(hasPublishedQuery ? api + topic + (releaseVersion ? "&version=" + releaseVersion : "") : null);
  const scenario = useResource<RenewableScenario>(topic === "renewables" ? api + topic : null);
  const history = published.data?.facts.some(row => row.value !== null) ? published.data : null;
  const months = topic === "generation" ? generationMonths(history, product.id) : [];
  const displayedMonth = context.month || months.at(-1) || "";
  const regional = useResource<RegionalGeneration>(
    topic === "generation" && history && displayedMonth
      ? `${api}generation&month=${displayedMonth}&version=${history.version}&product=${product.id}` : null,
  );
  const regionChoice = findChinaProvince(context.region);
  const availableRegion = regional.data?.regions.find(item => item.value !== null)?.code;
  const primaryRegion = regionChoice?.code ?? availableRegion ?? (findChinaProvince("CN-HA") ?? chinaProvinces[0]).code;
  const alternateRegion = findChinaProvince(query.get("compareRegion") ?? undefined)?.code
    ?? regional.data?.regions.find(item => item.value !== null && item.code !== primaryRegion)?.code
    ?? chinaProvinces.find(item => item.code !== primaryRegion)?.code ?? primaryRegion;

  const grain = query.get("grain");
  const carbonGrain: CarbonGrain = grain === "month" || (grain !== "day" && !context.date && !!context.month) ? "month" : "day";
  const carbonData = topic === "carbon" ? carbonPeriods(carbonGrain, history) : [];
  const carbonDate = context.date || (carbonGrain === "day" ? carbonData.at(-1)?.period : undefined) || defaultCarbonDate;
  const carbonMonth = context.month || (carbonGrain === "month" ? carbonData.at(-1)?.period : undefined) || carbonDate.slice(0, 7);

  const scenarios = scenario.data?.regions ?? [];
  const selectedScenarioRegion = scenarios.find(item => item.id === scenarioRegion)
    ?? scenarios.find(item => item.id === regionChoice?.iso.toLowerCase()) ?? scenarios[0];
  const scenarioYears = scenario.data
    ? [...new Set(scenario.data.rows.filter(row => row.region === selectedScenarioRegion?.id).map(row => row.year))].sort((a, b) => b - a)
    : [];
  const displayedScenarioYear = scenarioYears.includes(scenarioYear) ? scenarioYear : scenarioYears[0];

  const forecast = topic === "outlook";
  const country = economyCountries.find(item => item.code === context.country)?.code ?? "CHN";
  const countries = forecast ? outlookCountries : economyCountries;
  const hasCountry = countries.some(item => item.code === country);
  const missingCountry = hasCountry ? undefined : economyCountries.find(item => item.code === country);
  const economyYear = economyYears.find(item => item === context.year) ?? latestEconomyYear;
  const startYear = economyYears.find(item => item === Number(query.get("startYear")) && item <= economyYear) ?? economyYears[economyYears.length - 1];
  const economyIndicator = context.metric === "gdp" || query.get("indicator") === "total" ? "total" : "perCapita";
  const outlookYear = outlookYears.find(item => item === (context.targetYear ?? context.year)) ?? outlookYears[0];
  const peerOptions = countries.filter(item => item.code !== country);
  const firstPeer = peerOptions.find(item => item.code === query.get("compareCountry"))?.code
    ?? peerOptions.find(item => item.code === "USA")?.code ?? peerOptions[0]?.code;
  const secondPeer = peerOptions.find(item => item.code !== firstPeer && item.code === query.get("compareThird"))?.code;
  const comparedCountries = [firstPeer, secondPeer].filter((item): item is string => item !== undefined);
  const comparisonMode = query.get("comparisonMode") === "growth" ? "growth" : query.get("comparisonMode") === "index" ? "index" : "value";

  let analysis: Analysis | undefined;
  let filters: ReactNode;
  let dataStatus: string | undefined;
  switch (topic) {
    case "power":
      analysis = buildPowerAnalysis(powerYear);
      filters = <AnalysisFilter label="统计年份" value={powerYear} onChange={value => select(value, "year")}>
        {powerYears.map(item => <option key={item} value={item}>{item} 年</option>)}
      </AnalysisFilter>;
      break;
    case "generation":
      analysis = buildGenerationAnalysis(product.id, displayedMonth, history, regional.data, primaryRegion);
      filters = <>
        <AnalysisFilter label="发电指标" value={product.id} onChange={value => select(value, "product")}>
          {generationSeries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </AnalysisFilter>
        <AnalysisFilter label="查看月份" value={displayedMonth} onChange={value => select(value, "month")}>
          <PeriodOptions options={months.toReversed()} value={displayedMonth} />
        </AnalysisFilter>
        <AnalysisFilter label="省级地区" value={regionChoice?.code ?? ""} onChange={value => select(value, "region")}>
          <option value="">所有省份</option>
          {chinaProvinces.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
        </AnalysisFilter>
      </>;
      break;
    case "fuels":
      analysis = buildFuelAnalysis(fuel, history);
      filters = <AnalysisFilter label="能源品种" value={fuel} onChange={value => select(value, "fuel")}>
        {fuelSeries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </AnalysisFilter>;
      break;
    case "weather":
      analysis = buildWeatherAnalysis(windRegion);
      filters = <AnalysisFilter label="空间范围" value={windRegion} onChange={value => select(value, "region")}>
        {Object.entries(weatherRegions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </AnalysisFilter>;
      break;
    case "renewables":
      dataStatus = scenario.pending ? "读取情景中" : scenario.data?.origin === "database" ? "数据库情景"
        : scenario.data ? "情景归档" : undefined;
      if (scenario.data && selectedScenarioRegion && displayedScenarioYear) {
        analysis = buildRenewableAnalysis(scenario.data, selectedScenarioRegion.id, displayedScenarioYear, technology);
        filters = <>
          <AnalysisFilter label="地区" value={selectedScenarioRegion.id} onChange={value => select(value, "region")}>
            {scenarios.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </AnalysisFilter>
          <AnalysisFilter label="情景年份" value={String(displayedScenarioYear)} onChange={value => select(value, "year")}>
            {scenarioYears.map(item => <option key={item} value={item}>{item} 年</option>)}
          </AnalysisFilter>
          <AnalysisFilter label="季节分析指标" value={technology} onChange={value => select(value, "technology")}>
            <option value="wind">风电</option><option value="solar">光伏</option>
          </AnalysisFilter>
        </>;
      }
      break;
    case "carbon": {
      analysis = buildCarbonAnalysis(carbonDate, history, carbonGrain === "month" ? carbonMonth : undefined);
      filters = <>
        <AnalysisFilter label="统计粒度" value={carbonGrain} onChange={value => select(value, "grain")}>
          <option value="day">日度速率</option><option value="month">月均速率</option>
        </AnalysisFilter>
        <AnalysisFilter label={carbonGrain === "day" ? "日度日期" : "比较月份"}
          value={carbonGrain === "day" ? carbonDate : carbonMonth} onChange={value => select(value, carbonGrain === "day" ? "date" : "month")}>
          <PeriodOptions options={carbonData.toReversed().map(item => item.period)} value={carbonGrain === "day" ? carbonDate : carbonMonth} />
        </AnalysisFilter>
      </>;
      break;
    }
    case "economy":
    case "trade":
    case "outlook": {
      const years = forecast ? outlookYears : economyYears;
      analysis = topic === "economy" ? buildEconomyAnalysis(country, economyYear, economyIndicator, startYear)
        : topic === "trade" ? buildTradeAnalysis(country, economyYear, startYear) : buildOutlookAnalysis(country, outlookYear, comparedCountries);
      if (!forecast) analysis.charts.push(buildEconomicComparison(
        [country, ...comparedCountries], startYear, economyYear,
        topic === "trade" ? "exports" : economyIndicator === "total" ? "gdp" : "perCapita", comparisonMode,
      ));
      dataStatus = forecast ? "世界银行预测" : "WDI 历史统计";
      filters = <>
        <AnalysisFilter label="国家或地区" value={country} onChange={value => select(value, "country")}>
          {missingCountry && <option value={country}>{missingCountry.label}（该版暂无预测）</option>}
          {countries.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
        </AnalysisFilter>
        {!forecast && <AnalysisFilter label="起始年份" value={String(startYear)} onChange={value => select(value, "startYear")}>
          {economyYears.filter(item => item <= economyYear).map(item => <option key={item} value={item}>{item} 年</option>)}
        </AnalysisFilter>}
        <AnalysisFilter label={forecast ? "预测年份" : "结束年份"} value={String(forecast ? outlookYear : economyYear)}
          onChange={value => select(value, forecast ? "targetYear" : "year")}>
          {years.map(item => <option key={item} value={item}>{item} 年</option>)}
        </AnalysisFilter>
        {topic === "economy" && <AnalysisFilter label="地图与排行指标" value={economyIndicator} onChange={value =>
          updateAnalysisQuery({ metric: value === "total" ? "gdp" : "perCapita", indicator: undefined })}>
          {Object.entries(economyIndicators).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </AnalysisFilter>}
      </>;
      break;
    }
  }

  const config = analysisTopics[topic];
  const comparisonId = topic === "carbon" ? carbonCompareId : topic === "generation" ? generationCompareId : undefined;
  const comparisonActive = !!comparisonId && view === comparisonId;
  const selected = analysis?.charts.find(spec => spec.id === view);
  const first = selected ?? analysis?.charts.find(hasChartValues);
  const otherCharts = analysis?.charts.filter(spec => spec.id !== first?.id) ?? [];
  if (hasPublishedQuery) {
    dataStatus = published.pending ? "读取数据库中" : history ? "数据库已发布"
      : releaseVersion ? "请求版本暂不可用 · 当前显示公开归档"
      : topic === "carbon" ? "归档日度数据" : topic === "generation" ? "公开月报选录" : "公开年度公报";
  }

  function emptyMessage(spec: AnalysisChartSpec) {
    if (spec.id === "province-ranking") {
      if (regional.pending || published.pending) return "正在读取已发布的分省发电量。";
      if (!history) return "分省发电量需要已发布数据库。当前可查看全国公开月报。";
      if (!displayedMonth) return "当前指标暂无可选月份。";
      return regional.data ? "这个月份和指标暂无已发布的省级数值。" : "分省数据暂时无法读取。";
    }
    if (spec.id === "carbon-monthly" || spec.id === "carbon-seasonal" || spec.id === "fuel-monthly") {
      return published.pending ? "正在读取数据库中的多年序列。"
        : history ? "当前发布版本没有该指标的有效观测。" : "数据库历史暂不可用。请查看本专题的公报或归档图表。";
    }
    if (spec.id === "emission-by-latitude") return "纬度带格点资料覆盖 2025 年 8 月归档。";
  }

  function chartSelection(spec: AnalysisChartSpec) {
    if (spec.kind === "calendar") return (date: string) => updateAnalysisQuery({ date, grain: "day" });
    if (spec.id === "generation-seasonal" || spec.id === "carbon-seasonal") {
      return (label: string, calendarYear?: string) => {
        const index = monthLabels.indexOf(label);
        if (index < 0 || !calendarYear) return;
        const month = monthKey(calendarYear, index);
        if (topic === "generation") select(month, "month");
        else updateAnalysisQuery({ month, grain: "month" });
      };
    }
    if (spec.id === "province-ranking") return (label: string) => {
      const region = regional.data?.regions.find(item => item.name === label);
      if (region) select(region.code, "region");
    };
    if (spec.id === "renewable-regions") return (label: string) => {
      const region = scenarios.find(item => item.label === label || chineseLabelMatches(item.label, label));
      if (region) select(region.id, "region");
    };
    if (spec.kind === "map" || ["gdp-ranking", "export-relationship", "exports-mix", "growth-ranking"].includes(spec.id)) {
      return (label: string) => {
        const match = countries.find(item => item.label === label);
        if (match) select(match.code, "country");
      };
    }
  }

  function renderFigure(spec: AnalysisChartSpec, primary = false) {
    const withPeers = spec.id === historicalCompareId || spec.id === "growth-comparison";
    return <AnalysisFigure key={spec.id} spec={spec} primary={primary} empty={emptyMessage(spec)} onCategory={chartSelection(spec)}
      controls={withPeers ? <>
        <AnalysisFilter label="B 对照经济体" value={firstPeer ?? ""} onChange={value => select(value, "compareCountry")}>
          {peerOptions.filter(item => item.code !== secondPeer).map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </AnalysisFilter>
        <AnalysisFilter label="C 对照经济体（可选）" value={secondPeer ?? ""} onChange={value => select(value, "compareThird")}>
          <option value="">未添加</option>
          {peerOptions.filter(item => item.code !== firstPeer).map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </AnalysisFilter>
        {!forecast && <AnalysisFilter label="比较方式" value={comparisonMode} onChange={value => select(value, "comparisonMode")}>
          {Object.entries(economyComparisonModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </AnalysisFilter>}
      </> : undefined} />;
  }

  function renderComparison() {
    return topic === "carbon" ? <CarbonComparison history={history} query={query}
      period={carbonGrain === "day" ? carbonDate : carbonMonth} grain={carbonGrain} />
      : <ProvinceComparison data={regional.data} available={Boolean(history)}
        pending={regional.pending || published.pending} primary={primaryRegion} alternate={alternateRegion}
        scope={product.name} unit="亿千瓦时" />;
  }

  return (
    <div className={styles.workbench} data-topic={topic}>
      <aside className={styles.workbenchNav}>
        <nav aria-label="专题图表视图" className={styles.chartNav}>
          <a href="#topic-filters" aria-current={!selected && !comparisonActive ? "location" : undefined} onClick={event => selectView(event, "")}>
            <Compass size={22} strokeWidth={1.65} aria-hidden="true" /><span>概览</span>
          </a>
          {comparisonId && <ComparisonLink id={comparisonId} active={comparisonActive} />}
          {analysis?.charts.map(spec => <ChartLink key={spec.id} spec={spec} active={selected?.id === spec.id} />)}
        </nav>
      </aside>
      <section className={styles.workbenchBody} aria-labelledby="analysis-topic-title">
        <div className={styles.topicHeading}>
          <div>
            <h1 id="analysis-topic-title">{config.title}</h1>
            <p>{analysis?.scope ?? config.description}</p>
          </div>
          <TopicSwitcher topic={topic} query={query} />
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
            {topic === "generation" && history && !regional.pending && !regional.data && displayedMonth && (
              <button type="button" onClick={regional.retry} aria-label="重新读取分省数据">
                <RotateCw size={15} aria-hidden="true" />
              </button>
            )}
            {history && !releaseVersion && (
              <button className={styles.pinRelease} type="button" onClick={() => select(history.version, "version")}>
                固定版本
              </button>
            )}
            {history && releaseVersion && (
              <button className={styles.pinRelease} type="button" onClick={() => select(undefined, "version")}>
                跟随最新版本
              </button>
            )}
            {scenario.data && <span className={styles.scenarioDate}>情景数据生成于 {scenario.data.generatedAt.slice(0, 10)}</span>}
            {history && (
              <details className={styles.release}>
                <summary className={styles.disclosure}>
                  数据版本 <ChevronDown className={styles.chevron} size={14} strokeWidth={1.8} aria-hidden="true" />
                </summary>
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
              {comparisonActive ? renderComparison() : first && renderFigure(first, true)}
              {selected || comparisonActive ? (
                <nav className={styles.moreViews} aria-label="其他图表视图">
                  {comparisonId && !comparisonActive && <ComparisonLink id={comparisonId} />}
                  {(comparisonActive ? analysis.charts : otherCharts).map(spec => <ChartLink key={spec.id} spec={spec} />)}
                </nav>
              ) : (
                <>
                  {comparisonId && <div className={styles.comparisonBelow}><ComparisonLink id={comparisonId} /></div>}
                  <div className={styles.chartGrid}>
                    {otherCharts.filter(hasChartValues).map(spec => renderFigure(spec))}
                  </div>
                </>
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
