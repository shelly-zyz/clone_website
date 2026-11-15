"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined, Globe2, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { analysisContextHref, readWorkspaceContext, rememberWorkspace, replaceWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-context";
import type { MapTheme } from "@/types/opengridworks";
import { EconomyGlobe } from "./EconomyGlobe";
import { ForecastHeading, ForecastSeries } from "./ForecastSidebar";
import { ScenarioPeriods, ScenarioRanking, ScenarioScene } from "./ScenarioScene";
import { WorkspaceFilterSelect, WorkspaceSidebar } from "./WorkspaceSidebar";
import {
  economyMetrics, formatEconomyAmount, formatGrowth, rankEconomies,
  type EconomicOutlook, type EconomyCountry, type EconomyMetric, type EconomyRank, type EconomySnapshot, type EconomyValue,
} from "./economy-data";
import styles from "./EconomyWorkspace.module.css";

const views = [
  { id: "history", label: "统计地图", icon: Globe2 },
  { id: "outlook", label: "增长展望", icon: ChartNoAxesCombined },
] as const;
const metricOptions = Object.entries(economyMetrics).map(([value, { label }]) => ({ value, label }));
const rankFormat = new Intl.NumberFormat("zh-CN");

function useSnapshot<T>(path: string) {
  const [data, setData] = useState<T | null>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Snapshot unavailable");
      return response.json() as Promise<T>;
    }).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setData(null);
    });
    return () => controller.abort();
  }, [attempt, path]);
  return { data, retry: () => { setData(undefined); setAttempt(value => value + 1); } };
}

function SnapshotStatus({ data, label, retry }: { data: unknown; label: string; retry: () => void }) {
  if (data) return null;
  return (
    <p className={styles.status} role="status">
      {data === null ? `${label}暂不可用。` : `正在读取${label}…`}
      {data === null && <button type="button" className={styles.textButton} onClick={retry}>重试</button>}
    </p>
  );
}

function CountrySearch({ countries, onSelect }: { countries: EconomyCountry[]; onSelect: (code: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const term = query.trim().toUpperCase();
  const matches = term ? countries.filter(country => country.label.toUpperCase().includes(term) || country.code.includes(term)).slice(0, 7) : [];
  const choose = (country: EconomyCountry) => {
    onSelect(country.code);
    setQuery("");
  };
  return (
    <div className={styles.search}>
      <label htmlFor={id}>搜索经济体</label>
      <div className={styles.searchField}>
        <Search size={14} aria-hidden="true" />
        <input id={id} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="名称或三字代码"
          onKeyDown={event => {
            if (event.key === "Enter" && matches.length === 1) choose(matches[0]);
            if (event.key === "Escape") setQuery("");
          }} />
      </div>
      {term && (matches.length > 0 ? (
        <ul className={styles.searchResults} aria-label="经济体搜索结果">
          {matches.map(country => (
            <li key={country.code}><button type="button" onClick={() => choose(country)}>
              {country.label}<small>{country.code}</small>
            </button></li>
          ))}
        </ul>
      ) : <p className={styles.status} role="status">没有匹配的经济体。</p>)}
    </div>
  );
}

function ProfilePanel({ open, onOpen, onClose, trigger, children }: {
  open: boolean; onOpen: () => void; onClose: () => void; trigger: RefObject<HTMLButtonElement | null>; children: ReactNode;
}) {
  const id = useId();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && matchMedia("(max-width: 900px)").matches) closeButton.current?.focus({ preventScroll: true });
  }, [open]);

  function close() {
    onClose();
    trigger.current?.focus();
  }

  return (
    <>
      <button ref={trigger} type="button" className={styles.profileTrigger} aria-controls={id} aria-expanded={open} onClick={onOpen}>
        <ChartNoAxesCombined size={16} aria-hidden="true" /> 经济体档案
      </button>
      {open && <button type="button" className={styles.scrim} aria-label="关闭经济体档案" onClick={close} tabIndex={-1} />}
      <aside id={id} className={styles.profile} aria-label="经济体档案" data-open={open}
        onKeyDown={event => { if (event.key === "Escape" && open) close(); }}>
        <button ref={closeButton} type="button" className={styles.close} aria-label="关闭经济体档案" onClick={close}>
          <X size={19} aria-hidden="true" />
        </button>
        {children}
      </aside>
    </>
  );
}

