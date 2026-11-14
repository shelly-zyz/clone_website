"use client";

import Link from "next/link";
import {
  ArrowDownToLine, ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, CircleHelp,
  Globe2, Layers3, Link2, Map as MapIcon, Pause, Play, Search, X,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import {
  carbonSectorLabels, formatCarbonTotal, type CarbonManifestFrame, type CarbonManifest,
} from "@/lib/carbon-earth";
import { chineseLabelMatches } from "@/lib/china-provinces";
import styles from "./CarbonAtlasControls.module.css";

const amount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function CarbonAtlasControls({
  manifest, frames, frame, date, sector, regionOptions, region, pending, error, playing,
  scaleMax, analysisHref, compareHref, onRegion, onDate, onSector, onPlay, onShare, onExit, onRetry,
}: {
  manifest: CarbonManifest | null;
  frames: CarbonManifestFrame[];
  frame: CarbonManifestFrame | null;
  date: string;
  sector: string;
  regionOptions: { id: string; label: string }[];
  region: string;
  pending: boolean;
  error: string | null;
  playing: boolean;
  scaleMax: number | null;
  analysisHref?: string;
  compareHref?: string;
  onRegion: (id: string) => void;
  onDate: (value: string) => void;
  onSector: (value: string) => void;
  onPlay: (value: boolean) => void;
  onShare: () => void;
  onExit: () => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState("");
  const [panel, setPanel] = useState<"legend" | "layers" | null>(null);
  const searchId = useId();
  const toolsId = useId();
  const details = useRef<HTMLDivElement>(null);
  const first = frames[0]?.date;
  const index = frames.findIndex(item => item.date === date);
  const selectedMonth = date.slice(0, 7);
  const months = [...new Set(frames.map(item => item.date.slice(0, 7)))];
  const monthFrames = frames.filter(item => item.date.startsWith(selectedMonth));
  const info = frame && manifest?.sources.find(item => item.sector === frame.sector && item.month === frame.date.slice(0, 7));
  const amountValue = frame ? formatCarbonTotal(frame.stats.sumKgCPerHour).split(" ")[0] : null;
  const archiveLabel = info?.fileName ?? "GRACED / Carbon Monitor";

  function locate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = query.trim().toLocaleLowerCase();
    const exact = regionOptions.find(item => item.id.toLowerCase() === input || chineseLabelMatches(item.label, input));
    const matches = exact ? [exact] : input ? regionOptions.filter(item => item.label.includes(input) || item.id.toLowerCase().includes(input)) : [];
    if (matches.length !== 1) {
      setLookup(matches.length > 1 ? "请从候选地点中选择一项。" : "当前未找到此地点。");
      return;
    }
    setLookup("");
    setQuery(matches[0].id === "global" ? "" : matches[0].label);
    onRegion(matches[0].id);
  }

  function selectDate(next: string | undefined) {
    if (!next) return;
    onPlay(false);
    onDate(next);
  }

  return (
    <div className={styles.ui}>
      <header className={styles.toolbar} aria-label="碳排放地图筛选">
        <button className={styles.back} type="button" onClick={onExit} aria-label="返回碳地球">
          <ArrowLeft size={17} aria-hidden="true" /> <span>碳排放地球</span>
        </button>
        <form className={styles.search} role="search" onSubmit={locate}>
          <Search size={16} aria-hidden="true" />
          <input list={searchId} aria-label="搜索国家、地区或省份"
            placeholder={regionOptions.find(item => item.id === region)?.label ?? "搜索国家、地区或省份"}
            value={query} onChange={event => { setQuery(event.currentTarget.value); setLookup(""); }} />
          <datalist id={searchId}>{regionOptions.map(item => <option key={item.id} value={item.label} />)}</datalist>
          <button type="submit" aria-label="定位搜索结果"><ArrowUpRight size={15} /></button>
          {lookup ? <span className={styles.lookup} role="status">{lookup}</span> : null}
        </form>
        <label className={styles.control}>部门
          <select value={sector} disabled={!manifest?.sectors.length} onChange={event => onSector(event.currentTarget.value)}>
            {(manifest?.sectors.length ? manifest.sectors : [sector]).map(key => <option key={key} value={key}>{carbonSectorLabels[key] ?? key}</option>)}
          </select>
        </label>
        <label className={styles.control}>月份
          <select value={selectedMonth} disabled={!months.length} onChange={event => selectDate(frames.findLast(item => item.date.startsWith(event.currentTarget.value))?.date)}>
            {!months.length ? <option value={selectedMonth}>暂无</option> : null}
            {months.length > 0 && selectedMonth && !months.includes(selectedMonth) ? <option value={selectedMonth}>{selectedMonth} · 缺测</option> : null}
            {months.toReversed().map(month => <option key={month}>{month}</option>)}
          </select>
        </label>
        <label className={styles.control}>日期
          <select value={date} disabled={!monthFrames.length} onChange={event => selectDate(event.currentTarget.value)}>
            {!monthFrames.length ? <option value={date}>{date || "暂无"}</option> : null}
            {monthFrames.length > 0 && !monthFrames.some(item => item.date === date) ? <option value={date}>{date.slice(-2)} 日 · 缺测</option> : null}
            {monthFrames.toReversed().map(item => <option key={item.date} value={item.date}>{item.date.slice(-2)} 日</option>)}
          </select>
        </label>
        <span className={styles.unit}>CO₂</span>
      </header>

      <aside className={styles.indicator} aria-label="全球排放摘要" aria-busy={pending}>
        <p className={styles.eyebrow}>全球 · {carbonSectorLabels[frame?.sector ?? sector] ?? sector}</p>
        <div className={styles.number} aria-live={playing ? "off" : "polite"}>
          <strong>{amountValue ?? "—"}</strong>
          <span>百万吨 CO₂ / 日</span>
        </div>
        <p>{frame ? <>{frame.date} · {amount.format(frame.stats.nonzeroCount)} 个非零格点</> : "GRACED 日尺度排放估算"}</p>
        {pending ? <p role="status">正在读取 {date || "排放目录"}…</p>
          : error ? <p role="status">{error} <button type="button" onClick={onRetry}>重试</button></p>
            : null}
      </aside>

      <section className={styles.timeline} aria-label="排放日期回放">
        <button type="button" aria-label="上一排放日" disabled={index < 1} onClick={() => selectDate(frames[index - 1]?.date)}>
          <ChevronLeft size={17} />
        </button>
        <button type="button" disabled={frames.length < 2} aria-label={playing ? "暂停碳排放回放" : "播放碳排放回放"}
          aria-pressed={playing} onClick={() => onPlay(!playing)}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <label>
          <span>{first ?? "日期范围"}</span>
          <input type="range" aria-label="排放时间轴" aria-valuetext={date || "暂无日期"} min={0}
            max={Math.max(0, frames.length - 1)} value={Math.max(0, index)} disabled={frames.length <= 1}
            onChange={event => selectDate(frames[Number(event.currentTarget.value)]?.date)} />
          <span>{frames.at(-1)?.date ?? "—"}</span>
        </label>
        <button type="button" aria-label="下一排放日" disabled={index < 0 || index >= frames.length - 1}
          onClick={() => selectDate(frames[index + 1]?.date)}><ChevronRight size={17} /></button>
      </section>

      <div className={styles.actions} ref={details} onKeyDown={event => {
        if (event.key === "Escape" && panel) {
          setPanel(null);
          details.current?.querySelector<HTMLButtonElement>("button[aria-expanded='true']")?.focus();
        }
      }}>
        {panel ? (
          <aside className={styles.details} id={toolsId} aria-label={panel === "legend" ? "排放图例" : "排放图层"}>
            <header><strong>{panel === "legend" ? "排放图例" : "排放图层"}</strong>
              <button type="button" aria-label="关闭工具面板" onClick={() => setPanel(null)}><X size={17} /></button>
            </header>
            {panel === "legend" ? <>
              <div className={styles.ramp} />
              <p className={styles.endpoints}><span>低 · 0</span><span>高 · {scaleMax ? amount.format(scaleMax) : "—"} kgC/h</span></p>
              <p>{frame ? `${frame.grid.dx}° × ${frame.grid.dy}° 网格。` : ""}颜色按格点速率的对数色阶绘制，同一部门各日期共用色阶。图中大数为全球每小时碳质量换算为每日 CO₂ 质量。</p>
              {info ? <a href={info.url} target="_blank" rel="noreferrer">{archiveLabel} <ArrowUpRight size={13} /></a>
                : <a href="https://carbonmonitor-graced.com/datasets.html" target="_blank" rel="noreferrer">{archiveLabel} <ArrowUpRight size={13} /></a>}
            </> : <>
              <p>当前：{carbonSectorLabels[sector] ?? sector}排放格点</p>
              <p>缩小时显示低密度的排放热点，放大后可点选每个格点查看速率、日期及经纬度。</p>
              <button type="button" onClick={onExit}><Globe2 size={15} /> 切换 3D 地球</button>
            </>}
          </aside>
        ) : null}
        <div className={styles.buttons}>
          <button type="button" onClick={() => setPanel(panel === "legend" ? null : "legend")} aria-expanded={panel === "legend"} aria-controls={panel ? toolsId : undefined}>
            <CircleHelp size={16} /> <span>图例</span>
          </button>
          <button type="button" aria-label="查看排放图层" onClick={() => setPanel(panel === "layers" ? null : "layers")} aria-expanded={panel === "layers"} aria-controls={panel ? toolsId : undefined}>
            <Layers3 size={17} />
          </button>
          {frame ? <a href={frame.endpoint} download={`GRACED-${frame.sector}-${frame.date}.f32.gz`} aria-label="下载当前排放网格">
            <ArrowDownToLine size={17} aria-hidden="true" />
          </a> : <button type="button" aria-label="下载当前排放网格" disabled><ArrowDownToLine size={17} /></button>}
          <button type="button" aria-label="分享碳排放地图" onClick={onShare}><Link2 size={17} /></button>
          {compareHref ? <Link href={compareHref} className={styles.compare}><MapIcon size={16} /> 对比</Link> : null}
          {analysisHref ? <Link href={analysisHref} className={styles.more}>查看详情 <ArrowUpRight size={16} /></Link> : null}
        </div>
      </div>
    </div>
  );
}
