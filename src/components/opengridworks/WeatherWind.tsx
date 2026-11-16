"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BufferGeometry, Color, Float32BufferAttribute, GridHelper, Group, LineBasicMaterial, LineSegments, Vector3 } from "three";
import { finishGlobeHandoff } from "@/lib/globe-handoff";
import { forecastOverviewSchema, type ForecastOverview } from "@/lib/globe-forecast";
import { ForecastSeries } from "./ForecastSidebar";
import { WeatherVolumeCanvas, unpack, useWeatherArchive } from "./WeatherVolumeCanvas";
import styles from "./WeatherVolume.module.css";

type WindArchive = {
  schema: number; issue: string; source: string; model: string; sha256: string;
  origin: number[]; bounds: number[]; x: number[]; y: number[]; levels: number[];
  frames: { time: string; vectors: string; surfaceMean: number }[];
};

const archivePath = "/data/weather-replay/wind-wrf-20050828.json";
const span = 470;
const exaggeration = 9;
const valid = (archive: WindArchive) => archive.schema === 1 && archive.frames.length > 1 &&
  archive.x.length === archive.y.length && archive.levels.length > 1;
const displayTime = (time: string) => time.slice(0, 16).replace("T", " ") + " UTC";

function readWind(archive: WindArchive, frame: WindArchive["frames"][number]) {
  const raw = new DataView(unpack(frame.vectors).buffer);
  const expected = archive.levels.length * archive.x.length * 8;
  if (raw.byteLength !== expected) return [];
  const points = [];
  for (let i = 0; i < raw.byteLength; i += 8) {
    const encoded = [0, 2, 4, 6].map(offset => raw.getInt16(i + offset, true));
    if (encoded.includes(-32768)) continue;
    const [u, v, w, km] = encoded.map(value => value / 100);
    const index = i / 8;
    const point = index % archive.x.length;
    points.push({ x: archive.x[point], y: archive.y[point], level: Math.floor(index / archive.x.length), km, u, v, w });
  }
  return points;
}

function buildWind(points: ReturnType<typeof readWind>, layer: number) {
  const group = new Group();
  const grid = new GridHelper(span, 10, "#678298", "#314661");
  group.add(grid);
  const positions: number[] = [];
  const colors: number[] = [];
  const rising = new Color("#ff696f");
  const sinking = new Color("#56e0a0");
  const horizontal = new Color("#73bfef");
  const vertical = new Vector3(0, 1, 0);
  const aligned = new Vector3(0, 0, 1);
  for (const point of points) {
    if (layer >= 0 && point.level !== layer) continue;
    const origin = new Vector3(point.x, point.km * exaggeration, -point.y);
    const velocity = new Vector3(point.u, point.w * exaggeration, -point.v);
    const speed = Math.hypot(point.u, point.v, point.w);
    if (speed < .2) continue;
    const length = Math.min(31, 7 + speed * .8);
    velocity.normalize();
    const tip = origin.clone().addScaledVector(velocity, length);
    const stem = tip.clone().addScaledVector(velocity, -length * .3);
    const side = new Vector3().crossVectors(velocity, Math.abs(velocity.y) < .84 ? vertical : aligned)
      .normalize().multiplyScalar(2.8);
    const color = point.w >= .2 ? rising : point.w <= -.2 ? sinking : horizontal;
    [origin, tip, tip, stem.clone().add(side), tip, stem.clone().sub(side)].forEach(vertex => {
      positions.push(vertex.x, vertex.y, vertex.z);
      colors.push(color.r, color.g, color.b);
    });
  }
  const mesh = new BufferGeometry();
  mesh.setAttribute("position", new Float32BufferAttribute(positions, 3));
  mesh.setAttribute("color", new Float32BufferAttribute(colors, 3));
  group.add(new LineSegments(mesh, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .9 })));
  return group;
}

