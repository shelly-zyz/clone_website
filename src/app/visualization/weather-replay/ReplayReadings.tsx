"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReplayView } from "@/lib/weather-replay/views";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { gridCoordinate } from "./replay-geography";
import { utcClock } from "./replay-data";
import { rainScale, scaleColor } from "./replay-palette";
import styles from "./player.module.css";

type Reading = number | null;
const chartWidth = 224;
const chartHeight = 123;
const plot = { left: 25, right: 203, top: 8, bottom: 99 };
const plotWidth = plot.right - plot.left;
const value = (reading: Reading, unit: string) => reading == null ? "缺测" : `${reading.toFixed(1)} ${unit}`;

export function ReplayReadings({ replay, view, frame, cell, peaks, totals, limit, cells, satelliteTime, onFrame }: {
  replay: WeatherReplay;
  view: ReplayView;
  frame: number;
  cell?: number;
  peaks: readonly Reading[];
  totals: readonly Reading[][];
  limit: number;
  cells: readonly number[];
  satelliteTime?: string;
  onFrame: (frame: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const accumulated = view === "accumulation";
  const unit = accumulated ? "mm" : "mm/h";
  const points = cell === undefined ? peaks : accumulated ? totals.map(grid => grid[cell]) : replay.rain.map(item => item.values[cell]);
  const coordinates = cell === undefined ? undefined : gridCoordinate(replay, cell % replay.cols, Math.floor(cell / replay.cols));
  const seriesName = cell === undefined ? "区域峰值" : accumulated ? "选点累计量" : "选点降水率";
  const chartTitle = accumulated ? "累计降水走势" : "降水率走势";
  const last = points.length - 1;
  const chartX = (index: number) => plot.left + index * plotWidth / Math.max(1, last);
  const chartY = (amount: number) => plot.bottom - Math.max(0, Math.min(1, amount / limit)) * (plot.bottom - plot.top);
  const colorAt = (amount: number) => `rgb(${scaleColor(rainScale, amount / limit).join(",")})`;
  const ranges = [0, .2, 2.5, 10, 25];
  const distribution = ranges.map(() => 0);
  let observed = 0, total = 0;
  for (const id of cells) {
    const amount = replay.rain[frame].values[id];
    if (amount == null) continue;
    observed++;
    total += amount;
    distribution[ranges.findLastIndex(bound => amount >= bound)]++;
  }
  const wet = observed - distribution[0];
  const wetShare = observed ? wet / observed * 100 : 0;
  const latitudeBands = [0, 1, 2].map(band => replay.rain.map(item => {
    let sum = 0, count = 0;
    for (const id of cells) {
      if (Math.min(2, Math.floor(Math.floor(id / replay.cols) * 3 / replay.rows)) !== band) continue;
      const amount = item.values[id];
      if (amount != null) { sum += amount; count++; }
    }
    return count ? sum / count : null;
  }));
  const bandMax = Math.max(.2, ...latitudeBands.flat().map(amount => amount ?? 0));
  const segments: { index: number; amount: number }[][] = [];
  let segment: (typeof segments)[number] = [];
  for (const [index, amount] of points.entries()) {
    if (amount === null) {
      segment = [];
      continue;
    }
    if (!segment.length) segments.push(segment);
    segment.push({ index, amount });
  }
  const timeTicks = [...new Set([0, Math.floor(last / 2), last])];
  const current = points[frame];
  const areaId = `${panelId}-area`;
  const accent = "#e8a8bc";

  return (
    <aside className={styles.readings} aria-label="当前场景读数">
      <button className={styles.readingsToggle} type="button" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(!open)}>
        <span>场景读数</span><span>{value(current, unit)} <ChevronDown size={14} aria-hidden="true" /></span>
      </button>
      <div id={panelId} className={styles.readingsBody} data-open={open}>
        <h3>场景读数</h3>
        <div className={styles.metrics}>
          <div><span>{seriesName}</span><strong>{value(current, unit)}</strong></div>
          <div><span>降水格点占比</span><strong>{observed ? wetShare.toFixed(0) + "%" : "缺测"}</strong></div>
        </div>
        <p className={styles.readingsContext}>{coordinates ? `${coordinates[1].toFixed(2)}°，${coordinates[0].toFixed(2)}°` : "点击地图查看格点"}</p>
        <dl className={styles.readingsValues}>
          <div><dt>格点平均降水率</dt><dd>{value(observed ? total / observed : null, "mm/h")}</dd></div>
          <div><dt>有效时刻</dt><dd>{utcClock(replay.rain[frame].time)} UTC</dd></div>
          {view === "weather" && satelliteTime && <div><dt>{replay.metadata ? "总云量帧" : "红外帧"}</dt><dd>{utcClock(satelliteTime)} UTC</dd></div>}
          {accumulated && <div><dt>累计起点</dt><dd>{utcClock(replay.rain[0].time)} UTC</dd></div>}
          {view === "time" && <div><dt>图层间隔</dt><dd>{replay.metadata?.stepMinutes ?? 30} 分钟</dd></div>}
        </dl>
        <figure className={styles.readingsFigure}>
          <figcaption className={styles.readingsCaption}>
            <span>{chartTitle}</span><span>{unit} · UTC</span>
          </figcaption>
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className={styles.readingsChart}
            role="img" aria-label={`${seriesName}走势，单位 ${unit}。点击图表或使用回放时间轴选择时刻。`}
            onPointerUp={event => {
              const box = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - box.left) / box.width * chartWidth;
              const index = Math.round((x - plot.left) * last / plotWidth);
              onFrame(Math.max(0, Math.min(last, index)));
            }}>
            <defs>
              <linearGradient id={areaId} x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0" stopColor="#cf9caa" stopOpacity=".44" />
                <stop offset="1" stopColor="#9382a3" stopOpacity=".03" />
              </linearGradient>
            </defs>
            {[0, limit / 2, limit].map(amount => (
              <g key={amount}>
                <line x1={plot.left} x2={plot.right} y1={chartY(amount)} y2={chartY(amount)} className={styles.readingsGrid} />
                <text x={plot.left - 5} y={chartY(amount)} textAnchor="end" dominantBaseline="middle" className={styles.readingsTick}>{amount}</text>
              </g>
            ))}
            {timeTicks.map(index => (
              <g key={index}>
                <line x1={chartX(index)} x2={chartX(index)} y1={plot.top} y2={plot.bottom} className={styles.readingsGrid} />
                <text x={chartX(index)} y={chartHeight - 7} textAnchor="middle" className={styles.readingsTick}>
                  {utcClock(replay.rain[index].time)}
                </text>
              </g>
            ))}
            {segments.map(run => {
              const first = chartX(run[0].index);
              const path = "M" + run.map(({ index, amount }) => `${chartX(index)} ${chartY(amount)}`).join(" L");
              return (
                <g key={run[0].index}>
                  {run.length > 1 && <path d={`${path} V${plot.bottom} H${first} Z`} fill={`url(#${areaId})`} />}
                  <path d={path} stroke={accent} className={styles.readingsLine} />
                  {run.map(({ index, amount }) => (
                    <circle key={index} cx={chartX(index)} cy={chartY(amount)} r="2.45" fill={colorAt(amount)} className={styles.readingsSample} />
                  ))}
                </g>
              );
            })}
            <path d={`M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}`} className={styles.readingsAxes} />
            <line x1={chartX(frame)} x2={chartX(frame)} y1={plot.top} y2={plot.bottom} stroke={accent} className={styles.readingsPlayhead} />
            {current !== null && <circle cx={chartX(frame)} cy={chartY(current)} r="4.2" fill={colorAt(current)} className={styles.readingsCurrent} />}
            {!segments.length && (
              <text x={(plot.left + plot.right) / 2} y={(plot.top + plot.bottom) / 2}
                textAnchor="middle" className={styles.readingsTick}>暂无有效读数</text>
            )}
          </svg>
        </figure>
        <figure className={styles.readingsFigure}>
          <figcaption className={styles.readingsCaption}><span>降水强度分布</span><span>有效格点 %</span></figcaption>
          {["<0.2", "0.2–2.5", "2.5–10", "10–25", "≥25"].map((label, i) => (
            <div key={label} className={styles.barRow}>
              <span>{label}</span><meter min={0} max={100} value={observed ? distribution[i] / observed * 100 : 0}
                aria-label={label + " mm/h"} /><span>{observed ? (distribution[i] / observed * 100).toFixed(0) : "—"}</span>
            </div>
          ))}
        </figure>
        <figure className={styles.readingsFigure}>
          <figcaption className={styles.readingsCaption}><span>纬带 × 时间</span><span>平均降水率 · mm/h</span></figcaption>
          <svg viewBox="0 0 224 55" role="img" aria-label={`南中北纬带按时刻的平均降水率，色标 0 至 ${bandMax.toFixed(1)} mm/h`}>
            {latitudeBands.map((band, row) => (
              <g key={row}>
                <text x="1" y={row * 14 + 12} className={styles.readingsTick}>{["南", "中", "北"][row]}</text>
                {band.map((amount, i) => (
                  <rect key={i} x={17 + i * 206 / band.length} y={3 + row * 14} width={206 / band.length - 1} height="12"
                    fill={amount == null ? "#222635" : colorAt(amount / bandMax * limit)}>
                    <title>{utcClock(replay.rain[i].time)} UTC · {value(amount, "mm/h")}</title>
                  </rect>
                ))}
              </g>
            ))}
            <text x="17" y="54" className={styles.readingsTick}>{utcClock(replay.rain[0].time)}</text>
            <text textAnchor="end" x="222" y="54" className={styles.readingsTick}>{utcClock(replay.rain[last].time)} UTC</text>
          </svg>
          <p className={styles.readingsSource}>色阶 0–{bandMax.toFixed(1)} mm/h</p>
        </figure>
        <p className={styles.readingsSource}>{replay.metadata ? "NOAA GFS · 历史模式预报" : "PARDIG-NRT · 卫星降水估计"}</p>
      </div>
    </aside>
  );
}
