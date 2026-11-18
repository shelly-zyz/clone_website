"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReplayView } from "@/lib/weather-replay/views";
import type { ReplayFrame, WeatherReplay } from "@/lib/weather-replay/model";
import { ForecastVisualization } from "@/components/opengridworks/ForecastVisualization";
import { gridCoordinate } from "./replay-geography";
import { areaStats, displacement, utcStamp, type Grid, type Hotspot } from "./replay-data";
import styles from "./player.module.css";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const value = (reading: number | null | undefined, unit: string) => reading == null ? "缺测" : `${number.format(reading)} ${unit}`;
const headings: Record<ReplayView, string> = {
  weather: "云雨剖线", time: "降水过程", rain: "热点详情", accumulation: "雨量统计",
};

function ReadingChart({ replay, points, start = 0, frame, label, unit, ceiling, onFrame }: {
  replay: WeatherReplay;
  points: Grid;
  start?: number;
  frame: number;
  label: string;
  unit: string;
  ceiling: number;
  onFrame: (frame: number) => void;
}) {
  const first = Date.parse(replay.rain[start].time);
  const duration = Date.parse(replay.rain[start + points.length - 1].time) - first;
  const samples = points.map((amount, offset) => {
    const date = replay.rain[start + offset].time;
    const tickLabel = utcStamp(date);
    return { date, position: duration ? (Date.parse(date) - first) / duration : .5, value: amount, dateLabel: tickLabel + " UTC", tickLabel };
  });
  return (
    <section className={styles.readingsFigure} aria-label={label}>
      <h4 className={styles.readingsCaption}>{label}<span>{unit}</span></h4>
      <ForecastVisualization topic="weather" observed label={label} unit={unit}
        formatValue={amount => value(amount, unit)} samples={samples}
        valueCeiling={Math.max(ceiling, .01, ...points.map(amount => amount ?? 0))}
        selectedDate={replay.rain[frame].time} onSampleSelect={offset => onFrame(start + offset)} />
    </section>
  );
}

function Profile({ name, unit, data, min = 0, max, column, cloud = false }: {
  name: string;
  unit: string;
  data: Grid;
  min?: number;
  max: number;
  column?: number;
  cloud?: boolean;
}) {
  const scaleX = (index: number) => 6 + 208 * index / (data.length - 1);
  const scaleY = (amount: number) => 45 - 40 * Math.max(0, Math.min(1, (amount - min) / (max - min)));
  const path = data.map((amount, i) => amount == null ? "" :
    (i === 0 || data[i - 1] == null ? "M" : "L") + scaleX(i) + "," + scaleY(amount)).join(" ");
  return (
    <figure className={styles.readingsFigure}>
      <figcaption className={styles.readingsCaption}>{name}<span>{unit}</span></figcaption>
      {data.some(amount => amount != null) ? (
        <>
          <svg viewBox="0 0 220 61" role="img" aria-label={name + "沿 A 至 B 变化"}>
            <path d="M6 45 H214 M6 5 H214" stroke="#456273" fill="none" />
            {column !== undefined && <path stroke="#b3cae0" strokeDasharray="2 3"
              d={`M${scaleX(column)} 5 V45`} />}
            <path d={path} stroke={cloud ? "#acd8eb" : "#ffc589"} strokeWidth="1.5" fill="none" />
            <text x="5" y="58" className={styles.readingsTick}>A · 西</text>
            <text x="215" y="58" textAnchor="end" className={styles.readingsTick}>东 · B</text>
          </svg>
          <p className={styles.readingsSource}>纵轴 {min}–{max} {unit}</p>
        </>
      ) : <p className={styles.readingsSource}>剖线缺测</p>}
    </figure>
  );
}

type Props = {
  replay: WeatherReplay;
  view: ReplayView;
  frame: number;
  cell?: number;
  peaks: Grid;
  totals: Grid[];
  accumulationStart?: number;
  accumulationStats?: ReturnType<typeof areaStats>;
  levels: readonly number[];
  weights: readonly number[];
  limit: number;
  sectionRow?: number;
  slices: number[];
  satellite?: ReplayFrame;
  spots: readonly Hotspot[];
  track: readonly Hotspot[];
  trackId?: number;
  threshold: number;
  onTrack: (id: number) => void;
  onFrame: (frame: number) => void;
};

