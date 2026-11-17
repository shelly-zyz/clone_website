"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, ChevronLeft, ChevronRight, Link2, Pause, Play, Search } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import {
  carbonFrameColorMax, carbonSectorLabels, formatCarbonTotal, formatCarbonValue,
  type CarbonManifestFrame, type CarbonCatalog, type CarbonCatalogFrame,
} from "@/lib/carbon-earth";
import { chineseLabelMatches } from "@/lib/china-provinces";
import { CarbonYearFilter } from "./CarbonYearFilter";
import { WorkspaceFilterSelect } from "./WorkspaceSidebar";
import { VerticalColorLegend } from "./VerticalColorLegend";
import styles from "./CarbonAtlasControls.module.css";

const amount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

type CarbonTime = {
  frames: readonly CarbonCatalogFrame[];
  date: string;
  playing: boolean;
  onDate: (value: string) => void;
  onPlay: (value: boolean) => void;
};

function framesInYear(frames: CarbonTime["frames"], date: string) {
  return frames.filter(item => item.date.startsWith(date.slice(0, 4)));
}

export function CarbonTimeline({ frames, date, playing, onDate, onPlay }: CarbonTime) {
  const yearFrames = framesInYear(frames, date);
  const index = yearFrames.findIndex(item => item.date === date);
  function select(index: number) {
    const next = yearFrames[index];
    if (!next) return;
    onPlay(false);
    onDate(next.date);
  }

  return (
    <section className={styles.timeline} aria-label="排放日期回放">
      <button type="button" aria-label="上一排放日" disabled={index < 1} onClick={() => select(index - 1)}>
        <ChevronLeft size={17} />
      </button>
      <button type="button" disabled={yearFrames.length < 2} aria-label={playing ? "暂停碳排放回放" : "播放碳排放回放"}
        aria-pressed={playing} onClick={() => onPlay(!playing)}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className={styles.scrubber}>
        <span>{yearFrames[0]?.date ?? "日期范围"}</span>
        <strong>{date || "暂无日期"}</strong>
        <span>{yearFrames.at(-1)?.date ?? "—"}</span>
        <input type="range" aria-label="排放时间轴" aria-valuetext={date || "暂无日期"} min={0}
          max={Math.max(0, yearFrames.length - 1)} value={Math.max(0, index)} disabled={yearFrames.length < 2}
          onChange={event => select(Number(event.currentTarget.value))} />
      </div>
      <button type="button" aria-label="下一排放日" disabled={index < 0 || index >= yearFrames.length - 1}
        onClick={() => select(index + 1)}><ChevronRight size={17} /></button>
    </section>
  );
}

export function CarbonMapLegend({ frame, planar, scaleMax }: {
  frame: CarbonManifestFrame | null;
  planar: boolean;
  scaleMax: number;
}) {
  const colors = planar ? ["#3f9f82", "#a7c869", "#f4dc52", "#f27c47", "#fff0cf"]
    : ["#19786d", "#23e6d5", "#e9ff72", "#ff892e", "#fff5cc"];
  const maximum = frame ? planar ? scaleMax : carbonFrameColorMax(frame) : null;
  return <VerticalColorLegend label="碳排放速率" unit="kgC/h" className={styles.mapLegend}
    stops={colors.map((color, index) => [index / (colors.length - 1), color])}
    ticks={[maximum == null ? "—" : amount.format(maximum), "0"]}
    note={planar ? "部门共用对数色阶" : "当日网格对数色阶"} />;
}