export function WeatherWind() {
  const { data, error, retry } = useWeatherArchive(archivePath, valid);
  const [frameIndex, setFrame] = useState(1);
  const [layer, setLayer] = useState(-1);
  const [reference, setReference] = useState<ForecastOverview>();
  const [referenceLoaded, setReferenceLoaded] = useState(false);
  const [model, setModel] = useState<"wrf" | "climax">("wrf");
  const frame = data?.frames[frameIndex];
  const issue = data?.issue;
  const points = useMemo(() => data && frame ? readWind(data, frame) : [], [data, frame]);
  const heights = useMemo(() => data?.levels.map((_, index) => {
    const layer = points.filter(point => point.level === index);
    return layer.length ? layer.reduce((sum, item) => sum + item.km, 0) / layer.length : null;
  }) ?? [], [data, points]);
  const build = useCallback(() => buildWind(points, layer), [layer, points]);

  useEffect(() => { if (data || error) finishGlobeHandoff("weather"); }, [data, error]);
  useEffect(() => {
    if (model !== "climax" || !issue || referenceLoaded) return;
    const controller = new AbortController();
    void fetch("/api/xiaoyun/forecast-overview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "weather", regional: { model: "climax", region_code: "gulf-of-mexico-test", issue_time: issue } }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    }).then(async response => {
      if (!response.ok) throw new Error("Forecast unavailable");
      const result = forecastOverviewSchema.parse(await response.json());
      if (!controller.signal.aborted) { setReference(result); setReferenceLoaded(true); }
    }).catch(() => { if (!controller.signal.aborted) setReferenceLoaded(true); });
    return () => controller.abort();
  }, [issue, model, referenceLoaded]);

  if (!data || !frame) return <div className={styles.notice} role="status">{error ? "无法读取 WRF 档案。" : "正在读取三维风场…"}
    {error && <button type="button" onClick={retry}>重试</button>}</div>;

  const surfacePoints = data.frames.map(item => ({ date: item.time, value: item.surfaceMean }));
  const compatible = reference?.issueTime && Date.parse(reference.issueTime) === Date.parse(data.issue) ? reference : undefined;
  const sameDate = compatible?.points.find(point => Date.parse(point.date) === Date.parse(frame.time));
  const comparison = compatible?.points.filter(point => surfacePoints.some(candidate => Date.parse(point.date) === Date.parse(candidate.date)));
  const chosenTime = model === "wrf" ? frame.surfaceMean : sameDate?.value;

  return (
    <section className={styles.layout} aria-label="三维风场">
      <div className={styles.main}>
        <header className={styles.header}><div><h2>三维风场</h2><p>墨西哥湾 · {displayTime(frame.time)}</p></div>
          <select aria-label="三维风场模式层" value={layer} onChange={event => setLayer(Number(event.target.value))}>
            <option value={-1}>所有采样层</option>
            {heights.map((height, index) => <option value={index} key={index}>
              {height === null ? "缺测层" : `平均海拔 ${height.toFixed(1)} km`}</option>)}
          </select>
        </header>
        <div className={styles.stage}>
          <WeatherVolumeCanvas width={span} label="WRF 三维 U/V/W 风矢量，可旋转缩放" build={build} />
          <small className={styles.scaleNote}>海拔与垂直分量 9× 展开 · 平面网格约 47 km</small>
        </div>
        <div className={styles.windTime}>
          <label>风场有效时刻 <input type="range" min={0} max={data.frames.length - 1}
            value={frameIndex} aria-valuetext={displayTime(frame.time)} onChange={event => setFrame(Number(event.target.value))} /></label>
          <div className={styles.thresholds}><span data-wind="up"><i />上升</span>
            <span data-wind="down"><i />下沉</span><span data-wind="horizontal"><i />近水平</span></div>
        </div>
      </div>
      <aside className={styles.sidebar} aria-label="风场预报详情">
        <h3>区域 10 米风速</h3>
        <div className={styles.tabs} role="group" aria-label="风速预报模型">
          <button type="button" aria-pressed={model === "wrf"} onClick={() => setModel("wrf")}>WRF</button>
          <button type="button" aria-pressed={model === "climax"} onClick={() => setModel("climax")}>ClimaX</button>
        </div>
        <dl className={styles.readings}>
          <div><dt>起报</dt><dd>{displayTime(data.issue)}</dd></div>
          <div><dt>当前区域均值</dt><dd>{chosenTime == null ? "缺测" : `${chosenTime.toFixed(2)} m/s`}</dd></div>
        </dl>
        {model === "wrf" ? <ForecastSeries points={surfacePoints} chart="line" unit="m/s" grain="hour" label="WRF 区域 10 米风速" /> :
          comparison?.some(point => point.value !== null) ? <ForecastSeries points={comparison} chart="line" unit="m/s" grain="hour" label="ClimaX 区域 10 米风速" /> :
            <p role="status">{referenceLoaded ? "暂无可核对的同区、同起报、同有效时刻 ClimaX 预报。" : "正在核对 ClimaX 预报…"}</p>}
        {model === "climax" && compatible?.regional && <p>ClimaX {compatible.regional.modelVersion} · 版本 {compatible.version.slice(0, 12)}
          {compatible.regional.sourceUri.startsWith("https://") && <> · <a href={compatible.regional.sourceUri}>源文件</a></>}</p>}
        <p>箭头来自 WRF 模式风，红绿分别表示垂直分量达到 ±0.2 m/s 的升降。</p>
        <a href={data.source}>WRF 3.8.1 · NCAR 历史样本</a>
      </aside>
    </section>
  );
}
