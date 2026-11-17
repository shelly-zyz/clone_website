"use client";

import { ArrowDownUp, ArrowRight, ArrowUpRight, BarChart3, CircleHelp, Layers3, Map, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PowerAnalysis } from "@/hooks/use-power-analysis";
import { chinaProvinces } from "@/lib/china-provinces";
import { powerDemoNotice } from "@/lib/china-power-statistics";
import {
  comparisonScatter, emberMethod, formatPowerNumber as number, nationalPowerCode, powerDifference, powerFuels,
  powerLegendColors, powerMeasureLabels, powerPeriodLabel, powerProductAmount, powerRegionName, powerSelectionColors,
  powerSeriesKeys, readPowerMeasure, type PowerGrain, type PowerMeasure, type PowerObservation,
} from "@/lib/power-analysis";
import { generationSeries } from "@/lib/topic-analysis/history";
import { analysisContextHref, type WorkspaceContext } from "@/lib/workspace-context";
import { WorkspaceFilterSelect } from "./WorkspaceSidebar";
import styles from "./PowerRegionPanel.module.css";
import switcherStyles from "./SceneSwitcher.module.css";

type PowerView = NonNullable<WorkspaceContext["powerView"]>;
type Update = (patch: WorkspaceContext) => void;
type Presentation = WorkspaceContext["powerPresentation"];
const failText = "暂无可核实数据";
const grainLabels = { annual: "年度", monthly: "月度", ytd: "年内累计" };
const regionOptions = chinaProvinces.map(({ code, name }) => ({ value: code, label: name }));

export function PowerViews({ view, onView }: { view: PowerView; onView: (view: PowerView) => void }) {
  return (
    <nav className={switcherStyles.bar + " " + switcherStyles.scene} aria-label="电力地图视图">
      <button type="button" aria-pressed={view === "facilities"} onClick={() => onView("facilities")}>设备</button>
      <button type="button" aria-pressed={view !== "facilities"} onClick={() => { if (view === "facilities") onView("generation"); }}>电力分析</button>
    </nav>
  );
}

