"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, GridHelper, Group, LinearFilter,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RGBAFormat, SRGBColorSpace,
  Uint32BufferAttribute,
} from "three";
import { geoAzimuthalEquidistant, geoStream } from "d3-geo";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { scaleColor } from "@/app/visualization/weather-replay/replay-palette";
import { GlobeLoading } from "./GlobeLoading";
import { WeatherVolumeCanvas, unpack, useWeatherArchive } from "./WeatherVolumeCanvas";
import styles from "./WeatherVolume.module.css";

type RadarArchive = {
  schema: number; site: string; time: string; source: string; sha256: string; latitude: number; longitude: number;
  x: number[]; y: number[]; z: number[]; elevations: number[]; values: string;
  meshes: { dbz: number; vertices: string; faces: string }[];
};
type RadarVolume = RadarArchive & { grid: Int8Array };
type RadarMode = "volume" | "profile" | "slices";
type Cell = [number, number];
type Coastline = FeatureCollection<Polygon | MultiPolygon>;

const radarPath = "/data/weather-replay/radar-khgx-20220322.json";
const modes = { volume: "回波体", profile: "垂直剖面", slices: "高度切片" } as const;
const radarScale = [[10, [40, 123, 182]], [20, [73, 197, 177]], [35, [172, 224, 86]],
  [45, [251, 215, 64]], [55, [249, 105, 60]], [65, [209, 60, 134]], [75, [186, 96, 227]]] as const;
const radarColors: Record<number, string> = { 20: "#29cdaa", 35: "#e6c54d", 50: "#ff584f" };
const altitudes = [1, 3, 5, 7, 10] as const;
const altitudeStretch = 3.2;
const isCoastline = (data: Coastline) => data.type === "FeatureCollection" && Array.isArray(data.features);
const valid = (data: RadarArchive) => data.schema === 1 && data.x?.length === 91 && data.y?.length === 91 &&
  data.z?.length === 19 && data.meshes?.length === 3;
const idx = (data: RadarVolume, z: number, x: number, y: number) => (z * data.y.length + y) * data.x.length + x;

