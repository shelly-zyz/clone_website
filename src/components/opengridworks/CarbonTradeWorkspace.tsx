"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  economyName, tradePartners, tradeSources, type Footprint, type TradeCatalog, type TradeDirection, type TradeFlow,
} from "@/lib/carbon-trade";
import { CarbonTradeChord } from "./CarbonTradeChord";
import { ForecastVisualization } from "./ForecastVisualization";
import { WorkspaceFilterSelect, WorkspaceSidebar } from "./WorkspaceSidebar";
import styles from "./CarbonTradeWorkspace.module.css";

const endpoint = "/api/carbon-trade";
const measure = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });
const nameSort = new Intl.Collator("zh-CN");
const directions = [{ value: "both", label: "双向" }, { value: "in", label: "流入" }, { value: "out", label: "流出" }] as const;
const emptyFlows: TradeFlow[] = [];
const emptyYears: number[] = [];

type TradeSelection = { year?: number; country?: string; direction?: TradeDirection };

async function getTradeData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-cache" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "无法读取 OECD 数据。");
  return data;
}

function useTradeCatalog(attempt: number) {
  const [result, setResult] = useState<{ attempt: number; data?: TradeCatalog; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void getTradeData<TradeCatalog>(endpoint, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ attempt, data }); },
      error => { if (!controller.signal.aborted) setResult({ attempt, error: error.message }); },
    );
    return () => controller.abort();
  }, [attempt]);
  return result?.attempt === attempt ? result : undefined;
}

function useTradeFrame(year: number | undefined, revision: string | undefined, attempt: number) {
  const [results, setResults] = useState<Record<string, { data?: TradeFlow[]; error?: string }>>({});
  const key = revision && year ? attempt + ":" + revision + ":" + year : undefined;
  const result = key ? results[key] : undefined;
  useEffect(() => {
    if (!key || result || !year || !revision) return;
    const controller = new AbortController();
    const url = endpoint + "?year=" + year + "&revision=" + revision;
    void getTradeData<{ flows: TradeFlow[] }>(url, controller.signal).then(
      ({ flows }) => { if (!controller.signal.aborted) setResults(history => ({ ...history, [key]: { data: flows } })); },
      error => { if (!controller.signal.aborted) setResults(history => ({ ...history, [key]: { error: error.message } })); },
    );
    return () => controller.abort();
  }, [key, result, revision, year]);
  return result;
}