export function PowerAnalysisFilters({ data, selection, presentation, update, onChoose, onClear }: {
  data: PowerAnalysis; selection: readonly string[]; presentation: Presentation; update: Update;
  onChoose: (code: string) => void; onClear: () => void;
}) {
  const isGeneration = !data.capacity;
  const changeMetric = (powerView: "generation" | "capacity") => {
    if (data.capacity === (powerView === "capacity")) return;
    update({ powerView, powerPeriod: undefined, powerSource: undefined, powerReference: undefined,
      month: undefined, year: undefined, version: undefined, product: undefined, powerDemo: undefined, powerMeasure: undefined });
  };
  const changeGrain = (key: PowerGrain) => {
    if (data.grain === key) return;
    update({ powerPeriod: key === "annual" ? undefined : key, powerSource: key === "annual" && data.source === "yearbook" ? "yearbook" : "ember",
      month: undefined, year: undefined, version: undefined, powerDemo: undefined, powerReference: undefined,
      powerMeasure: data.measure === "change" ? undefined : data.measure });
  };
  const sourceOptions = data.grain === "ytd" ? []
    : [{ value: "ember", label: "Ember · 估算" }, data.grain === "annual" ? { value: "yearbook", label: "中电联 · 统计年鉴" }
      : { value: "nbs", label: "国家统计局 · 发布" }];
  const changePresentation = (mode: Presentation) => {
    if (mode === "split" && !data.reference) return;
    update({ powerPresentation: mode });
  };

  return <section className={styles.filters} aria-label="电力分析筛选">
    <div className={styles.segment} role="group" aria-label="业务指标">
      <button type="button" aria-pressed={isGeneration} onClick={() => changeMetric("generation")}>发电量</button>
      <button type="button" aria-pressed={!isGeneration} onClick={() => changeMetric("capacity")}>装机容量</button>
    </div>
    <div className={styles.field}>
      <span>时间粒度</span>
      <div className={styles.segment} role="group" aria-label="时间粒度">
        {(["annual", "monthly", "ytd"] as const).map(key => <button key={key} type="button" disabled={data.capacity && key !== "annual"}
          aria-pressed={data.grain === key} onClick={() => changeGrain(key)}>{grainLabels[key]}</button>)}
      </div>
    </div>
    {isGeneration && sourceOptions.length > 0 && <WorkspaceFilterSelect label="数据口径" value={data.source} options={sourceOptions}
      onChange={value => update({ powerSource: value === "nbs" || value === "yearbook" ? value : "ember",
        powerDemo: undefined, month: undefined, year: undefined, version: undefined, powerReference: undefined, powerMeasure: undefined,
        product: value === "yearbook" ? undefined : data.product.id })} />}
    {data.demo && <button className={styles.controlButton} type="button" onClick={() =>
      update({ powerDemo: undefined, powerSource: "ember", month: undefined })}>退出演示</button>}
    {isGeneration && data.source !== "yearbook" && <WorkspaceFilterSelect label="电源类型" value={data.product.id}
      options={generationSeries.map(({ id, name }) => ({ value: id, label: id === "thermal-power" && data.source === "ember" ? "火电（含生物质）" : name }))}
      onChange={product => update({ product, powerMeasure: data.measure === "clean" || data.measure === "windsolar" ? undefined : data.measure })} />}
    <WorkspaceFilterSelect label="地图指标" value={data.measure}
      options={(["total", "growth", "change", "clean", "windsolar"] as const).map(key => ({
        value: key, label: key === "total" ? data.capacity ? "装机总量" : "发电量" : key === "change" && data.capacity ? "装机净增量" : powerMeasureLabels[key],
        disabled: !data.available.includes(key),
      }))} onChange={value => update({ powerMeasure: value as PowerMeasure })} />
    <div className={styles.field}>
      <span>地图呈现</span>
      <div className={styles.segment} role="group" aria-label="地图呈现">
        <button type="button" aria-pressed={!presentation} onClick={() => changePresentation(undefined)}><Layers3 size={12} />三维</button>
        <button type="button" aria-pressed={presentation === "flat"} onClick={() => changePresentation("flat")}><Map size={12} />二维</button>
        <button type="button" disabled={!data.reference || data.demo || data.referencePending || !data.referenceCoverage || !data.coverage}
          aria-pressed={presentation === "split"} onClick={() => changePresentation("split")}><ArrowDownUp size={12} />双期</button>
      </div>
    </div>
    {(data.measure === "change" || presentation) && data.referenceOptions.length > 0 &&
      <WorkspaceFilterSelect label="基准期" value={data.reference} options={data.referenceOptions.toReversed()
        .map(value => ({ value, label: powerPeriodLabel(value, data.grain) }))}
        onChange={powerReference => update({ powerReference })} />}
    <WorkspaceFilterSelect label="添加对比省份" value="" options={[{ value: "", label: "点击地图或选择省份", disabled: true },
      ...regionOptions.filter(row => !selection.includes(row.value)).map(row => ({ ...row, disabled: selection.length >= 3 }))]} onChange={onChoose} />
    {selection.length ? <div className={styles.selected} aria-label="已选省份">
      {selection.map((code, i) => <button type="button" key={code} aria-label={"移除" + powerRegionName(code)} onClick={() => onChoose(code)}>
        <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={powerSelectionColors[i]} /></svg>
        {powerRegionName(code)}<X size={12} />
      </button>)}
      <button type="button" onClick={onClear}>清除</button>
    </div> : <p className={styles.muted}>选择最多三个省份，结构、趋势和地区榜单同步更新。</p>}
    {data.capacity || data.source === "yearbook" ? <p className={styles.muted}>
      统计年鉴仅覆盖所示年份。{data.capacity && "省级风光装机占比和设备利用暂无同口径数据。"}
    </p> : null}
  </section>;
}