function addBase(group: Group, span: number) {
  const base = new Mesh(new PlaneGeometry(span, span), new MeshBasicMaterial({ color: "#16273a", transparent: true, opacity: .86 }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -.25;
  group.add(base);
  const grid = new GridHelper(span, 6, "#506681", "#314861");
  grid.position.y = -.17;
  group.add(grid);
}

function addCoastline(group: Group, data: RadarVolume, coastline: Coastline | undefined) {
  if (!coastline) return;
  const domain = data.x.at(-1)!;
  const projection = geoAzimuthalEquidistant().rotate([-data.longitude, -data.latitude])
    .scale(6371).translate([0, 0]).clipExtent([[-domain, -domain], [domain, domain]]);
  const positions: number[] = [];
  let previous: [number, number] | undefined;
  const lines = coastline.features.filter(feature => feature.id === "USA").flatMap(({ geometry }) =>
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat());
  geoStream({ type: "MultiLineString", coordinates: lines }, projection.stream({
    point(x, y) { if (previous) positions.push(previous[0], .05, previous[1], x, .05, y); previous = [x, y]; },
    lineStart() { previous = undefined; }, lineEnd() { previous = undefined; }, polygonStart() {}, polygonEnd() {}, sphere() {},
  }));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  group.add(new LineSegments(geometry, new LineBasicMaterial({ color: "#7395ab", transparent: true, opacity: .68 })));
}

function voxelColor(dbz: number, target: Uint8Array | Uint8ClampedArray, offset: number) {
  if (dbz < 10) return;
  target.set(scaleColor(radarScale, dbz), offset);
  target[offset + 3] = Math.min(255, 140 + dbz);
}

function radarGroup(data: RadarVolume, mode: RadarMode, threshold: number, opacity: number, focus: number, coastline?: Coastline) {
  const group = new Group();
  const span = data.x.at(-1)! - data.x[0];
  addBase(group, span);
  addCoastline(group, data, coastline);
  if (mode === "volume") {
    for (const item of data.meshes.filter(layer => layer.dbz >= threshold)) {
      const vertexBytes = unpack(item.vertices);
      const indices = unpack(item.faces);
      const vertex = new DataView(vertexBytes.buffer);
      const faces = new DataView(indices.buffer);
      const xyz = Array.from({ length: vertex.byteLength / 2 }, (_, i) =>
        vertex.getInt16(i * 2, true) / 100 * (i % 3 === 1 ? altitudeStretch : 1));
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(xyz, 3));
      geometry.setIndex(new Uint32BufferAttribute(Array.from({ length: faces.byteLength / 4 }, (_, i) => faces.getUint32(i * 4, true)), 1));
      geometry.computeVertexNormals();
      const strength = item.dbz === 20 ? .18 : item.dbz === 35 ? .46 : .92;
      const material = new MeshStandardMaterial({ color: radarColors[item.dbz], side: DoubleSide,
        roughness: .72, transparent: true, opacity: strength * opacity, depthWrite: item.dbz >= 50 });
      const surface = new Mesh(geometry, material);
      surface.renderOrder = 52 - item.dbz;
      group.add(surface);
    }
  } else {
    for (const height of altitudes) {
      const z = data.z.indexOf(height);
      if (z < 0) continue;
      const length = data.x.length * data.y.length;
      const rgba = new Uint8Array(length * 4);
      for (let i = 0; i < length; i++) voxelColor(data.grid[z * length + i], rgba, 4 * i);
      const texture = new DataTexture(rgba, data.x.length, data.y.length, RGBAFormat);
      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
      texture.needsUpdate = true;
      const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: true,
        opacity: focus === height ? .98 : .33, depthWrite: false });
      const layer = new Mesh(new PlaneGeometry(span, span), material);
      layer.position.y = height * altitudeStretch;
      layer.rotation.x = -Math.PI / 2;
      layer.renderOrder = height;
      group.add(layer);
    }
  }
  return group;
}

function profileTexture(data: RadarVolume, a: Cell, b: Cell, columns: number, northUp: boolean) {
  const height = data.z.length;
  const pixels = new Uint8Array(columns * height * 4);
  for (let sample = 0; sample < columns; sample++) {
    const fraction = sample / (columns - 1);
    const x = Math.round(a[0] + fraction * (b[0] - a[0]));
    const y = Math.round(a[1] + fraction * (b[1] - a[1]));
    for (let z = 0; z < height; z++) {
      const row = northUp ? height - 1 - z : z;
      voxelColor(data.grid[idx(data, z, x, y)], pixels, (row * columns + sample) * 4);
    }
  }
  return pixels;
}

function spatialProfile(data: RadarVolume, a: Cell, b: Cell, coastline?: Coastline) {
  const group = new Group();
  addBase(group, 180);
  addCoastline(group, data, coastline);
  const [ax, ay, bx, by] = [data.x[a[0]], data.y[a[1]], data.x[b[0]], data.y[b[1]]];
  const length = Math.hypot(bx - ax, by - ay);
  if (length === 0) return group;
  const picture = new DataTexture(profileTexture(data, a, b, 180, false), 180, data.z.length, RGBAFormat);
  picture.colorSpace = SRGBColorSpace;
  picture.minFilter = picture.magFilter = LinearFilter;
  picture.needsUpdate = true;
  const height = data.z.at(-1)! * altitudeStretch;
  const wall = new Mesh(new PlaneGeometry(length, height), new MeshBasicMaterial({
    map: picture, transparent: true, side: DoubleSide, depthWrite: false,
  }));
  wall.position.set((ax + bx) / 2, height / 2, -(ay + by) / 2);
  wall.rotation.y = Math.atan2(by - ay, bx - ax);
  group.add(wall);
  const baseline = new BufferGeometry();
  baseline.setAttribute("position", new Float32BufferAttribute([ax, .22, -ay, bx, .22, -by], 3));
  group.add(new LineSegments(baseline, new LineBasicMaterial({ color: "#dcf3fe" })));
  return group;
}