function EconomyProfile({
  country, year, metric, snapshot, ranking, onMetric, onCountry, onYear, onOutlook,
}: {
  country?: EconomyCountry; year: number; metric: EconomyMetric; snapshot?: EconomySnapshot | null;
  ranking: EconomyRank[]; onMetric: (metric: EconomyMetric) => void; onCountry: (code: string) => void;
  onYear: (year: number) => void; onOutlook: () => void;
}) {
  const spec = economyMetrics[metric];
  const years = snapshot?.years ?? [];
  const index = years.indexOf(year);
  const rank = ranking.find(item => item.country.code === country?.code)?.rank;
  const history = country?.values[spec.code] ?? [];
  const currentValue = history[index] ?? null;
  const historyUnit = metric === "perCapita" ? "美元/人" : "亿美元";
  const points = years.slice(0, index + 1).map((date, position) => ({
    date: `${date}-01-01`,
    value: history[position] == null ? null : history[position] / (metric === "perCapita" ? 1 : 1e8),
  }));
  const comparePath = analysisContextHref(metric === "exports" ? "trade" : "economy", {
    country: country?.code, year, metric,
  });
  const tradePath = analysisContextHref("trade", { country: country?.code, year, metric: "exports" });

  return (
    <>
      <header className={styles.profileHeader}>
        <p>{year} 年 · 世界银行 WDI</p>
        <h2>{country?.label ?? "全球概览"}</h2>
        <span>{country ? `${country.code} · 经济体档案` : `${rankFormat.format(ranking.length)} 个经济体有数据`}</span>
      </header>
      {country && (
        <section className={styles.profileIndicators} aria-label="经济指标">
          {(Object.keys(economyMetrics) as EconomyMetric[]).map(item => (
            <button key={item} type="button" aria-pressed={metric === item} onClick={() => onMetric(item)}>
              <span>{economyMetrics[item].label}</span>
              <strong>{formatEconomyAmount(country.values[economyMetrics[item].code][index] ?? null, item)}</strong>
            </button>
          ))}
        </section>
      )}
      {country && (
        <section className={styles.profileSection} aria-label="历史趋势">
          <div className={styles.sectionHeading}>
            <h3>{spec.label}走势</h3>
            <span>{rank ? `第 ${rank} 位` : currentValue === null ? "本年缺测" : ""}</span>
          </div>
          <p className={styles.note}>现价美元 · {historyUnit}</p>
          {points.some(point => point.value !== null)
            ? <ForecastSeries points={points} observed appearance="line" grain="year" unit={historyUnit} label={`${country.label}${spec.label}史`} />
            : <p className={styles.status}>所查时段暂无该指标数据。</p>}
          <details className={styles.history}>
            <summary>历年数据</summary>
            <table>
              <thead><tr><th scope="col">年份</th><th scope="col">{spec.label}</th></tr></thead>
              <tbody>
                {years.map((item, position) => (
                  <tr key={item} data-active={item === year}>
                    <th scope="row"><button type="button" aria-pressed={item === year} onClick={() => onYear(item)}>{item}</button></th>
                    <td>{formatEconomyAmount(history[position] ?? null, metric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}
      <section className={styles.profileSection} aria-label="经济体排行">
        <div className={styles.sectionHeading}>
          <h3>{spec.label}排行</h3>
          <span>{year} 年</span>
        </div>
        {ranking.length ? (
          <ol className={styles.profileRanking}>
            {ranking.slice(0, 6).map(({ country: item, rank: position, value }) => (
              <li key={item.code}>
                <button type="button" aria-pressed={item.code === country?.code} onClick={() => onCountry(item.code)}>
                  <span>{String(position).padStart(2, "0")}</span>
                  <span>{item.label}</span>
                  <strong>{formatEconomyAmount(value, metric)}</strong>
                </button>
              </li>
            ))}
          </ol>
        ) : <p className={styles.status}>该年份暂无可排行的数据。</p>}
      </section>
      <div className={styles.profileLinks}>
        <button type="button" className={styles.outlookAction} onClick={onOutlook}>
          增长展望 <ArrowUpRight size={15} aria-hidden="true" />
        </button>
        <Link href={comparePath} prefetch={false}>{metric === "exports" ? "出口与开放度" : "更多经济分析"} <ArrowUpRight size={13} aria-hidden="true" /></Link>
        {metric !== "exports" && <Link href={tradePath} prefetch={false}>出口与开放度 <ArrowUpRight size={13} aria-hidden="true" /></Link>}
      </div>
      <a className={styles.profileSource} href={`https://data.worldbank.org/indicator/${spec.code}`} target="_blank" rel="noreferrer">
        世界银行 WDI · {snapshot?.updateDates[spec.code] ?? "指标来源"} <ArrowUpRight size={12} aria-hidden="true" />
      </a>
    </>
  );
}

export function EconomyWorkspace({ basemap, onBasemapError, initialContext, onReady }: {
  basemap: MapTheme; onBasemapError: () => void; initialContext?: WorkspaceContext; onReady?: () => void;
}) {
  const { data: snapshot, retry: retrySnapshot } = useSnapshot<EconomySnapshot>("/data/economy/wdi.json");
  const { data: outlook, retry: retryOutlook } = useSnapshot<EconomicOutlook>("/data/economy/gep.json");
  const [countryCode, setCountryCode] = useState(initialContext?.country ?? "");
  const [camera, setCamera] = useState(initialContext?.camera);
  const [yearInput, setYearInput] = useState(initialContext?.year);
  const [metric, setMetric] = useState<EconomyMetric>(initialContext?.metric ?? "gdp");
  const [outlookActive, setOutlookActive] = useState(initialContext?.scene === "outlook");
  const [targetInput, setTargetInput] = useState(initialContext?.targetYear);
  const [profileOpen, setProfileOpen] = useState(false);
  const outlookTrigger = useRef<HTMLButtonElement>(null);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const restoredFocus = useRef(false);
  const outlookBack = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      if (window.location.pathname !== "/workspace" || params.get("topic") !== "economy") return;
      const context = readWorkspaceContext(params);
      setCountryCode(context.country ?? "");
      setCamera(context.camera);
      setYearInput(context.year);
      setMetric(context.metric ?? "gdp");
      setOutlookActive(context.scene === "outlook");
      setTargetInput(context.targetYear);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (restoredFocus.current) {
      const historyTrigger = matchMedia("(max-width: 900px)").matches ? profileTrigger.current : outlookTrigger.current;
      (outlookActive ? outlookBack.current : historyTrigger)?.focus({ preventScroll: true });
      restoredFocus.current = false;
    }
  }, [outlookActive]);

  const countryOptions = useMemo(() => {
    const list = snapshot?.countries.map(({ code, label }) => ({ value: code, label })) ?? [];
    return [{ value: "", label: "全球" }, ...list.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))];
  }, [snapshot]);
  const selected = snapshot?.countries.find(item => item.code === countryCode);
  const country = snapshot && !selected ? "" : countryCode;
  const year = snapshot?.years.find(item => item === yearInput) ?? snapshot?.years.at(-1) ?? yearInput ?? 2024;
  const targetYear = outlook?.years.find(item => item === targetInput) ?? outlook?.years[0] ?? targetInput ?? 2026;
  const values = useMemo<EconomyValue[]>(() => {
    if (!snapshot) return [];
    const column = snapshot.years.indexOf(year);
    return snapshot.countries.map(item => ({ country: item, value: item.values[economyMetrics[metric].code][column] ?? null }));
  }, [snapshot, metric, year]);
  const forecastValues = useMemo<EconomyValue[]>(() => {
    if (!snapshot || !outlook) return [];
    const index = outlook.years.indexOf(targetYear);
    return snapshot.countries.map(item => ({ country: item, value: outlook.values[item.code]?.[index] ?? null }));
  }, [outlook, snapshot, targetYear]);
  const ranking = useMemo(() => rankEconomies(values), [values]);
  const forecastRanking = useMemo(() => rankEconomies(forecastValues), [forecastValues]);

  const chooseCountry = useCallback((id: string) => {
    if (id === countryCode) return;
    setCountryCode(id);
    setCamera(undefined);
    replaceWorkspaceContext({ country: id || null, camera: null });
  }, [countryCode]);
  const pickCountry = useCallback((id: string) => {
    chooseCountry(id);
    if (!outlookActive && window.matchMedia("(max-width: 900px)").matches) setProfileOpen(true);
  }, [chooseCountry, outlookActive]);

  const chooseMetric = (value: EconomyMetric) => {
    setMetric(value);
    replaceWorkspaceContext({ metric: value });
  };
  const chooseYear = (value: number) => {
    setYearInput(value);
    replaceWorkspaceContext({ year: value });
  };
  const chooseTarget = (value: string) => {
    setTargetInput(Number(value));
    replaceWorkspaceContext({ targetYear: Number(value) });
  };
  const chooseView = (next: string) => {
    const nextOutlook = next === "outlook";
    if (nextOutlook === outlookActive) return;
    const url = new URL(window.location.href);
    if (nextOutlook) {
      url.searchParams.set("scene", "outlook");
      url.searchParams.set("targetYear", String(targetYear));
    } else {
      url.searchParams.delete("scene");
    }
    window.history.pushState(null, "", url);
    rememberWorkspace("economy");
    restoredFocus.current = true;
    setProfileOpen(false);
    setOutlookActive(nextOutlook);
  };

  const worldGrowth = outlook?.values.WLT?.[outlook.years.indexOf(targetYear)] ?? null;
  const selectedGrowth = selected ? forecastValues.find(value => value.country.code === selected.code)?.value ?? null : worldGrowth;
  const worldRow = { id: "", label: "全球基准", value: worldGrowth };
  const top = forecastRanking.slice(0, 6).map(({ country: item, value }) => ({ id: item.code, label: item.label, value }));
  const forecastRows = forecastRanking.length ? [worldRow, ...top] : [];
  if (selected && !top.some(row => row.id === selected.code)) {
    forecastRows.splice(1, 0, { id: selected.code, label: selected.label, value: selectedGrowth });
  }
  const predictedSeries = outlook?.years.map((item, index) => ({
    date: `${item}-01-01`, value: outlook.values[selected?.code ?? "WLT"]?.[index] ?? null,
  })) ?? [];
  const statisticsHref = analysisContextHref("outlook", { country: selected?.code ?? "WLT", year, metric, targetYear }, "growth-outlook");
  const historyAnalysis = analysisContextHref(metric === "exports" ? "trade" : "economy", {
    country: selected?.code, year, metric,
  });
  const { min, max } = economyMetrics[metric];
  const yearOptions = snapshot?.years.toReversed().map(value => ({ value: String(value), label: `${value} 年` }))
    ?? [{ value: String(year), label: `${year} 年` }];

  return (
    <>
      <EconomyGlobe basemap={basemap} onBasemapError={onBasemapError} values={outlookActive ? forecastValues : values}
        metric={metric} outlook={outlookActive} selected={selected} country={country} camera={camera} onSelect={pickCountry} onReady={onReady} />
      {!outlookActive ? (
        <>
          <WorkspaceSidebar topic="economy" summary="世界银行 WDI · 全球经济指标" analysisHref={historyAnalysis}>
            <section className={styles.filters} aria-label="经济数据筛选">
              {snapshot && <CountrySearch countries={snapshot.countries} onSelect={chooseCountry} />}
              <WorkspaceFilterSelect label="国家或地区" options={countryOptions} value={country} onChange={chooseCountry} />
              <WorkspaceFilterSelect label="经济指标" value={metric} options={metricOptions}
                onChange={value => { if (value === "gdp" || value === "perCapita" || value === "exports") chooseMetric(value); }} />
              <WorkspaceFilterSelect label="统计年份" options={yearOptions} value={String(year)} onChange={value => chooseYear(Number(value))} />
              <SnapshotStatus data={snapshot} label="经济指标" retry={retrySnapshot} />
              <div className={styles.legend} aria-label="经济指标图例">
                <p>现价美元 · 对数色阶</p>
                <div className={styles.scale} aria-hidden="true" />
                <div className={styles.range}><span>≤ {formatEconomyAmount(min, metric)}</span><span>≥ {formatEconomyAmount(max, metric)}</span></div>
                <p className={styles.missing}><span aria-hidden="true" /> 缺测</p>
              </div>
              <button ref={outlookTrigger} type="button" className={styles.outlookAction} onClick={() => chooseView("outlook")}>
                查看增长展望 <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </section>
          </WorkspaceSidebar>
          <ProfilePanel trigger={profileTrigger} open={profileOpen} onOpen={() => setProfileOpen(true)} onClose={() => setProfileOpen(false)}>
            <EconomyProfile country={selected} year={year} metric={metric} snapshot={snapshot} ranking={ranking}
              onCountry={chooseCountry} onMetric={chooseMetric} onYear={chooseYear} onOutlook={() => chooseView("outlook")} />
          </ProfilePanel>
        </>
      ) : (
        <ScenarioScene title="经济增长展望" period={targetYear} options={views} selectedOption="outlook" onOptionChange={chooseView}
          controls={(
            <div className={styles.sceneControls}>
              <button ref={outlookBack} type="button" className={styles.sceneBack} onClick={() => chooseView("history")}>
                <ArrowLeft size={16} aria-hidden="true" /> 返回统计地图
              </button>
              <WorkspaceFilterSelect label="展望经济体" value={country} options={countryOptions} onChange={chooseCountry} />
            </div>
          )}
          footer={outlook && <ScenarioPeriods periods={outlook.years.map(value => ({ id: String(value), label: String(value) }))}
            selected={String(targetYear)} onSelect={chooseTarget} />}
          summary={(
            <>
              <ForecastHeading topic="economy" />
              <ScenarioRanking title={selected?.label ?? "全球实际 GDP 增速"}
                subtitle={outlook ? `世界银行 GEP · ${outlook.edition} 版` : "世界银行全球经济展望"}
                label={selected ? `${targetYear} 年实际 GDP 增速预测` : `${targetYear} 年预测`}
                value={selectedGrowth === null ? "暂无" : formatGrowth(selectedGrowth)}
                rows={forecastRows} selected={country} onSelect={chooseCountry} formatValue={formatGrowth}>
                <div className={styles.outlookLinks}>
                  <Link href={statisticsHref} prefetch={false}>增长路径与同版对比 <ArrowUpRight size={14} aria-hidden="true" /></Link>
                  {outlook && <a href={outlook.sourceUrl} target="_blank" rel="noreferrer">数据来源 <ArrowUpRight size={12} aria-hidden="true" /></a>}
                </div>
                <div className={styles.outlookLegend} aria-label="实际 GDP 增速色阶">
                  <div className={styles.outlookScale} aria-hidden="true" />
                  <div className={styles.range}><span>−6% 以下</span><span>0%</span><span>10% 以上</span></div>
                  <p className={styles.missing}><span aria-hidden="true" /> 缺测</p>
                </div>
                <SnapshotStatus data={outlook} label="增长展望" retry={retryOutlook} />
                <SnapshotStatus data={snapshot} label="经济体目录" retry={retrySnapshot} />
                {forecastRanking.length > 0 && <p className={styles.note}>显示 {forecastRanking.length} 个有值经济体中的前 {top.length} 位 · 正负值按原值展示</p>}
                {predictedSeries.some(item => item.value !== null) && (
                  <ForecastSeries points={predictedSeries} unit="%" grain="year" label="同版 GDP 增速预测" />
                )}
              </ScenarioRanking>
            </>
          )}
        />
      )}
    </>
  );
}
