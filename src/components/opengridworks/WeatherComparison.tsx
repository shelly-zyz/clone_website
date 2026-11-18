"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { ChevronDown, Pause, Play } from "lucide-react";
import { scaleColor } from "@/app/visualization/weather-replay/replay-palette";
import { ForecastHeading, ForecastSeries } from "./ForecastSidebar";
import { VerticalColorLegend } from "./VerticalColorLegend";
import styles from "./WeatherComparison.module.css";

const fields = {
  t2m: { short: "T2m", name: "2 米气温", unit: "°C", range: [-62, 44] },
  u10: { short: "U10", name: "10 米纬向风", unit: "m/s", range: [-21, 21] },
  z500: { short: "Z500", name: "500 hPa 位势高度", unit: "m", range: [4840, 6040] },
  t850: { short: "T850", name: "850 hPa 气温", unit: "°C", range: [-56, 34] },
} as const;
type Metric = keyof typeof fields;
type FieldSource = "analysis" | "forecast";
const metrics = Object.keys(fields) as Metric[];
const colors = [[0, [42, 53, 105]], [.20, [75, 109, 174]], [.38, [85, 158, 180]],
  [.56, [134, 192, 172]], [.72, [184, 216, 168]], [.87, [233, 217, 160]], [1, [208, 154, 111]]] as const;
const windColors = [[0, [58, 83, 153]], [.24, [81, 146, 179]], [.5, [205, 222, 217]],
  [.75, [227, 195, 139]], [1, [186, 113, 91]]] as const;
const colorScale = (metric: Metric) => metric === "u10" ? windColors : colors;

type PackedField = { analysis: string; forecast: string; quantum: number; unit: string };
type Frame = { time: string; forecastSource: string; fields: Record<Metric, PackedField> };
type WeatherArchive = { schema: number; run: string; cols: number; rows: number; step: number; analysisSource: string; frames: Frame[] };
type Maps = Record<Metric, Record<FieldSource, HTMLCanvasElement>>;

const archivePath = "/data/weather-replay/global-20220322.json";
const coastPath = "/data/natural-earth/ne_50m_admin_0_countries.geojson";
const defaultFrame = 1;

function makeRaster(field: PackedField, source: FieldSource, metric: Metric, cols: number, rows: number) {
  const input = Uint8Array.from(atob(field[source]), char => char.charCodeAt(0));
  if (input.byteLength !== 2 * cols * rows) throw new Error("Unexpected global grid size.");
  const encoded = new DataView(input.buffer);
  const canvas = document.createElement("canvas");
  canvas.width = cols + 1;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The comparison canvas is not available.");
  const image = ctx.createImageData(canvas.width, rows);
  const [low, high] = fields[metric].range;
  // The data starts at the prime meridian. Roll it so the overview maps start at 180°W.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x <= cols; x++) {
      const raw = encoded.getInt16(2 * (cols * y + (x + cols / 2) % cols), true);
      if (raw === -32768) continue;
      const percentage = (raw * field.quantum - low) / (high - low);
      const offset = 4 * (y * canvas.width + x);
      image.data.set(scaleColor(colorScale(metric), percentage), offset);
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Area-weighted global mean; rows run from 90°N to 90°S. */
function globalMean(field: PackedField, source: FieldSource, cols: number, rows: number) {
  const input = Uint8Array.from(atob(field[source]), char => char.charCodeAt(0));
  const encoded = new DataView(input.buffer);
  let sum = 0, weights = 0;
  for (let y = 0; y < rows; y++) {
    const weight = Math.cos((90 - y * 180 / (rows - 1)) * Math.PI / 180);
    for (let x = 0; x < cols; x++) {
      const raw = encoded.getInt16(2 * (cols * y + x), true);
      if (raw === -32768) continue;
      sum += raw * field.quantum * weight;
      weights += weight;
    }
  }
  return weights ? sum / weights : null;
}

function drawMap(canvas: HTMLCanvasElement, raster: HTMLCanvasElement, land: GeoPermissibleObjects | undefined) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(raster, 0, 0, canvas.width, canvas.height);
  if (!land) return;
  ctx.beginPath();
  geoPath(geoEquirectangular().scale(canvas.width / (2 * Math.PI))
    .translate([canvas.width / 2, canvas.height / 2]), ctx)(land);
  ctx.strokeStyle = "rgba(225, 240, 246, .40)";
  ctx.lineWidth = .55;
  ctx.stroke();
}

function MiniMap({ raster, land, label }: { raster: HTMLCanvasElement; land?: GeoPermissibleObjects; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawMap(ref.current, raster, land); }, [raster, land]);
  return <canvas className={styles.mini} ref={ref} width={240} height={121} role="img" aria-label={label} />;
}

const timeText = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