function RadarProfile({ data, coastline }: { data: RadarVolume; coastline?: Coastline }) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const profileRef = useRef<HTMLCanvasElement>(null);
  const [line, setLine] = useState<[Cell, Cell]>([[16, 48], [74, 48]]);
  const [nextEndpoint, setNextEndpoint] = useState(0);
  const [spatial, setSpatial] = useState(false);
  const width = data.x.length, depth = data.y.length;
  const [a, b] = line;
  const distance = Math.hypot(data.x[b[0]] - data.x[a[0]], data.y[b[1]] - data.y[a[1]]);
  const build = useCallback(() => spatialProfile(data, a, b, coastline), [a, b, coastline, data]);
  useEffect(() => {
    const top = topRef.current?.getContext("2d");
    const profile = profileRef.current?.getContext("2d");
    if (!top) return;
    const map = top.createImageData(width, depth);
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        const reflectivity = Math.max(...data.z.map((_, z) => data.grid[idx(data, z, x, y)]));
        voxelColor(reflectivity, map.data, 4 * ((depth - 1 - y) * width + x));
      }
    }
    top.clearRect(0, 0, width, depth);
    top.putImageData(map, 0, 0);
    top.beginPath();
    top.moveTo(a[0], depth - 1 - a[1]);
    top.lineTo(b[0], depth - 1 - b[1]);
    top.strokeStyle = "#f0f7ff";
    top.lineWidth = 1.2;
    top.stroke();
    top.fillStyle = "#fff";
    top.font = "6px sans-serif";
    top.fillText("A", a[0] - 1, depth - 1 - a[1] - 3);
    top.fillText("B", b[0] + 1, depth - 1 - b[1] - 3);
    if (profile) {
      const count = profile.canvas.width;
      const section = profile.createImageData(count, data.z.length);
      section.data.set(profileTexture(data, a, b, count, true));
      profile.clearRect(0, 0, count, data.z.length);
      profile.putImageData(section, 0, 0);
    }
  }, [a, b, data, depth, spatial, width]);

  function pick(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(width - 1, Math.round((event.clientX - box.left) / box.width * (width - 1))));
    const y = Math.max(0, Math.min(depth - 1, Math.round((1 - (event.clientY - box.top) / box.height) * (depth - 1))));
    const selected: Cell = [x, y];
    setLine(nextEndpoint === 0 ? [selected, b] : [a, selected]);
    setNextEndpoint(1 - nextEndpoint);
  }
  return (
    <div className={styles.profileGrid}>
      <div>
        <p>依次点击剖面线两端 · 下一点 {nextEndpoint === 0 ? "A" : "B"}</p>
        <canvas className={styles.radarPlan} ref={topRef} width={width} height={depth}
          role="img" aria-label="雷达合成反射率，点击选择剖面线 A 和 B" onPointerUp={pick} />
        <button type="button" onClick={() => { setLine([[16, 48], [74, 48]]); setNextEndpoint(0); }}>恢复默认剖面</button>
      </div>
      <div className={styles.profileData}>
        <p>A → B · 海拔高度</p>
        {spatial ? <div className={styles.spatialProfile}><WeatherVolumeCanvas width={180} build={build}
          label={`三维垂直剖面，距离 ${distance.toFixed(1)} 公里`} /></div> : <div className={styles.profileImage}>
          <div><span>18 km</span><span>12 km</span><span>6 km</span><span>0 km</span></div>
          <canvas ref={profileRef} width={180} height={data.z.length} role="img" aria-label={`垂直反射率剖面，距离 ${distance.toFixed(1)} 公里`} />
        </div>}
        <div className={styles.profileDistance}><span>0</span><span>{distance.toFixed(1)} km</span></div>
        <button type="button" aria-pressed={spatial} onClick={() => setSpatial(!spatial)}>{spatial ? "返回二维剖面" : "在三维中显示"}</button>
      </div>
    </div>
  );
}