export function PowerTimeline({ data, update }: { data: PowerAnalysis; update: Update }) {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const periodIndex = Math.max(0, data.periods.indexOf(data.period));
  const playbackKey = [data.source, data.grain, data.capacity, data.product.id].join(":");
  const playing = playingKey === playbackKey && data.periods.length > 1 && !data.demo;
  const next = data.periods[(periodIndex + 1) % data.periods.length];
  const choose = (key: string) => update(data.grain === "annual" ? { year: Number(key) } : { month: key });
  useEffect(() => {
    if (!playing || !next || data.pending) return;
    const timer = window.setTimeout(() => {
      if (document.hidden) { setPlayingKey(null); return; }
      update(data.grain === "annual" ? { year: Number(next) } : { month: next });
    }, 1150);
    return () => window.clearTimeout(timer);
  }, [data.grain, data.pending, next, playing, update]);
  return <section className={styles.timeline} aria-label="电力统计时间轴">
    <div className={styles.timelineMain}>
      {data.periods.length > 1 && <button type="button" className={styles.play} aria-label={playing ? "暂停统计回放" : "播放统计回放"}
        aria-pressed={playing} onClick={() => setPlayingKey(playing ? null : playbackKey)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>}
      <div className={styles.timelineRange}>
        {data.periods.length > 0 ? <input type="range" min="0" max={Math.max(0, data.periods.length - 1)}
          value={periodIndex} disabled={data.periods.length < 2} aria-label="统计时间轴"
          aria-valuetext={powerPeriodLabel(data.period, data.grain)} onChange={event => {
            setPlayingKey(null);
            choose(data.periods[Number(event.currentTarget.value)]);
          }} /> : <span>{data.pending ? "正在读取统计期…" : "暂无可回放数据"}</span>}
        {data.periods.length > 1 && <div><span>{powerPeriodLabel(data.periods[0], data.grain)}</span>
          <span>{powerPeriodLabel(data.periods.at(-1)!, data.grain)}</span></div>}
      </div>
      <select aria-label="统计期" value={data.period || ""} disabled={!data.periods.length} onChange={event => {
        setPlayingKey(null);
        choose(event.currentTarget.value);
      }}>
        {!data.periods.includes(data.period) && <option value={data.period}>{powerPeriodLabel(data.period, data.grain)}</option>}
        {data.periods.toReversed().map(period => <option key={period} value={period}>{powerPeriodLabel(period, data.grain)}</option>)}
      </select>
    </div>
  </section>;
}

export function PowerMapLegend({ data, presentation, bin, onBin }: {
  data: PowerAnalysis; presentation: Presentation; bin: number | null; onBin: (bin: number | null) => void;
}) {
  const frame = data.split?.b ?? data.frame;
  const diverging = frame.encoding === "diverging";
  const colors = powerLegendColors(diverging);
  const begin = diverging ? -frame.scaleMax : 0;
  const end = frame.scaleMax;
  const middle = diverging ? 0 : end / 2;
  return <div className={styles.legend} aria-label="省级地图图例">
    <div className={styles.legendHead}>
      <strong>{frame.label}</strong>
      <span>{presentation ? "分级设色" : "连续色阶"} · {frame.unit}</span>
    </div>
    {end > 0 ? <>
      {presentation ? <div className={styles.bins} role="group" aria-label="图例分级筛选">
        {colors.map((color, i) => {
          const low = begin + (end - begin) * i / colors.length;
          const high = begin + (end - begin) * (i + 1) / colors.length;
          const description = "筛选 " + number(low, frame.unit, diverging) + " 至 " + number(high, frame.unit, diverging);
          return <button type="button" key={color} aria-label={description} title={description} aria-pressed={bin === i}
            onClick={() => onBin(bin === i ? null : i)}><svg viewBox="0 0 20 8" preserveAspectRatio="none" aria-hidden="true">
              <rect width="20" height="8" fill={color} />
            </svg></button>;
        })}
      </div> : <div className={diverging ? styles.diverging : styles.sequential} aria-hidden="true" />}
      <div className={styles.legendTicks}><span>{number(begin, "", diverging)}</span><span>{number(middle)}</span><span>{number(end, "", diverging)}</span></div>
    </> : null}
    {presentation ? <button type="button" className={styles.missing} aria-pressed={bin === -1} onClick={() => onBin(bin === -1 ? null : -1)}>无数据</button>
      : <span className={styles.missing}>无数据</span>}
  </div>;
}

export function PowerMapCaption({ data, presentation, selection, update }: {
  data: PowerAnalysis; presentation: Presentation; selection: readonly string[]; update: Update;
}) {
  const main = selection[0];
  const detail = main ? data.frame.regions.find(row => row.code === main)?.value : data.national;
  return <div className={styles.mapCaption} aria-label="电力分析地图摘要">
    <span>{data.capacity ? "装机" : "发电"} · {data.split ? data.split.a.period + " / " + data.split.b.period : data.frame.period}</span>
    <strong>{data.demo ? "人工合成演示" : powerRegionName(main ?? nationalPowerCode)}</strong>
    <span>{data.pending ? "正在读取" : detail == null || data.demo ? "—" : number(detail, data.frame.unit, data.frame.encoding === "diverging")}</span>
    {presentation === "split" && !data.split && <button type="button" onClick={() => update({ powerPresentation: "flat" })}>
      对照数据不足 · 查看二维
    </button>}
  </div>;
}

function AnalysisCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className={styles.card}><header><h3>{title}</h3>{subtitle && <span>{subtitle}</span>}</header>{children}</section>;
}

const mixKeys = [
  { id: "thermal", label: "火电", color: "#db876c" }, ...powerFuels,
] as const;

