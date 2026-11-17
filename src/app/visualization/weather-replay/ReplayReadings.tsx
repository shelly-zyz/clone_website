"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReplayView } from "@/lib/weather-replay/views";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { gridCoordinate } from "./replay-geography";
import { utcClock } from "./replay-data";
import { ForecastVisualization, weatherChartColor } from "@/components/opengridworks/ForecastVisualization";
import styles from "./player.module.css";

type Reading = number | null;
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
  const spansDates = replay.rain[0].time.slice(0, 10) !== replay.rain[last].time.slice(0, 10);
  const samples = points.map((amount, index) => {
    const date = replay.rain[index].time;
    const clock = utcClock(date);
    const tickLabel = spansDates ? `${date.slice(5, 10)} ${clock}` : clock;
    return { date, position: last ? index / last : .5, value: amount, dateLabel: tickLabel + " UTC", tickLabel };
  });
  const current = points[frame];

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
        <section className={styles.readingsFigure} aria-label={chartTitle}>
          <h4 className={styles.readingsCaption}>{chartTitle}<span>UTC</span></h4>
          <ForecastVisualization topic="weather" observed label={`${seriesName}走势，单位 ${unit}。点击图表或使用回放时间轴选择时刻。`}
            unit={unit} formatValue={amount => value(amount, unit)} samples={samples}
            valueCeiling={Math.max(limit, 0.01, ...points.map(amount => amount ?? 0))}
            selectedDate={samples[frame]?.date} onSampleSelect={onFrame} />
        </section>
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
                    fill={amount == null ? "#202934" : weatherChartColor(amount / bandMax)} rx=".85">
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