export function WeatherComparisonPanel() {
  const [archive, setArchive] = useState<WeatherArchive>();
  const [land, setLand] = useState<GeoPermissibleObjects>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [index, setIndex] = useState(defaultFrame);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rendered, setRendered] = useState<{ frame: Frame; maps: Maps }>();
  const panelId = useId();
  const panel = useRef<HTMLElement>(null);
  const frame = archive?.frames[index];
  // GFS forecast of the global mean 2 m temperature, checked against ERA5 at each valid time.
  const trend = useMemo(() => archive && {
    forecast: archive.frames.map(({ time, fields: values }) => ({ date: time, value: globalMean(values.t2m, "forecast", archive.cols, archive.rows) })),
    analysis: archive.frames.map(({ time, fields: values }) => ({ date: time, value: globalMean(values.t2m, "analysis", archive.cols, archive.rows) })),
  }, [archive]);

  useEffect(() => {
    const controller = new AbortController();
    const read = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("Weather comparison is unavailable");
      return response.json();
    };
    void read(archivePath).then((data: WeatherArchive) => {
      if (data.schema !== 1 || data.cols !== 120 || data.rows !== 61 || data.frames.length < 2) throw new Error("Invalid archive.");
      if (!controller.signal.aborted) setArchive(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    void read(coastPath).then((data: GeoPermissibleObjects) => {
      if (!controller.signal.aborted) setLand(data);
    }).catch(() => {});
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!archive || !frame) return;
    const next = requestAnimationFrame(() => {
      try {
        const maps = Object.fromEntries(metrics.map(key => [key, {
          analysis: makeRaster(frame.fields[key], "analysis", key, archive.cols, archive.rows),
          forecast: makeRaster(frame.fields[key], "forecast", key, archive.cols, archive.rows),
        }])) as Maps;
        setRendered({ frame, maps });
      } catch {
        setPlaying(false);
        setError(true);
      }
    });
    return () => cancelAnimationFrame(next);
  }, [archive, frame]);

  useEffect(() => {
    if (!playing || !archive || error) return;
    const id = window.setTimeout(() => {
      if (index + 1 >= archive.frames.length) setPlaying(false);
      else setIndex(index + 1);
    }, 770);
    return () => window.clearTimeout(id);
  }, [archive, error, index, playing]);

  useEffect(() => {
    if (expanded) panel.current?.scrollIntoView({ block: "start" });
  }, [expanded]);

  return (
    <aside ref={panel} className={styles.comparison} aria-label="空间对照" data-expanded={expanded}>
      <ForecastHeading topic="weather">
        <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={panelId}
          aria-label={expanded ? "收起气象预报" : "展开气象预报"}
          onClick={() => setExpanded(!expanded)}>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </ForecastHeading>
      <div className={styles.body} id={panelId}>
        {archive && rendered && !error ? (
          <>
            {trend && (
              <section className={styles.forecast} aria-label="GFS 全球预报">
                <h3>全球 2 米气温预报</h3>
                <p>NOAA GFS · 起报 {timeText(archive.run)} · 面积加权均值</p>
                <ForecastSeries chart="weather" points={trend.forecast} unit="°C" grain="hour" label="GFS 预报"
                  comparison={{ primaryLabel: "GFS 预报", label: "ERA5 再分析", points: trend.analysis }} />
              </section>
            )}
            <h3 className={styles.sectionTitle}>空间对照 <small>ERA5 再分析与 GFS 历史预报</small></h3>
            <div className={styles.timestamps}>
              <p>有效时刻 <time dateTime={rendered.frame.time}>{timeText(rendered.frame.time)}</time></p>
              <p>GFS 起报 <time dateTime={archive.run}>{timeText(archive.run)}</time></p>
            </div>
            <div className={styles.timeline}>
              <button type="button" aria-label={playing ? "暂停对照时刻" : "播放对照时刻"} onClick={() => {
                if (!playing && index === archive.frames.length - 1) setIndex(0);
                setPlaying(!playing);
              }}>{playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}</button>
              <input type="range" aria-label="对照有效时刻" aria-valuetext={timeText(archive.frames[index].time)}
                min={0} max={archive.frames.length - 1} value={index}
                onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} />
            </div>
            <div className={styles.columns}><span>ERA5 再分析</span><span>GFS 预报</span></div>
            {metrics.map(key => {
              const meta = fields[key];
              return (
                <figure className={styles.row} key={key}>
                  <figcaption className={styles.rowTitle}>
                    <span className={styles.metric}><b>{meta.short}</b> {meta.name} <small>{meta.unit}</small></span>
                  </figcaption>
                  <div className={styles.pair}>
                    <VerticalColorLegend className={styles.legend} label="共同色标"
                      ticks={[String(meta.range[1]), String(meta.range[0])]}
                      stops={colorScale(key).map(([offset, rgb]) => [offset, `rgb(${rgb.join(",")})`])} />
                    <MiniMap raster={rendered.maps[key].analysis} land={land} label={meta.name + " · ERA5 再分析"} />
                    <MiniMap raster={rendered.maps[key].forecast} land={land} label={meta.name + " · GFS 预报"} />
                  </div>
                </figure>
              );
            })}
            <p className={styles.attribution}>3° 显示格点 · <a href={archive.analysisSource}>ERA5</a> · <a href={rendered.frame.forecastSource + ".idx"}>GFS</a></p>
          </>
        ) : (
          <div className={styles.status} role="status">
            <p>{error ? "暂时无法加载空间对照。" : "正在读取历史再分析与预报…"}</p>
            {error && <button type="button" onClick={() => { setError(false); setRevision(value => value + 1); }}>重试</button>}
          </div>
        )}
      </div>
    </aside>
  );
}