function PowerMix({ data, codes, update }: { data: PowerAnalysis; codes: readonly string[]; update: Update }) {
  const fuels = (data.source === "nbs" ? mixKeys.filter(item => !["coal", "gas", "other", "bio"].includes(item.id))
    : powerFuels).filter(({ id }) => codes.some(code => data.current[code]?.mix?.[id] != null));
  if (!fuels.length) return <AnalysisCard title={data.capacity ? "装机结构" : "电源结构"}>
    <p className={styles.muted}>{data.pending ? "正在读取…" : failText}。{data.capacity && "待接入同一统计期的分电源装机。"}</p>
  </AnalysisCard>;
  const aliases: Record<string, string> = { wind: "wind-power", solar: "solar-power", hydro: "hydro-power",
    nuclear: "nuclear-power", thermal: "thermal-power", coal: "thermal-power", gas: "thermal-power", other: "thermal-power", bio: "thermal-power" };
  return <AnalysisCard title="电源结构" subtitle="占当期发电总量">
    {codes.map(code => {
      const row = data.current[code];
      const total = row?.total;
      const available = fuels.some(({ id }) => row?.mix?.[id] != null);
      let x = 0;
      return <div key={code} className={styles.mixRow}>
        <span>{powerRegionName(code)}</span>
        {(total != null && total > 0 && available) ? <svg viewBox="0 0 100 9" preserveAspectRatio="none"
          aria-label={powerRegionName(code) + "电源结构"} aria-describedby={"power-mix-" + code}>
          <rect width="100" height="9" rx="1" fill="#334251" />
          {fuels.map(({ id, label, color }) => {
            const value = row?.mix?.[id];
            if (value == null) return null;
            const share = Math.min(100 - x, Math.max(0, value / total * 100));
            const left = x;
            x += share;
            if (!share) return null;
            return <rect key={id} x={left} width={share} height="9" fill={color}><title>{label + " · " + number(value / total * 100, "%")}</title></rect>;
          })}
        </svg> : <small>{failText}</small>}
        {total != null && total > 0 && available && <div id={"power-mix-" + code} className={styles.mixReadout}>
          {fuels.map(({ id, label }) => <span key={id}>{label} {number(row?.mix?.[id] == null ? null : row.mix[id] / total * 100, "%")}</span>)}
        </div>}
      </div>;
    })}
    <div className={styles.fuels}>{fuels.map(({ id, label, color }) => <button type="button" key={id} aria-pressed={data.product.id === aliases[id]}
      title={"切换至" + (aliases[id] === "thermal-power" && id !== "thermal" ? "火电合计" : label)}
      onClick={() => update({ product: data.product.id === aliases[id] ? "electricity" : aliases[id], powerMeasure: undefined })}>
      <svg width="8" height="8" aria-hidden="true"><rect width="8" height="8" fill={color} /></svg>{label}
    </button>)}</div>
  </AnalysisCard>;
}