export function CarbonAtlasControls({
  manifest, frames, frame, date, sector, regionOptions, region, pending, error, playing,
  compareHref, onRegion, onDate, onSector, onPlay, onShare, onRetry,
}: CarbonTime & {
  manifest: CarbonCatalog | null;
  frame: CarbonManifestFrame | null;
  sector: string;
  regionOptions: { id: string; label: string }[];
  region: string;
  pending: boolean;
  error: string | null;
  compareHref?: string;
  onRegion: (id: string) => void;
  onSector: (value: string) => void;
  onShare: () => void;
  onRetry: () => void;
}) {
  const [lookup, setLookup] = useState("");
  const [unit, setUnit] = useState("co2");
  const searchId = useId();
  const selectedMonth = date.slice(0, 7);
  const yearFrames = framesInYear(frames, date);
  const months = [...new Set(yearFrames.map(item => item.date.slice(0, 7)))].reverse();
  const monthFrames = yearFrames.filter(item => item.date.startsWith(selectedMonth)).reverse();
  const info = frame && manifest?.sources.find(item => item.sector === frame.sector && item.month === frame.date.slice(0, 7));
  const focusLabel = regionOptions.find(item => item.id === region)?.label ?? "全球";
  const total = frame && (unit === "co2"
    ? formatCarbonTotal(frame.stats.sumKgCPerHour).split(" ")[0]
    : amount.format(frame.stats.sumKgCPerHour));

  function locate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = String(new FormData(event.currentTarget).get("region") ?? "").trim().toLocaleLowerCase();
    const exact = regionOptions.find(item => item.id.toLowerCase() === input || chineseLabelMatches(item.label, input));
    const matches = exact ? [exact] : input ? regionOptions.filter(item => item.label.includes(input) || item.id.toLowerCase().includes(input)) : [];
    if (matches.length !== 1) {
      setLookup(matches.length > 1 ? "请从候选地点中选择一项。" : "当前未找到此地点。");
      return;
    }
    setLookup("");
    event.currentTarget.reset();
    onRegion(matches[0].id);
  }

  function selectDate(next: string | undefined) {
    if (!next) return;
    onPlay(false);
    onDate(next);
  }

  return (
    <section className={styles.filters} aria-label="碳排放筛选">
      <form className={styles.location} role="search" onSubmit={locate}>
        <label htmlFor={searchId}>定位国家或地区</label>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <input id={searchId} name="region" list={searchId + "-options"} placeholder={focusLabel}
            onChange={() => setLookup("")} />
          <datalist id={searchId + "-options"}>{regionOptions.map(item => <option key={item.id} value={item.label} />)}</datalist>
          <button type="submit" aria-label="定位搜索结果"><ArrowUpRight size={16} /></button>
        </div>
        {lookup ? <p role="status">{lookup}</p> : null}
      </form>
      <WorkspaceFilterSelect label="排放部门" value={sector}
        options={(manifest?.sectors.length ? manifest.sectors : [sector]).map(key => ({
          value: key, label: carbonSectorLabels[key] ?? key, disabled: !manifest,
        }))} onChange={value => { onPlay(false); onSector(value); }} />
      <details className={styles.group} open>
        <summary>时间筛选</summary>
        <CarbonYearFilter frames={frames} date={date} onDate={selectDate} />
        <div className={styles.dateFields}>
          <WorkspaceFilterSelect label="月份" value={selectedMonth}
            options={[...(months.includes(selectedMonth) ? [] : [{ value: selectedMonth, label: selectedMonth ? selectedMonth + " · 缺测" : "暂无", disabled: true }]),
              ...months.map(value => ({ value, label: value }))]}
            onChange={month => selectDate(yearFrames.findLast(item => item.date.startsWith(month))?.date)} />
          <WorkspaceFilterSelect label="日期" value={date}
            options={[...(monthFrames.some(item => item.date === date) ? [] : [{ value: date, label: date ? date.slice(-2) + " 日 · 缺测" : "暂无", disabled: true }]),
              ...monthFrames.map(item => ({ value: item.date, label: item.date.slice(-2) + " 日" }))]}
            onChange={selectDate} />
        </div>
      </details>
      <details className={styles.group} open>
        <summary>排放摘要</summary>
        <WorkspaceFilterSelect label="全球排放显示单位" value={unit} onChange={setUnit}
          options={[{ value: "co2", label: "百万吨 CO₂ / 日" }, { value: "carbon", label: "千克碳 / 小时" }]} />
        <div className={styles.indicator} aria-label="全球排放摘要" aria-busy={pending}>
          <p>全球 · {carbonSectorLabels[sector] ?? sector}</p>
          <strong aria-live={playing ? "off" : "polite"}>{total ?? "—"}</strong>
          <p>{frame ? `${frame.date} · ${amount.format(frame.stats.nonzeroCount)} 个非零格点` : "GRACED 日尺度排放估算"}</p>
          {frame ? <p>最高网格 {formatCarbonValue(frame.stats.max)}</p> : null}
          {pending ? <p role="status">正在读取 {date || "排放目录"}…</p> :
            error ? <p role="status">{error} <button type="button" onClick={onRetry}>重试</button></p> : null}
        </div>

      </details>
      <details className={styles.group}>
        <summary>排放图层与来源</summary>
        <p className={styles.note}>缩小时显示排放热点。放大后点选网格可查看速率、日期和经纬度。</p>
        <a className={styles.source} href={info?.url ?? "https://carbonmonitor-graced.com/datasets.html"} target="_blank" rel="noreferrer">
          {info?.fileName ?? "GRACED / Carbon Monitor"} <ArrowUpRight size={13} />
        </a>
      </details>
      <div className={styles.tools}>
        {frame ? <a href={frame.endpoint} download={`GRACED-${frame.sector}-${frame.date}.f32.gz`} aria-label="下载当前排放网格" title="下载当前排放网格">
          <ArrowDownToLine size={17} />
        </a> : <button type="button" aria-label="下载当前排放网格" disabled><ArrowDownToLine size={17} /></button>}
        <button type="button" aria-label="分享碳排放地图" title="分享碳排放地图" onClick={onShare}><Link2 size={17} /></button>
        {compareHref ? <Link href={compareHref}>排放对比 <ArrowUpRight size={14} /></Link> : null}
      </div>
    </section>
  );
}