function FootprintBars({ point }: { point: Footprint }) {
  const [, production, consumption] = point;
  const max = Math.max(production, consumption, 1);
  const delta = consumption - production;
  return <>
    <dl className={styles.footprintLabels}>
      <div><dt>生产侧</dt><dd>{measure.format(production)}</dd></div>
      <div><dt>消费侧</dt><dd>{measure.format(consumption)}</dd></div>
    </dl>
    <div className={styles.split} aria-hidden="true">
      <span className={styles.production} ref={node => node?.style.setProperty("--share", String(production / max))} />
      <span className={styles.consumption} ref={node => node?.style.setProperty("--share", String(consumption / max))} />
    </div>
    <p className={styles.delta}>消费 − 生产 <strong data-sign={delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{measure.format(delta)}</strong></p>
  </>;
}

/** Same chart language as the forecast panels: production as the primary series, consumption as the comparison. */
function FootprintTrend({ series, year, onYear }: { series: Footprint[]; year: number; onYear: (year: number) => void }) {
  const sample = (column: 1 | 2) => series.map((row, index) => ({
    date: row[0] + "-01-01", position: series.length > 1 ? index / (series.length - 1) : .5, value: row[column],
    dateLabel: row[0] + " 年", tickLabel: String(row[0]),
  }));
  return <ForecastVisualization topic="carbon" observed label="生产侧碳足迹" unit="Mt CO₂e"
    formatValue={value => measure.format(value) + " Mt"} samples={sample(1)}
    comparison={{ primaryLabel: "生产侧", label: "消费侧", samples: sample(2) }}
    selectedDate={year + "-01-01"} onSampleSelect={index => onYear(series[index][0])} />;
}

export function CarbonTradeWorkspace({ selection, onChange }: {
  selection: TradeSelection;
  onChange: (patch: TradeSelection) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState("");
  const [highlight, setHighlight] = useState<{ selection: string; code: string }>();
  const catalogResult = useTradeCatalog(attempt);
  const catalog = catalogResult?.data;
  const years = catalog?.years ?? emptyYears;
  const year = years.find(period => period === selection.year) ?? years.at(-1);
  const index = year !== undefined ? years.indexOf(year) : -1;
  const frame = useTradeFrame(year, catalog?.revision, attempt);
  const allFlows = frame?.data ?? emptyFlows;
  const selected = selection.country && catalog?.footprints[selection.country] ? selection.country : "W";
  const direction = selection.direction ?? "both";
  const highlightKey = selected + ":" + direction;
  const partner = highlight?.selection === highlightKey ? highlight.code : "";
  const shownEconomy = selected === "W" && hover ? hover : selected;
  const series = catalog?.footprints[shownEconomy] ?? [];
  const point = series.find(row => row[0] === year);
  const max = allFlows[0]?.[2] ?? 0;
  const economies = useMemo(() => Object.keys(catalog?.footprints ?? {}).filter(code => code !== "W")
    .sort((a, b) => nameSort.compare(economyName(a), economyName(b))), [catalog]);

  const directionsFor = (code: string) => (row: TradeFlow) =>
    (direction !== "out" && row[1] === code) || (direction !== "in" && row[0] === code);
  const partners = tradePartners(allFlows, shownEconomy).map(row => ({
    ...row, amount: direction === "both" ? row.in + row.out : row[direction],
  })).filter(row => row.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 5);
  const topPartnerCodes = new Set(partners.map(row => row.code));
  const matching = selected === "W" ? emptyFlows : allFlows.filter(directionsFor(selected));
  const flows = selected === "W"
    ? allFlows.filter((row, i) => i < 760 || (hover && directionsFor(hover)(row)))
    : matching.filter(([from, to], i) => i < 40 || topPartnerCodes.has(from === selected ? to : from));
  const candidate = hover && hover !== selected ? hover : partner;
  const highlightedPartner = selected !== "W" && flows.some(([from, to]) => from === candidate || to === candidate) ? candidate : "";
  const globalPairs = allFlows.slice(0, 5);
  const step = (nextIndex: number) => {
    if (years[nextIndex] === undefined) return;
    setPlaying(false);
    onChange({ year: years[nextIndex] });
  };
  const choose = (country: string, peer = "") => {
    setHover("");
    const nextDirection = country === "W" || peer ? "both" : direction;
    setHighlight(peer ? { selection: country + ":" + nextDirection, code: peer } : undefined);
    onChange({ country, direction: nextDirection });
  };

  useEffect(() => {
    if (!playing || !frame?.data || index < 0) return;
    const next = years[index + 1];
    const timer = setTimeout(() => {
      if (next === undefined) setPlaying(false);
      else onChange({ year: next });
    }, 1050);
    return () => clearTimeout(timer);
  }, [frame, index, playing, years, onChange]);

  const error = catalogResult?.error ?? frame?.error;
  return <>
    <WorkspaceSidebar topic="carbon" summary="OECD · 双边贸易隐含碳">
      <div className={styles.filters}>
        <WorkspaceFilterSelect label="锁定经济体" value={selected}
          options={[{ value: "W", label: "全球" }, ...economies.map(value => ({ value, label: economyName(value) }))]}
          onChange={choose} />
        <div className={styles.rail} aria-label="碳贸易分析">
          <header className={styles.railHeader}>
            <div><span>{selected === "W" && hover ? "悬停预览" : "选中对象"}</span><h3>{economyName(shownEconomy)}</h3></div>
            <span>{year ?? "—"}</span>
          </header>
          <section>
            <h4>生产与消费碳足迹 <small>Mt CO₂e</small></h4>
            {point ? <FootprintBars point={point} /> : <p className={styles.empty}>暂无足迹数据</p>}
          </section>
          <section aria-busy={Boolean(year && !frame)}>
            <h4>{shownEconomy === "W" ? "主要贸易流" : "主要贸易伙伴"} <small>前 5 · Mt CO₂e</small></h4>
            {selected !== "W" && <div className={styles.directions} role="group" aria-label="隐含碳流向">
              {directions.map(({ value, label }) => (
                <button key={value} type="button" aria-pressed={direction === value}
                  onClick={() => { setHighlight(undefined); onChange({ direction: value }); }}>{label}</button>
              ))}
            </div>}
            <ol className={styles.ranking}>
              {shownEconomy === "W" ? globalPairs.map(([from, to, mt]) => (
                <li key={from + to} ref={node => node?.style.setProperty("--share", String(mt / Math.max(1, globalPairs[0][2])))}>
                  <button type="button" onClick={() => choose(from, to)}>
                    <span>{economyName(from)} → {economyName(to)}</span><strong>{measure.format(mt)}</strong>
                  </button></li>
              )) : partners.map(({ code, amount }, rank) => (
                <li key={code} data-rank={rank + 1} ref={node => node?.style.setProperty("--share", String(amount / Math.max(1, partners[0].amount)))}><button type="button" aria-pressed={selected !== "W" && highlightedPartner === code && partner === code}
                  onClick={() => selected === "W" ? choose(code) : setHighlight(partner === code ? undefined : { selection: highlightKey, code })}>
                  <span>{economyName(code)}</span><strong>{measure.format(amount)}</strong>
                </button></li>
              ))}
            </ol>
            {frame?.data && (shownEconomy === "W" ? !globalPairs.length : !partners.length) &&
              <p className={styles.empty}>该流向暂无贸易记录</p>}
          </section>
          <section>
            <h4>历史变化趋势 <small>Mt CO₂e</small></h4>
            {series.length && year ? <FootprintTrend key={shownEconomy} series={series} year={year}
              onYear={next => step(years.indexOf(next))} /> : <p className={styles.empty}>暂无趋势数据</p>}
          </section>
          {catalog && <a className={styles.credit} href={tradeSources.trade} target="_blank" rel="noreferrer"
            title={"原始文件 SHA-256 " + catalog.revision}>OECD GHGFP · {catalog.edition} 版 <ArrowUpRight size={12} /></a>}
        </div>
        <details className={styles.sources}>
          <summary>口径与数据来源</summary>
          <p>弧段按大洲分组，圆环保留 OECD 的「世界其他地区」余额。贸易连线方向为出口方至进口方，宽度对应隐含温室气体排放量。</p>
          <p>贸易使用全部产品和活动的总额，排除本地交易和全球汇总行。单位为百万吨二氧化碳当量（Mt CO₂e）。</p>
          <a href={tradeSources.trade} target="_blank" rel="noreferrer">OECD 双边贸易表 <ArrowUpRight size={13} /></a>
          <a href={tradeSources.footprint} target="_blank" rel="noreferrer">OECD 碳足迹主指标 <ArrowUpRight size={13} /></a>
        </details>
      </div>
    </WorkspaceSidebar>
    <section className={styles.workspace} aria-label="全球隐含碳贸易分析" data-trade-year={frame?.data ? year : undefined}>
      <div className={styles.scene}>
        <header className={styles.title}>
          <div>
            <h2>全球隐含碳贸易网络</h2>
            <p>Global Embodied Carbon Trade Network</p>
          </div>
          {year && <span className={styles.year}>{year}</span>}
        </header>
        <div className={styles.chart}>
          {error ? <div className={styles.message} role="status"><p>{error}</p>
            <button type="button" onClick={() => { setPlaying(false); setAttempt(value => value + 1); }}>重新加载</button>
          </div> : frame?.data ? (
            <CarbonTradeChord flows={flows} maximum={max} selected={selected}
              focus={selected === "W" ? hover : selected} peer={highlightedPartner}
              onFocus={setHover} onChoose={choose} />
          ) : <p className={styles.message} role="status">正在读取 {year ?? "OECD"} 贸易数据…</p>}
        </div>
        <div className={styles.legend}>
          {selected === "W" ? <span>经济体弧段按大洲着色 · 连线按流量加权</span> : <>
            <span><i className={styles.incoming} /> 流入</span>
            <span><i className={styles.outgoing} /> 流出</span>
            <button type="button" onClick={() => choose("W")}>返回全球</button>
          </>}
        </div>
      </div>


      <section className={styles.timeline} aria-label="隐含碳贸易年度回放">
        <button type="button" aria-label="上一年" disabled={index < 1} onClick={() => step(index - 1)}><ChevronLeft size={17} /></button>
        <button type="button" aria-label={playing ? "暂停年度播放" : "播放年度变化"} aria-pressed={playing}
          disabled={years.length < 2 || Boolean(error)} onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (index === years.length - 1) onChange({ year: years[0] });
              setPlaying(true);
            }
          }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <div className={styles.scrubber}>
          <span>{years[0] ?? "1995"}</span><strong>{year ?? "—"}</strong><span>{years.at(-1) ?? "2022"}</span>
          <input type="range" min={0} max={Math.max(0, years.length - 1)} value={Math.max(0, index)}
            aria-label="隐含碳贸易年份" aria-valuetext={year ? String(year) : "暂无年份"} disabled={years.length < 2}
            onChange={event => step(Number(event.currentTarget.value))} />
        </div>
        <button type="button" aria-label="下一年" disabled={index < 0 || index >= years.length - 1}
          onClick={() => step(index + 1)}><ChevronRight size={17} /></button>
      </section>
    </section>
  </>;
}