function Trend({ data, codes, update }: { data: PowerAnalysis; codes: readonly string[]; update: Update }) {
  const [variable, setVariable] = useState<"value" | "structure">("value");
  const keys = powerSeriesKeys(data.history).filter(key => data.grain !== "ytd" || key.slice(4) === data.period.slice(4));
  const periods = keys.slice(Math.max(0, Math.min(keys.length - 15, keys.indexOf(data.period) - 10)));
  const showMix = variable === "structure" && !data.capacity && codes.length === 1 && periods.some(key => {
    const row = data.history[key][codes[0]];
    return row?.total && powerFuels.some(({ id }) => row.mix?.[id] != null);
  });
  const series = showMix ? powerFuels.filter(({ id }) => periods.some(key => data.history[key][codes[0]]?.mix?.[id] != null))
    .map(({ id, label, color }) => ({ id, label, color, values: periods.map(key => {
      const row = data.history[key][codes[0]];
      return row?.total && row.mix?.[id] != null ? row.mix[id] / row.total * 100 : null;
    }) })) : codes.map((code, i) => ({
      id: code, label: powerRegionName(code), color: codes[0] === nationalPowerCode ? "#77cee4" : powerSelectionColors[i],
      values: periods.map(key => powerProductAmount(data.history[key][code], data.product.id)),
    }));
  const peak = Math.max(0, ...series.flatMap(item => item.values.map(value => value ?? 0)));
  const maximum = showMix ? 100 : peak || 1;
  const count = Math.max(0, ...series.map(item => item.values.filter(value => value != null).length));
  const x = (i: number) => 34 + i * 236 / Math.max(1, periods.length - 1);
  const y = (value: number) => 102 - value / maximum * 83;
  const active = periods.indexOf(data.period);
  const canMix = !data.capacity && codes.length === 1 && periods.some(key => powerFuels.some(({ id }) => data.history[key][codes[0]]?.mix?.[id] != null));
  return <AnalysisCard title={showMix ? "结构变化" : "时序趋势"} subtitle={showMix ? "%" : data.valueUnit}>
    {canMix && <div className={styles.segment + " " + styles.chartTabs} role="group" aria-label="趋势指标">
      <button type="button" aria-pressed={!showMix} onClick={() => setVariable("value")}>规模趋势</button>
      <button type="button" aria-pressed={showMix} onClick={() => setVariable("structure")}>占比变化</button>
    </div>}
    {count < 2 ? <p className={styles.muted}>可比时序不足，至少需要两个有数据的统计期。</p> : <>
      <svg className={styles.chart} viewBox="0 0 280 124" role="img" aria-label={series.map(item => item.label).join("、") + "时序趋势"}>
        {[0, .5, 1].map(t => <g key={t}><line x1="34" x2="271" y1={y(maximum * t)} y2={y(maximum * t)} stroke="#294156" strokeDasharray={t ? "3 3" : undefined} />
          <text x="30" y={y(maximum * t) + 3} textAnchor="end" fill="#adbdcc" fontSize="8">{number(Math.round(maximum * t))}</text></g>)}
        {active >= 0 && <line x1={x(active)} x2={x(active)} y1="13" y2="102" stroke="#acc0d5" strokeDasharray="3 3" />}
        {series.map(item => {
          let prior = false;
          const line = item.values.map((value, i) => {
            if (value == null) { prior = false; return ""; }
            const segment = (prior ? "L" : "M") + x(i) + "," + y(value);
            prior = true;
            return segment;
          }).join("");
          return <g key={item.id}>
            <path d={line} fill="none" stroke={item.color} strokeWidth={showMix && data.product.name === item.label ? 3.8 : 2}
              opacity={showMix && data.product.id !== "electricity" && data.product.name !== item.label ? .52 : 1} />
            {item.values.map((value, i) => value == null ? null : <circle key={i} cx={x(i)} cy={y(value)} r={i === active ? 3.2 : 2.3}
              fill={item.color} className={styles.point}
              onClick={() => update(data.grain === "annual" ? { year: Number(periods[i]) } : { month: periods[i] })}>
              <title>{[item.label, powerPeriodLabel(periods[i], data.grain), number(value, showMix ? "%" : data.valueUnit)].join(" · ")}</title></circle>)}
          </g>;
        })}
        <text x="34" y="118" fill="#adbdcc" fontSize="9">{periods[0]}</text>
        <text x="270" y="118" fill="#adbdcc" textAnchor="end" fontSize="9">{periods.at(-1)}</text>
      </svg>
      {showMix && <div className={styles.fuels}>{series.map(({ id, label, color }) => <span key={id}>
        <svg width="8" height="8" aria-hidden="true"><rect width="8" height="8" fill={color} /></svg>{label}
      </span>)}</div>}
    </>}
  </AnalysisCard>;
}

function RegionComparison({ data, selection, onChoose }: { data: PowerAnalysis; selection: readonly string[]; onChoose: (code: string) => void }) {
  const [order, setOrder] = useState<"map" | "up" | "down">("map");
  const rows = data.frame.regions.map(row => ({
    ...row, delta: powerDifference(powerProductAmount(data.current[row.code], data.product.id), powerProductAmount(data.referenceFrame?.[row.code], data.product.id)),
  }));
  const hasDeltas = rows.some(row => row.delta != null);
  const useDelta = order !== "map" && hasDeltas;
  const field = useDelta ? "delta" : "value";
  const ranked = rows.filter(row => row[field] != null).sort((a, b) => (useDelta && order === "down" ? 1 : -1) * (a[field]! - b[field]!));
  const nationalChange = powerDifference(powerProductAmount(data.current[nationalPowerCode], data.product.id),
    powerProductAmount(data.referenceFrame?.[nationalPowerCode], data.product.id));
  const shown = selection.length ? selection.map(code => rows.find(row => row.code === code)!).filter(Boolean) : ranked.slice(0, 5);
  const limit = Math.max(1, ...shown.map(row => Math.abs(row[field] ?? 0)));
  const signed = useDelta || data.frame.encoding === "diverging";
  const selectedMatch = data.capacity && useDelta ? "装机净变化" : useDelta ? "双期增量" : data.frame.label;
  return <AnalysisCard title="区域比较" subtitle={selection.length ? selection.length + " 个已选省份" : "可点选省份"}>
    {data.reference && <div className={styles.segment + " " + styles.chartTabs} role="group" aria-label="区域排序">
      <button type="button" aria-pressed={!useDelta} onClick={() => setOrder("map")}>地图指标</button>
      <button type="button" disabled={!hasDeltas} aria-pressed={useDelta && order === "up"} onClick={() => setOrder("up")}>增量排行</button>
      <button type="button" disabled={!hasDeltas} aria-pressed={useDelta && order === "down"} onClick={() => setOrder("down")}>下降排行</button>
    </div>}
    {shown.length ? <div className={styles.ranked}>
      {shown.map(row => {
        const value = row[field];
        const index = selection.indexOf(row.code);
        const share = row.delta == null || nationalChange == null || Math.abs(nationalChange) < .01 ? null : row.delta / nationalChange * 100;
        const extent = Math.abs(value ?? 0) / limit * (signed ? 49 : 100);
        return <button key={row.code} type="button" aria-pressed={index >= 0} aria-label={"选择对比 " + powerRegionName(row.code)}
          onClick={() => onChoose(row.code)}>
          <span>{powerRegionName(row.code)}</span><strong>{number(value, useDelta ? data.valueUnit : data.frame.unit, signed)}</strong>
          <svg viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true">
            <rect width="100" height="5" rx="1" fill="#23384a" />
            {signed && <line x1="50" x2="50" y2="5" stroke="#a4adbb" />}
            <rect x={!signed ? 0 : (value ?? 0) < 0 ? 50 - extent : 50} width={extent} height="5" rx="1"
              fill={index >= 0 ? powerSelectionColors[index] : (value ?? 0) < 0 ? "#e47a50" : "#71cbdc"} />
          </svg>
          {useDelta && share != null && <small>占全国净变化 {number(share, "%", true)}</small>}
        </button>;
      })}
    </div> : <p className={styles.muted}>本期{failText}。</p>}
    {data.reference && useDelta && <p className={styles.muted}>{selectedMatch} = 本期 − {powerPeriodLabel(data.reference, data.grain)}；占比以全国发布值的净变化为分母。反向贡献可为负，分省之和可与全国值有差异。</p>}
  </AnalysisCard>;
}

