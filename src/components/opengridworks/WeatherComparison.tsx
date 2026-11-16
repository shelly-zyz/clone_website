"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { geoEquirectangular, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { Pause, Play } from "lucide-react";
import { finishGlobeHandoff } from "@/lib/globe-handoff";
import { scaleColor } from "@/app/visualization/weather-replay/replay-palette";
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
const colors = [[0, [46, 33, 124]], [.18, [38, 91, 183]], [.37, [54, 174, 210]],
  [.52, [166, 214, 176]], [.69, [248, 224, 127]], [.85, [246, 151, 72]], [1, [181, 57, 62]]] as const;
const windColors = [[0, [34, 57, 151]], [.23, [49, 128, 191]], [.5, [205, 225, 221]],
  [.76, [241, 152, 99]], [1, [183, 50, 64]]] as const;
const colorScale = (metric: Metric) => metric === "u10" ? windColors : colors;

type PackedField = { analysis: string; forecast: string; quantum: number; unit: string };
type Frame = { time: string; forecastSource: string; fields: Record<Metric, PackedField> };
type WeatherArchive = { schema: number; run: string; cols: number; rows: number; step: number; analysisSource: string; frames: Frame[] };
type Raster = { canvas: HTMLCanvasElement; bytes: Uint8ClampedArray; width: number; height: number };
type Bearing = { lon: number; lat: number };
const globeSize = 450;
const initialBearing = { lon: -15, lat: 15 };
const archivePath = "/data/weather-replay/global-20220322.json";
const coastPath = "/data/natural-earth/ne_50m_admin_0_countries.geojson";

function makeRaster(field: PackedField, source: FieldSource, metric: Metric, cols: number, rows: number): Raster {
  const input = Uint8Array.from(atob(field[source]), char => char.charCodeAt(0));
  const encoded = new DataView(input.buffer);
  if (encoded.byteLength !== 2 * cols * rows) throw new Error("Unexpected global grid size.");
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
  return { canvas, bytes: image.data, width: canvas.width, height: rows };
}

function drawMap(canvas: HTMLCanvasElement, raster: Raster, land: GeoPermissibleObjects | undefined) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(raster.canvas, 0, 0, canvas.width, canvas.height);
  if (!land) return;
  ctx.beginPath();
  geoPath(geoEquirectangular().scale(canvas.width / (2 * Math.PI))
    .translate([canvas.width / 2, canvas.height / 2]), ctx)(land);
  ctx.strokeStyle = "rgba(225, 240, 246, .40)";
  ctx.lineWidth = .55;
  ctx.stroke();
}

function MiniMap({ raster, land, label }: { raster: Raster; land?: GeoPermissibleObjects; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawMap(ref.current, raster, land); }, [raster, land]);
  return <canvas className={styles.mini} ref={ref} width={240} height={121} role="img" aria-label={label} />;
}