export function WeatherRadar() {
  const { data, error, retry } = useWeatherArchive(radarPath, valid);
  const { data: coastline } = useWeatherArchive("/data/weather-replay/regions.geojson", isCoastline);
  const [mode, setMode] = useState<RadarMode>("volume");
  const [threshold, setThreshold] = useState(20);
  const [opacity, setOpacity] = useState(1);
  const [focus, setFocus] = useState(5);
  const radar = useMemo<RadarVolume | undefined>(() => {
    if (!data) return;
    const grid = new Int8Array(unpack(data.values).buffer);
    if (grid.length !== data.x.length * data.y.length * data.z.length) return;
    return { ...data, grid };
  }, [data]);
  const build = useCallback(() => radar ? radarGroup(radar, mode, threshold, opacity, focus, coastline) : new Group(),
    [coastline, focus, mode, opacity, radar, threshold]);

  if (!radar) return error || data
    ? <div className={styles.notice} role="status">无法读取此雷达体扫档案。<button type="button" onClick={retry}>重试</button></div>
    : <GlobeLoading label="正在加载三维雷达" />;

  return (
    <section className={styles.layout} aria-label="三维雷达">
      <div className={styles.main}>
        <header className={styles.header}>
          <div><h2>三维雷达</h2><p>{radar.site} · 2022-03-22 12:01:25 UTC</p></div>
          <div className={styles.tabs} role="group" aria-label="雷达产品">
            {(Object.keys(modes) as RadarMode[]).map(item =>
              <button key={item} type="button" aria-pressed={item === mode} onClick={() => setMode(item)}>{modes[item]}</button>)}
          </div>
        </header>
        {mode === "profile" ? <RadarProfile data={radar} coastline={coastline} /> :
          <div className={styles.stage}>
            <WeatherVolumeCanvas label={`${radar.site} ${modes[mode]}，可旋转缩放`} width={180} build={build} />
            <small className={styles.scaleNote}>海拔高度放大 3.2× · 平面网格 30 km</small>
          </div>}
        <div className={styles.reflectivityLegend} aria-label="雷达反射率色标">
          <span>反射率 dBZ</span><span>10</span><i /><span>75</span>
        </div>
      </div>
      <aside className={styles.sidebar} aria-label="雷达场景读数">
        <h3>{modes[mode]}</h3>
        {mode === "volume" && <>
          <label>最低回波阈值
            <select value={threshold} onChange={event => setThreshold(Number(event.target.value))}>
              {[20, 35, 50].map(dbz => <option key={dbz} value={dbz}>{dbz} dBZ</option>)}
            </select>
          </label>
          <label>回波不透明度 {Math.round(opacity * 100)}%
            <input type="range" min={.2} max={1} step={.05} value={opacity} onChange={event => setOpacity(Number(event.target.value))} />
          </label>
          <div className={styles.thresholds}>
            {[20, 35, 50].filter(value => value >= threshold).map(value =>
              <span key={value} data-dbz={value}><i />{value} dBZ</span>)}
          </div>
        </>}
        {mode === "slices" && <label>高亮海拔
          <select value={focus} onChange={event => setFocus(Number(event.target.value))}>
            {altitudes.map(height => <option key={height} value={height}>{height} km</option>)}
          </select></label>}
        <dl className={styles.readings}><div><dt>网格</dt><dd>水平 2 km · 垂直 1 km</dd></div>
          <div><dt>高度范围</dt><dd>0–18 km 海拔</dd></div>
          <div><dt>体扫仰角</dt><dd>{radar.elevations.length} 扫</dd></div></dl>
        <p>历史雷达体扫 · 缺测透明</p>
        <p>暂无同域、同时刻的已发布反射率预报。</p>
        <a href={radar.source}>NOAA NEXRAD Level II · KHGX</a>
      </aside>
    </section>
  );
}