export function ReplayReadings({
  replay, view, frame, cell, peaks, totals, accumulationStart, accumulationStats, levels, weights, limit,
  sectionRow, slices, satellite, spots, track, trackId, threshold, onTrack, onFrame,
}: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const time = replay.rain[frame].time;
  const rain = replay.rain[frame].values;
  const points = cell === undefined ? peaks : replay.rain.map(item => item.values[cell]);
  const cloudUnit = replay.metadata ? "%" : "K";
  const cloudVariable = replay.metadata ? "总云量" : "红外亮温";
  const coordinates = cell === undefined ? undefined : gridCoordinate(replay, cell % replay.cols, Math.floor(cell / replay.cols));
  const spot = spots.find(item => item.id === trackId);
  const visited = track.filter(item => item.frame <= frame);
  const first = visited[0], last = visited.at(-1);
  const [dx, dy] = first && last ? displacement(replay, first.center, last.center) : [0, 0];
  const distance = Math.hypot(dx, dy);
  const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  const direction = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][Math.round(bearing / 45) % 8];
  const windowPoints = useMemo(() => {
    if (accumulationStart === undefined) return [];
    return totals.slice(0, frame - accumulationStart + 1).map(grid => cell === undefined ? areaStats(grid, weights).mean : grid[cell]);
  }, [accumulationStart, cell, frame, totals, weights]);
  const currentTime = utcStamp(time) + " UTC";
  const summary = view === "rain" ? spot ? value(spot.peak, "mm/h") : `${spots.length} 个热点`
    : view === "accumulation" ? value(windowPoints.at(-1), "mm") : view === "weather" ? currentTime : value(points[frame], "mm/h");

  function details() {
    if (view === "weather") {
      const row = sectionRow === undefined ? undefined : sectionRow * replay.cols;
      const cloud = satellite?.values ?? [];
      return (
        <>
          <p className={styles.readingsContext}>云体高度为示意。沿 A–B 剖线对照同一纬度的云场与地面降水。</p>
          <dl className={styles.readingsValues}>
            <div><dt>降水帧</dt><dd>{currentTime}</dd></div>
            {satellite && <div><dt>{cloudVariable}帧</dt><dd>{utcStamp(satellite.time)} UTC</dd></div>}
            {sectionRow !== undefined && <div><dt>剖线纬度</dt><dd>{gridCoordinate(replay, 0, sectionRow)[1].toFixed(2)}°</dd></div>}
            {cell !== undefined && <>
              {satellite && <div><dt>选点{cloudVariable}</dt><dd>{value(cloud[cell], cloudUnit)}</dd></div>}
              <div><dt>选点降水率</dt><dd>{value(rain[cell], "mm/h")}</dd></div>
            </>}
          </dl>
          {row !== undefined && (
            <>
              {satellite && <Profile name={cloudVariable} unit={cloudUnit} data={cloud.slice(row, row + replay.cols)}
                min={replay.metadata ? 0 : 170} max={replay.metadata ? 100 : 330} column={cell === undefined ? undefined : cell % replay.cols} cloud />}
              <Profile name="地面降水率" unit="mm/h" data={rain.slice(row, row + replay.cols)}
                max={limit} column={cell === undefined ? undefined : cell % replay.cols} />
            </>
          )}
        </>
      );
    }
    if (view === "time") {
      return (
        <>
          <p className={styles.readingsContext}>切片高度按 UTC 时间间隔排列。亮色切片为当前帧。</p>
          <ReadingChart replay={replay} points={points} frame={frame} label={cell === undefined ? "区域峰值降水率" : "选点降水率"} unit="mm/h" ceiling={limit} onFrame={onFrame} />
          <div className={styles.sliceList} role="group" aria-label="时间切片">
            {slices.map(index => <button type="button" key={index} aria-pressed={index === frame} onClick={() => onFrame(index)}>
              <span>{utcStamp(replay.rain[index].time)} UTC</span><strong>{value(peaks[index], "mm/h")}</strong>
            </button>)}
          </div>
        </>
      );
    }
    if (view === "rain") {
      const history = track.length ? replay.rain.slice(track[0].frame, track.at(-1)!.frame + 1).map((_, offset) =>
        track.find(item => item.frame === track[0].frame + offset)?.peak ?? null) : [];
      return (
        <>
          <p className={styles.readingsContext}>以 ≥{threshold} mm/h 的相连格点识别热点。按区域重叠和中心位移关联相邻帧。</p>
          {spots.length ? <label className={styles.readingsSelect}>当前帧热点
            <select value={spot?.id ?? ""} onChange={event => onTrack(Number(event.target.value))}>
              {!spot && <option value="" disabled>选中热点不在当前帧</option>}
              {spots.map(item => <option key={item.id} value={item.id}>热点 {item.id} · {value(item.peak, "mm/h")}</option>)}
            </select>
          </label> : <p className={styles.readingsSource}>当前帧无达到阈值的热点</p>}
          <dl className={styles.readingsValues}>
            {spot && <><div><dt>热点峰值</dt><dd>{value(spot.peak, "mm/h")}</dd></div>
              <div><dt>当前覆盖面积</dt><dd>{value(spot.area, "km²")}</dd></div></>}
            {first && last && first !== last && <>
              <div><dt>已追踪时长</dt><dd>{value((Date.parse(replay.rain[last.frame].time) - Date.parse(replay.rain[first.frame].time)) / 3_600_000, "小时")}</dd></div>
              <div><dt>中心净位移</dt><dd>{value(distance, "km")}{distance >= 1 && " · " + direction}</dd></div>
            </>}
            {first && last && first === last && <div><dt>中心位移</dt><dd>需至少两帧</dd></div>}
          </dl>
          {history.length > 0 && <ReadingChart replay={replay} points={history} start={track[0].frame} frame={frame}
            label="热点强度变化" unit="mm/h" ceiling={Math.max(threshold, ...track.map(item => item.peak))} onFrame={onFrame} />}
        </>
      );
    }
    const maxCell = accumulationStats?.peakCell;
    const grid = accumulationStart === undefined ? undefined : totals[frame - accumulationStart];
    return (
      <>
        <dl className={styles.readingsValues}>
          <div><dt>区域峰值</dt><dd>{value(maxCell === undefined ? null : grid?.[maxCell], "mm")}</dd></div>
          <div><dt>区域面积加权均值</dt><dd>{value(accumulationStats?.mean, "mm")}</dd></div>
          <div><dt>有效覆盖面积</dt><dd>{accumulationStats?.coverage ? value(accumulationStats.coverage, "km²") : "缺测"}</dd></div>
          {cell !== undefined && <div><dt>选点累计量</dt><dd>{value(grid?.[cell], "mm")}</dd></div>}
        </dl>
        <figure className={styles.readingsFigure}>
          <figcaption className={styles.readingsCaption}>阈值覆盖面积<span>km²</span></figcaption>
          {levels.map((level, i) => {
            const coverage = accumulationStats?.coverage ?? 0;
            const area = accumulationStats?.above[i] ?? 0;
            return <div key={level} className={styles.barRow}>
              <span>≥{level} mm</span><meter min={0} max={coverage || 1} value={area} aria-label={`≥${level} mm 的覆盖面积`} />
              <span>{coverage ? number.format(area) : "—"}</span>
            </div>;
          })}
        </figure>
        {windowPoints.length > 0 && <ReadingChart replay={replay} points={windowPoints} start={accumulationStart} frame={frame}
          label={cell === undefined ? "区域平均累计量" : "选点累计量"} ceiling={0} unit="mm" onFrame={onFrame} />}
      </>
    );
  }

  return (
    <aside className={styles.readings} aria-label={headings[view]}>
      <button className={styles.readingsToggle} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <span>{headings[view]}</span><span>{summary} <ChevronDown size={14} aria-hidden="true" /></span>
      </button>
      <div id={panelId} className={styles.readingsBody} data-open={open}>
        <h3>{headings[view]}</h3>
        {details()}
        {coordinates && <p className={styles.readingsContext}>选点 {coordinates[1].toFixed(2)}°，{coordinates[0].toFixed(2)}°</p>}
        <p className={styles.readingsSource}>{replay.metadata ? "NOAA GFS · 历史模式预报" : "PARDIG-NRT · 卫星降水估计"}</p>
      </div>
    </aside>
  );
}