function drawGlobe(canvas: HTMLCanvasElement, raster: Raster, bearing: Bearing, zoom: number, land?: GeoPermissibleObjects) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const center = size / 2;
  const radius = size * .46 * zoom;
  const image = ctx.createImageData(size, size);
  const toRadian = Math.PI / 180;
  const lon0 = bearing.lon * toRadian, lat0 = bearing.lat * toRadian;
  const sin0 = Math.sin(lat0), cos0 = Math.cos(lat0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / radius, dy = (center - y) / radius;
      const distance = dx * dx + dy * dy;
      if (distance > 1) continue;
      const z = Math.sqrt(1 - distance);
      const lat = Math.asin(dy * cos0 + z * sin0);
      const lon = lon0 + Math.atan2(dx, z * cos0 - dy * sin0);
      const px = (((lon / (2 * Math.PI) + .5) % 1 + 1) % 1) * (raster.width - 1);
      const py = Math.max(0, Math.min(raster.height - 1, (.5 - lat / Math.PI) * (raster.height - 1)));
      const left = Math.floor(px), top = Math.floor(py);
      const right = Math.min(raster.width - 1, left + 1), bottom = Math.min(raster.height - 1, top + 1);
      const weights = [4 * (top * raster.width + left), 4 * (top * raster.width + right),
        4 * (bottom * raster.width + left), 4 * (bottom * raster.width + right)];
      if (raster.bytes[4 * (Math.round(py) * raster.width + Math.round(px)) + 3] === 0) continue;
      const xi = px - left, yi = py - top;
      const tone = .62 + .38 * z;
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const a = raster.bytes[weights[0] + channel], b = raster.bytes[weights[1] + channel];
        const c = raster.bytes[weights[2] + channel], d = raster.bytes[weights[3] + channel];
        image.data[offset + channel] = tone * ((a * (1 - xi) + b * xi) * (1 - yi) + (c * (1 - xi) + d * xi) * yi);
      }
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  if (land) {
    ctx.beginPath();
    geoPath(geoOrthographic().scale(radius).translate([center, center]).rotate([-bearing.lon, -bearing.lat]).clipAngle(90), ctx)(land);
    ctx.strokeStyle = "rgba(229, 247, 244, .74)";
    ctx.lineWidth = .62;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#84b9c7";
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function Globe({ raster, land, label }: { raster: Raster; land?: GeoPermissibleObjects; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [bearing, setBearing] = useState(initialBearing);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const next = requestAnimationFrame(() => drawGlobe(canvas, raster, bearing, zoom, land));
    return () => cancelAnimationFrame(next);
  }, [bearing, land, raster, zoom]);

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (drag.current?.id !== event.pointerId) return;
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setBearing(previous => ({ lon: (previous.lon - dx * .55) % 360,
      lat: Math.max(-84, Math.min(84, previous.lat + dy * .55)) }));
  }

  return (
    <div className={styles.sphere}>
      <canvas ref={ref} width={globeSize} height={globeSize} className={styles.globe} role="img" aria-label={label}
        onPointerDown={event => {
          if (drag.current) return;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={move} onLostPointerCapture={() => { drag.current = undefined; }} />
      <div className={styles.camera} role="group" aria-label="地球视角">
        <button type="button" onClick={() => setBearing(current => ({ ...current, lon: current.lon - 30 }))} aria-label="旋转地球">↻</button>
        <button type="button" onClick={() => setZoom(current => Math.max(.72, current - .12))} aria-label="缩小地球">−</button>
        <button type="button" onClick={() => setZoom(current => Math.min(1.45, current + .12))} aria-label="放大地球">+</button>
        <button type="button" onClick={() => { setBearing(initialBearing); setZoom(1); }}>重置</button>
      </div>
    </div>
  );
}

const timeText = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

export function WeatherComparison() {
  const [archive, setArchive] = useState<WeatherArchive>();
  const [land, setLand] = useState<GeoPermissibleObjects>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [metric, setMetric] = useState<Metric>("t2m");
  const [source, setSource] = useState<FieldSource>("forecast");
  const [index, setIndex] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [rasters, setRasters] = useState<{ frame: Frame; maps: Record<Metric, Record<FieldSource, Raster>> }>();
  const frame = archive?.frames[index];

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
        }])) as Record<Metric, Record<FieldSource, Raster>>;
        setRasters({ frame, maps });
        finishGlobeHandoff("weather");
      } catch { setError(true); }
    });
    return () => cancelAnimationFrame(next);
  }, [archive, frame]);

  useEffect(() => {
    if (!playing || !archive) return;
    const id = window.setTimeout(() => {
      if (index + 1 >= archive.frames.length) setPlaying(false);
      else setIndex(index + 1);
    }, 770);
    return () => window.clearTimeout(id);
  }, [archive, index, playing]);

  if (!archive || !rasters || error) return <div className={styles.loading} role="status">
    <p>{error ? "暂时无法加载全球气象对照。" : "正在读取历史再分析与预报…"}</p>
    {error && <button onClick={() => { setError(false); setRevision(value => value + 1); }}>重试</button>}
  </div>;

  const meta = fields[metric];
  const shown = rasters.frame;
  return (
    <section className={styles.atlas} aria-label="全球气象对照">
      <div className={styles.main}>
        <header className={styles.title}>
          <h2>全球气象对照</h2>
          <p>{timeText(shown.time)}</p>
        </header>
        <Globe raster={rasters.maps[metric][source]} land={land} label={`${meta.name} · ${source === "forecast" ? "GFS 预报" : "ERA5 再分析"}`} />
        <div className={styles.controls}>
          <div className={styles.mapControls}>
            <select aria-label="地球变量" value={metric} onChange={event => setMetric(event.target.value as Metric)}>
              {metrics.map(key => <option key={key} value={key}>{fields[key].name}</option>)}
            </select>
            <div role="group" aria-label="主球数据来源" className={styles.sourceSwitch}>
              <button type="button" aria-pressed={source === "analysis"} onClick={() => setSource("analysis")}>再分析</button>
              <button type="button" aria-pressed={source === "forecast"} onClick={() => setSource("forecast")}>预报</button>
            </div>
          </div>
          <div className={styles.legend}>
            <span>{meta.range[0]}</span><span className={styles.legendRamp} data-diverging={metric === "u10"} />
            <span>{meta.range[1]} {meta.unit}</span>
          </div>
          <div className={styles.timeline}>
            <button type="button" onClick={() => {
              if (!playing && index === archive.frames.length - 1) setIndex(0);
              setPlaying(!playing);
            }}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? "暂停" : "播放"}</button>
            <input type="range" aria-label="全球对照时间" aria-valuetext={timeText(archive.frames[index].time)}
              min={0} max={archive.frames.length - 1} value={index}
              onChange={event => { setPlaying(false); setIndex(Number(event.target.value)); }} />
          </div>
        </div>
      </div>
      <aside className={styles.comparison} aria-label="再分析与预报地图">
        <header><h3>空间对照</h3><p>GFS 起报 {timeText(archive.run)}</p></header>
        <div className={styles.columns}><span>ERA5 再分析</span><span>GFS 预报</span></div>
        {metrics.map(key => (
          <button type="button" className={styles.row} key={key} aria-pressed={key === metric} onClick={() => setMetric(key)}>
            <span className={styles.rowTitle}><b>{fields[key].short}</b> {fields[key].name}<span>{fields[key].unit}</span></span>
            <span className={styles.pair}>
              <MiniMap raster={rasters.maps[key].analysis} land={land} label={fields[key].short + " 再分析"} />
              <MiniMap raster={rasters.maps[key].forecast} land={land} label={fields[key].short + " 预报"} />
            </span>
          </button>
        ))}
        <p className={styles.attribution}>历史档案 · 3° 显示格点 · <a href={archive.analysisSource}>ERA5</a> · <a href={shown.forecastSource + ".idx"}>GFS</a></p>
      </aside>
    </section>
  );
}