function ChangeWaterfall({ data, onChoose }: { data: PowerAnalysis; onChoose: (code: string) => void }) {
  if (!data.reference || data.referencePending) return null;
  const comparable = data.frame.regions.flatMap(({ code }) => {
    const value = powerDifference(powerProductAmount(data.current[code], data.product.id), powerProductAmount(data.referenceFrame?.[code], data.product.id));
    return value == null ? [] : [{ code, value }];
  });
  if (!comparable.length) return null;
  const largest = comparable.toSorted((a, b) => b.value - a.value);
  const selected = [...largest.filter(row => row.value > 0).slice(0, 2), ...largest.filter(row => row.value < 0).slice(-2).reverse()];
  const rest = comparable.filter(row => !selected.includes(row));
  const total = comparable.reduce((sum, row) => sum + row.value, 0);
  const rows = [...selected, ...(rest.length ? [{ code: "other", value: rest.reduce((sum, row) => sum + row.value, 0) }] : []), { code: "sum", value: total }];
  let cumulative = 0;
  const levels = rows.map(row => {
    const start = row.code === "sum" ? 0 : cumulative;
    const end = start + row.value;
    cumulative = end;
    return { ...row, start, end };
  });
  const floor = Math.min(0, ...levels.flatMap(row => [row.start, row.end]));
  const ceil = Math.max(1, ...levels.flatMap(row => [row.start, row.end]));
  const y = (value: number) => 99 - (value - floor) / (ceil - floor) * 76;
  const spacing = 250 / levels.length;
  const bar = Math.min(32, spacing - 7);
  const x = (i: number) => 22 + (i + .5) * spacing;
  return <AnalysisCard title="省级增减贡献" subtitle={data.valueUnit}>
    <svg className={styles.chart} viewBox="0 0 278 120" aria-label="双期分省变化瀑布图">
      <line x1="16" x2="275" y1={y(0)} y2={y(0)} stroke="#728899" />
      {levels.map((row, index) => {
        const isProvince = row.code !== "other" && row.code !== "sum";
        const name = row.code === "other" ? "其他省" : row.code === "sum" ? "合计" : powerRegionName(row.code).replace(/(?:壮族|回族|维吾尔)?自治区$|[省市]$/u, "");
        return <g key={row.code} tabIndex={isProvince ? 0 : undefined} role={isProvince ? "button" : undefined}
          aria-label={name + " " + number(row.value, data.valueUnit, true)} className={isProvince ? styles.point : undefined}
          onClick={isProvince ? () => onChoose(row.code) : undefined} onKeyDown={isProvince ? event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChoose(row.code); }
          } : undefined}>
          <title>{name + " · " + number(row.value, data.valueUnit, true)}</title>
          <rect x={x(index) - bar / 2} y={Math.min(y(row.start), y(row.end))} width={bar}
            height={Math.max(1, Math.abs(y(row.start) - y(row.end)))} rx="1" fill={row.code === "sum" ? "#a9bfd2" : row.value < 0 ? "#e47a50" : "#6dcdbb"} />
          {index + 1 < levels.length - 1 && <line x1={x(index) + bar / 2} x2={x(index + 1) - bar / 2}
            y1={y(row.end)} y2={y(row.end)} stroke="#728899" strokeDasharray="2 2" />}
          <text x={x(index)} y="113" textAnchor="middle" fontSize="8" fill="#bfd2df">{name}</text>
        </g>;
      })}
    </svg>
    <p className={styles.muted}>{data.frame.period} − {powerPeriodLabel(data.reference, data.grain)}。合计只包括双期都有数据的 {comparable.length} 个省份。</p>
  </AnalysisCard>;
}

