"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReplayView } from "@/lib/weather-replay/views";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { gridCoordinate } from "./replay-geography";
import { utcClock } from "./replay-data";
import styles from "./player.module.css";

type Reading = number | null;
const chartWidth = 242;
const chartHeight = 72;
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
  const last = Math.max(1, points.length - 1);
  const chartX = (index: number) => 1 + index * (chartWidth - 2) / last;
  const chartY = (amount: number) => 4 + (1 - Math.max(0, Math.min(1, amount / limit))) * (chartHeight - 8);
  const path = points.map((amount, index) => amount === null ? "" :
    `${index && points[index - 1] !== null ? "L" : "M"}${chartX(index)} ${chartY(amount)}`).join(" ");
  const current = points[frame];

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
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className={styles.readingsChart}
          role="img" aria-label={`${seriesName}走势，单位 ${unit}，可通过下方时间轴选择回放时刻`}
          onPointerUp={event => {
            const box = event.currentTarget.getBoundingClientRect();
            onFrame(Math.max(0, Math.min(points.length - 1,
              Math.round((event.clientX - box.left) / box.width * last))));
          }}>
          <path d={`M0 4 H${chartWidth} M0 ${chartHeight / 2} H${chartWidth} M0 ${chartHeight - 4} H${chartWidth}`} className={styles.baseline} />
          <path d={path} className={styles.profileLine} />
          <line x1={chartX(frame)} x2={chartX(frame)} y1="0" y2={chartHeight} className={styles.playhead} />
          {current !== null && <circle cx={chartX(frame)} cy={chartY(current)} r="3.5" fill="#ade9f6" />}
        </svg>
        <div className={styles.readingsAxis}><span>{utcClock(replay.rain[0].time)}</span>
          <span>{utcClock(replay.rain[replay.rain.length - 1].time)} UTC</span></div>
        <p className={styles.readingsSource}>PARDIG-NRT · {accumulated ? "档案积分" : "历史档案"}</p>
        <p className={styles.readingsSource}>暂无同区域、同时段的已发布降水预报。</p>
      </div>
    </aside>
  );
}
