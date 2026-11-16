"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReplayView } from "@/lib/weather-replay/views";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { gridCoordinate } from "./replay-geography";
import { utcClock } from "./replay-data";
import { accumulationScale, rainScale, scaleColor } from "./replay-palette";
import styles from "./player.module.css";

type Reading = number | null;
const chartWidth = 224;
const chartHeight = 123;
const plot = { left: 25, right: 203, top: 8, bottom: 99 };
const plotWidth = plot.right - plot.left;
const value = (reading: Reading, unit: string) => reading == null ? "缺测" : `${reading.toFixed(1)} ${unit}`;

export function ReplayReadings({ replay, view, frame, cell, peaks, totals, limit, satelliteTime, onFrame }: {
  replay: WeatherReplay;
  view: ReplayView;
  frame: number;
  cell?: number;
  peaks: readonly Reading[];
  totals: readonly Reading[][];
  limit: number;
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
  const colorAt = (amount: number) =>
    `rgb(${scaleColor(accumulated ? accumulationScale : rainScale, accumulated ? amount / limit : amount).join(",")})`;
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
  const accent = colorAt(.7 * limit);

  return (
    <aside className={styles.readings} aria-label="当前场景读数">
      <button className={styles.readingsToggle} type="button" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(!open)}>
        <span>场景读数</span><span>{value(current, unit)} <ChevronDown size={14} aria-hidden="true" /></span>
      </button>
      <div id={panelId} className={styles.readingsBody} data-open={open}>
        <h3>场景读数</h3>
        <p className={styles.readingsContext}>{coordinates ? `${coordinates[1].toFixed(2)}°，${coordinates[0].toFixed(2)}°` : "点击地图查看格点"}</p>
        <dl className={styles.readingsValues}>
          <div><dt>{seriesName}</dt><dd>{value(current, unit)}</dd></div>
          <div><dt>有效时刻</dt><dd>{utcClock(replay.rain[frame].time)} UTC</dd></div>
          {view === "weather" && satelliteTime && <div><dt>红外帧</dt><dd>{utcClock(satelliteTime)} UTC</dd></div>}
          {accumulated && <div><dt>累计起点</dt><dd>{utcClock(replay.rain[0].time)} UTC</dd></div>}
          {view === "time" && <div><dt>图层间隔</dt><dd>30 分钟</dd></div>}
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
                <stop offset="0" stopColor={colorAt(limit * .4)} stopOpacity=".26" />
                <stop offset="1" stopColor={colorAt(0)} stopOpacity=".14" />
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
        <p className={styles.readingsSource}>PARDIG-NRT · {accumulated ? "档案积分" : "历史档案"}</p>
        <p className={styles.readingsSource}>暂无同区域、同时段的已发布降水预报。</p>
      </div>
    </aside>
  );
}