function MatchScatter({ data, selection, onChoose }: { data: PowerAnalysis; selection: readonly string[]; onChoose: (code: string) => void }) {
  const [override, setOverride] = useState("");
  const availableYears = ["2022", "2021", "2020"];
  const year = override || (availableYears.includes(data.period) ? data.period : availableYears[0]);
  const records = useMemo(() => comparisonScatter(year), [year]);
  const max = Math.max(1, ...records.flatMap(row => [Math.abs(row.x), Math.abs(row.y)])) * 1.09;
  const stockMax = Math.max(1, ...records.map(row => row.stock));
  return <AnalysisCard title="装机与发电匹配" subtitle="同年同比">
    <WorkspaceFilterSelect label="匹配年份" value={year} options={availableYears.map(value => ({ value, label: value + " 年" }))} onChange={setOverride} />
    {records.length ? <svg className={styles.chart} viewBox="0 0 280 153" aria-label="各省装机增速与发电增速散点图">
      <line x1="40" x2="262" y1="68" y2="68" stroke="#395974" /><line x1="151" x2="151" y1="12" y2="124" stroke="#395974" />
      <line x1="40" x2="262" y1="124" y2="12" stroke="#8a9caa" strokeDasharray="3 3" />
      <text x="8" y="12" fill="#becbd6" fontSize="9">发电同比 %</text>
      <text x="268" y="143" fill="#becbd6" fontSize="9" textAnchor="end">装机同比 %</text>
      {records.map(row => {
        const index = selection.indexOf(row.code);
        return <circle key={row.code} className={styles.point} cx={151 + row.x / max * 111} cy={68 - row.y / max * 56}
          r={3 + Math.sqrt(row.stock / stockMax) * 6} fill={index >= 0 ? powerSelectionColors[index] : "#6ecddf"}
          opacity={index >= 0 ? 1 : .65} stroke="#0d2437" role="button" tabIndex={0}
          aria-label={row.name + "，装机" + number(row.x, "%", true) + "，发电" + number(row.y, "%", true)}
          onClick={() => onChoose(row.code)} onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChoose(row.code); }
          }}>
          <title>{[row.name, "装机 " + number(row.x, "%", true), "发电 " + number(row.y, "%", true), number(row.stock, data.valueUnit)].join(" · ")}</title>
        </circle>;
      })}
    </svg> : <p className={styles.muted}>{year || "所选"}年缺少同源同期发电量。可查看 2020–2022 年。</p>}
    <p className={styles.muted}>散点图使用年鉴中发电量和年末装机都有同比数据的 2020–2022 年。气泡大小表示装机规模，虚线表示两者增速相同。容量因子需要报告期平均装机。</p>
  </AnalysisCard>;
}

function summaryFor(data: PowerAnalysis, code: string) {
  const current: PowerObservation | undefined = data.current[code];
  const previous = data.previousFrame?.[code];
  const total = powerProductAmount(current, data.product.id);
  const growth = readPowerMeasure("growth", current, previous, undefined, data.product.id);
  const clean = readPowerMeasure("clean", current);
  const change = powerDifference(total, powerProductAmount(data.referenceFrame?.[code], data.product.id));
  return { total, growth, clean, change };
}

export function PowerAnalysisRail({ data, selection, update, onChoose }: {
  data: PowerAnalysis; selection: readonly string[]; update: Update; onChoose: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const codes = selection.length ? selection : [nationalPowerCode];
  const code = codes[0];
  const summary = summaryFor(data, code);
  const largest = data.frame.regions.filter(row => row.value != null).toSorted((a, b) => b.value! - a.value!)[0];
  const subtitle = data.capacity ? "年末装机容量" : data.product.name;
  const warning = data.missingArchive ? "分省档案暂不可读取。请稍后重试。"
    : data.missingVersion ? "所选发布版本暂不可读取。" : data.pending ? "正在读取统计数据…"
      : !data.coverage ? "本期暂无分省数据。" : null;
  return <div className={styles.railRegion} data-power-analysis-dock={open ? "open" : "closed"}>
    <button type="button" className={styles.mobileRail} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <BarChart3 size={16} /> {open ? "收起电力解读" : "查看电力解读"}
    </button>
    <aside className={styles.rail} aria-label="电力统计解读">
      <header className={styles.railHeader}><span>中国电力时空分析</span><h2>{powerRegionName(code)}</h2>
        <span>{data.frame.period} · {data.demo ? "演示" : subtitle}</span>
      </header>
      {data.demo ? <AnalysisCard title="演示数据"><p className={styles.muted}>{powerDemoNotice}</p></AnalysisCard> : <>
        <div className={styles.kpis}>
          <div><span>{data.capacity ? "装机容量" : "发电量"}</span><strong>{number(summary.total)}</strong><small>{data.valueUnit}</small></div>
          <div><span>同比变化</span><strong data-negative={(summary.growth ?? 0) < 0}>{number(summary.growth, "%", true)}</strong><small>{data.source === "nbs" && code === nationalPowerCode ? "按已发布同比优先" : "对比上年同期"}</small></div>
          <div><span>{data.capacity ? "装机净变化" : "双期增量"}</span><strong data-negative={(summary.change ?? 0) < 0}>{number(summary.change, "", true)}</strong>
            <small>{data.reference ? "较 " + powerPeriodLabel(data.reference, data.grain) : "暂无基准期"}</small></div>
          {!data.capacity && <div><span>清洁电源占比</span><strong>{number(summary.clean, "%")}</strong><small>按全电源合计</small></div>}
        </div>
        {warning && <p className={styles.notice} role="status">{warning}
          {!data.pending && !data.coverage && data.latestRegionalMonth && data.period !== data.latestRegionalMonth &&
            <button type="button" onClick={() => update({ month: data.latestRegionalMonth ?? undefined })}>查看最近分省月份</button>}
        </p>}
        <PowerMix data={data} codes={codes} update={update} />
        <Trend data={data} codes={codes} update={update} />
        <RegionComparison data={data} selection={selection} onChoose={onChoose} />
        <ChangeWaterfall data={data} onChoose={onChoose} />
        {data.capacity && <MatchScatter data={data} selection={selection} onChoose={onChoose} />}
        <AnalysisCard title="本期观察" subtitle="由统计数据计算">
          <ol className={styles.insights}>
            <li>{summary.total == null ? "当前范围没有可核实的总量。" : powerRegionName(code) + "的" + subtitle + "为 " + number(summary.total, data.valueUnit) + "。"}</li>
            <li>{summary.growth == null ? "缺少同口径同比。" : "与上年同期相比" + (summary.growth < 0 ? "下降 " : summary.growth > 0 ? "增长 " : "持平 ") + number(Math.abs(summary.growth), "%") + "。"}</li>
            {largest && <li><button type="button" onClick={() => onChoose(largest.code)}>{powerRegionName(largest.code)} <ArrowRight size={12} /></button>在 {data.coverage} 个有数据地区中「{data.frame.label}」数值最高。</li>}
            <li>{data.note}</li>
          </ol>
        </AnalysisCard>
        <details className={styles.provenance} open><summary><CircleHelp size={14} /> 数据来源与口径</summary>
          <a href={data.sourceHref} target="_blank" rel="noreferrer">{data.sourceLabel} <ArrowUpRight size={12} /></a>
          <span>{data.sourceDetail && (data.source === "yearbook" ? data.sourceDetail : "发布 " + data.sourceDetail + " · ")}
            {data.source === "yearbook" && data.sourceDetail ? " · " : ""}分省覆盖 {data.coverage}/31</span>
          {data.version && data.source === "nbs" && <span>发布版本 {data.version.slice(0, 12)}</span>}
          {data.source === "ember" && <a href={emberMethod} target="_blank" rel="noreferrer">查看 Ember 估算方法 <ArrowUpRight size={12} /></a>}
          <p>{data.note}</p>
          <p>同比 =（本期 − 上年同期）÷ 上年同期；基准为零或缺失时不计算。双期使用同一来源和时间口径。</p>
        </details>
        <a className={styles.forecastLink} href={analysisContextHref("renewables", {
          region: code === nationalPowerCode ? "china" : chinaProvinces.find(item => item.code === code)?.iso.toLowerCase(),
          technology: data.product.id === "solar-power" ? "solar" : "wind",
        })}>查看同地区风光情景 <ArrowUpRight size={14} /></a>
      </>}
    </aside>
  </div>;
}
