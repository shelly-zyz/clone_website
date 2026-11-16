import type { WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayArea } from "./replay-geography";
import { satelliteAt, stackFrameIndices } from "./replay-data";
import { accumulationScale, replayTexture, scaleColor, smoothAccumulation } from "./replay-palette";
import type { ReplayView } from "@/lib/weather-replay/views";

type Point = [number, number];
type World = [number, number, number?];

const rainCeiling = 0.64;
const rainTail = 0.026;
const rainStroke = "rgba(199, 228, 255, .48)";

function coordinateTicks(start: number, end: number, target: number) {
  const spacing = (end - start) / target;
  const magnitude = 10 ** Math.floor(Math.log10(spacing));
  const step = (spacing / magnitude <= 2 ? 2 : spacing / magnitude <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let i = Math.ceil(start / step); i * step <= end; i++) ticks.push(i * step);
  return ticks;
}

function coordinateLabel(value: number, longitude: boolean) {
  const hemisphere = longitude ? (value < 0 ? "W" : "E") : (value < 0 ? "S" : "N");
  return Math.abs(Number(value.toPrecision(6))) + "°" + hemisphere;
}

function rainRandom(seed: number, salt: number) {
  const bits = Math.imul(seed ^ salt, 0x9e3779b9);
  return (Math.imul(bits ^ (bits >>> 16), 0x85ebca6b) >>> 0) / 4294967296;
}

export const utcClock = (iso: string) => iso.slice(11, 16);

function replayCamera(width: number, height: number, area: ReplayArea, view: ReplayView,
  rotation: number, zoom: number, tilt: number) {
  const { south, north, west, east } = area.bounds;
  const aspect = Math.cos((south + north) * Math.PI / 360) * (east - west) / (north - south);
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  const normalizeLon = (lon: number) => (lon - west) / (east - west);
  const normalizeLat = (lat: number) => (lat - south) / (north - south);
  const m = area.mapBounds;
  const mapCorners: World[] = [
    [normalizeLon(m.west), normalizeLat(m.south)], [normalizeLon(m.east), normalizeLat(m.south)],
    [normalizeLon(m.east), normalizeLat(m.north)], [normalizeLon(m.west), normalizeLat(m.north)],
  ];
  const toView = ([lon, lat]: World): Point => {
    const x = (lon - .5) * aspect;
    const y = lat - .5;
    return [x * cos + y * sin, x * sin - y * cos];
  };
  const map = mapCorners.map(toView);
  const xs = map.map(point => point[0]);
  const ys = map.map(point => point[1] * tilt);
  const left = Math.min(...xs), right = Math.max(...xs);
  const bottom = Math.max(...ys), top = Math.min(...ys) - (area.hasData ? view === "time" ? .35 : .30 : 0);
  const scale = Math.min(width * .90 / (right - left), height * .77 / (bottom - top)) * zoom;
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const offsetX = width * .5, offsetY = height * .52;
  const project = ([lon, lat, z = 0]: World): Point => {
    const [x, depth] = toView([lon, lat]);
    return [offsetX + (x - centerX) * scale, offsetY + (depth * tilt - z * .48 - centerY) * scale];
  };
  const unproject = (x: number, y: number): Point => {
    const vx = (x - offsetX) / scale + centerX;
    const depth = ((y - offsetY) / scale + centerY) / tilt;
    return [(vx * cos + depth * sin) / aspect + .5, vx * sin - depth * cos + .5];
  };
  return { project, unproject, mapCorners, normalizeLat, normalizeLon };
}

export function paintReplay(
  canvas: HTMLCanvasElement,
  replay: WeatherReplay,
  { index, view, rotation, clouds, precipitation, previous, progress, phase = 0, totals, accumulationLimit = 1, selectedCell, area, zoom = 1, tilt = 0.48 }: {
    index: number;
    view: ReplayView;
    rotation: number;
    clouds: boolean;
    precipitation: boolean;
    previous: number;
    progress: number;
    phase?: number;
    totals?: readonly (number | null)[];
    accumulationLimit?: number;
    selectedCell?: number;
    area: ReplayArea;
    zoom?: number;
    tilt?: number;
  },
) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!ctx || !width || !height) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rasterWidth = Math.round(width * ratio);
  const rasterHeight = Math.round(height * ratio);
  if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const camera = replayCamera(width, height, area, view, rotation, zoom, tilt);
  const { project, mapCorners, normalizeLat, normalizeLon } = camera;
  const { mapBounds } = area;
  const stack = view === "time";
  const rain = view === "rain";
  const accumulation = view === "accumulation";
  const path = (polygon: Point[]) => {
    ctx.beginPath();
    ctx.moveTo(...polygon[0]);
    polygon.slice(1).forEach(point => ctx.lineTo(...point));
    ctx.closePath();
  };
  const fill = (polygon: Point[], color: string) => {
    path(polygon);
    ctx.fillStyle = color;
    ctx.fill();
  };
  const plane = (z: number) => ([[0, 0, z], [1, 0, z], [1, 1, z], [0, 1, z]] satisfies World[]).map(project);
  const drawTexture = (values: readonly (number | null)[], z: number, alpha: number, cloud = false) => {
    const raster = replayTexture(values, replay.cols, replay.rows, cloud);
    const [x, y] = project([0, 0, z]);
    const [rightX, rightY] = project([1, 0, z]);
    const [downX, downY] = project([0, 1, z]);
    ctx.save();
    path(plane(z));
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.transform((rightX - x) / (replay.cols - 1), (rightY - y) / (replay.cols - 1),
      (downX - x) / (replay.rows - 1), (downY - y) / (replay.rows - 1), x, y);
    ctx.drawImage(raster, -.5, -.5);
    ctx.restore();
  };
  // Data and geographic outlines share this transform; never mask data with land.
  const geoPoint = (lon: number, lat: number, z = 0): Point => project([
    normalizeLon(lon), normalizeLat(lat), z,
  ]);
  const landPath = (polygon: ReplayArea["polygons"][number], z = 0) => {
    ctx.beginPath();
    for (const ring of polygon) {
      if (!ring.length) continue;
      ctx.moveTo(...geoPoint(...ring[0], z));
      for (const [lon, lat] of ring.slice(1)) ctx.lineTo(...geoPoint(lon, lat, z));
      ctx.closePath();
    }
  };
  const paintLand = (polygons: ReplayArea["polygons"], color: string, z = 0) => {
    ctx.fillStyle = color;
    for (const polygon of polygons) {
      landPath(polygon, z);
      ctx.fill("evenodd");
    }
  };
  const paintBoundaries = (polygons: ReplayArea["polygons"], color: string, lineWidth: number, z = 0) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (const polygon of polygons) {
      landPath(polygon, z);
      ctx.stroke();
    }
  };
  // Sample the geographic line so it follows the same perspective as data points.
  const mapLine = (lon: number, lat: number, endLon: number, endLat: number) => {
    ctx.moveTo(...geoPoint(lon, lat));
    for (let i = 1; i <= 8; i++) {
      ctx.lineTo(...geoPoint(lon + (endLon - lon) * i / 8, lat + (endLat - lat) * i / 8));
    }
  };
  const gridX = 1 / (replay.cols - 1);
  const gridY = 1 / (replay.rows - 1);
  const map = mapCorners.map(project);
  if (area.ocean) fill(map, "#142b41");
  paintLand(area.mapPolygons, "#304257");

  const current = replay.rain[index];
  const satellite = satelliteAt(replay, current.time);
  if (area.hasData && (rain || view === "weather" && precipitation)) drawTexture(current.values, .008, 1);
  if (area.hasData && clouds && satellite && view === "weather") drawTexture(satellite.values, .53, .77, true);

  const { west: mapWest, south: mapSouth, east: mapEast, north: mapNorth } = mapBounds;
  const tickCount = width < 480 ? 3 : 5;
  const longitudes = coordinateTicks(mapWest, mapEast, tickCount);
  const latitudes = coordinateTicks(mapSouth, mapNorth, tickCount);
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "rgba(183, 207, 224, .19)";
  ctx.beginPath();
  for (const lon of longitudes) mapLine(lon, mapSouth, lon, mapNorth);
  for (const lat of latitudes) mapLine(mapWest, lat, mapEast, lat);
  ctx.stroke();
  ctx.restore();
  paintBoundaries(area.mapPolygons, "#7d97a8", 0.8);
  paintBoundaries(area.focusPolygons, "#c2d7e5", 1.2);

  // Anchor both scale axes to the nearest corner so labels stay outside the map.
  const corner = map.reduce((nearest, point, i) => point[1] > map[nearest][1] ? i : nearest, 0);
  const edgeLon = corner === 0 || corner === 3 ? mapWest : mapEast;
  const edgeLat = corner < 2 ? mapSouth : mapNorth;
  ctx.strokeStyle = "#758c9f";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  mapLine(mapWest, edgeLat, mapEast, edgeLat);
  mapLine(edgeLon, mapSouth, edgeLon, mapNorth);
  ctx.stroke();
  ctx.font = (width < 480 ? 10 : 11) + "px system-ui, sans-serif";
  ctx.fillStyle = "#c7d7e3";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tick = (point: Point, outward: Point, label: string) => {
    const dx = outward[0] - point[0];
    const dy = outward[1] - point[1];
    const distance = Math.hypot(dx, dy) || 1;
    const x = dx / distance;
    const y = dy / distance;
    ctx.beginPath();
    ctx.moveTo(...point);
    ctx.lineTo(point[0] + x * 4, point[1] + y * 4);
    ctx.stroke();
    ctx.fillText(label, point[0] + x * 17, point[1] + y * 15);
  };
  for (const lon of longitudes) {
    tick(geoPoint(lon, edgeLat), geoPoint(lon, edgeLat + (edgeLat === mapSouth ? -0.1 : 0.1)), coordinateLabel(lon, true));
  }
  for (const lat of latitudes) {
    if (Math.abs(lat - edgeLat) < (mapNorth - mapSouth) * 0.15) continue;
    tick(geoPoint(edgeLon, lat), geoPoint(edgeLon + (edgeLon === mapWest ? -0.1 : 0.1), lat), coordinateLabel(lat, false));
  }
  ctx.font = "12px system-ui, sans-serif";

  if (stack && area.hasData) {
    const indexes = stackFrameIndices(replay, index);
    for (const [layer, frame] of indexes.entries()) {
      const z = (layer + 1) * .155;
      const surface = plane(z);
      const active = frame === index;
      drawTexture(replay.rain[frame].values, z, active ? 1 : .46 + layer * .09);
      const corner = surface.reduce((right, point) => point[0] > right[0] ? point : right);
      ctx.strokeStyle = active ? "#96d9e9" : "#58768a";
      ctx.beginPath();
      ctx.moveTo(corner[0] - 11, corner[1]);
      ctx.lineTo(corner[0] + 2, corner[1]);
      ctx.stroke();
      const [x, y] = surface.reduce((right, point) => right[0] > point[0] ? right : point);
      ctx.textAlign = "left";
      ctx.fillStyle = active ? "#d9f5fb" : "#a3bdce";
      ctx.fillText(utcClock(replay.rain[frame].time), Math.min(width - 36, x + 5), y);
    }
  }

  if (area.hasData && (rain || (view === "weather" && precipitation))) {
    const previousValues = replay.rain[previous].values;
    ctx.strokeStyle = rainStroke;
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    for (let row = 0; row < replay.rows; row++) {
      for (let col = 0; col < replay.cols; col++) {
        const cellIndex = row * replay.cols + col;
        const value = current.values[cellIndex];
        if (value == null) continue;
        const before = previousValues[cellIndex] ?? value;
        const rate = rain ? value : before + (value - before) * progress;
        if (rate < 0.4) continue;
        const drops = Math.ceil(Math.sqrt(rate) * 1.62);
        for (let drop = 0; drop < drops; drop++) {
          const seed = 1 + cellIndex * 23 + drop;
          const x = Math.max(0, Math.min(1, (col + (rainRandom(seed, 9) - 0.5) * 0.9) * gridX));
          const y = Math.max(0, Math.min(1, (row + (rainRandom(seed, 19) - 0.5) * 0.9) * gridY));
          const age = (phase * 0.78 + rainRandom(seed, 39)) % 1;
          const head = (1 - age) * rainCeiling;
          ctx.moveTo(...project([x, y, head]));
          ctx.lineTo(...project([x, y, Math.min(rainCeiling, head + rainTail)]));
        }
      }
    }
    ctx.stroke();
  }

  if (accumulation && area.hasData && totals) {
    const surface = smoothAccumulation(totals, replay.cols, replay.rows);
    const relief = [];
    for (let row = 0; row < replay.rows - 1; row++) {
      for (let col = 0; col < replay.cols - 1; col++) {
        const corners = [[col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1]];
        const values = corners.map(([x, y]) => surface[y * replay.cols + x]);
        if (values.some(value => value == null)) continue;
        const mean = values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 4;
        if (mean < .2) continue;
        const points = corners.map(([x, y], corner) =>
          project([x * gridX, y * gridY, .7 * Math.min(1, (values[corner] ?? 0) / accumulationLimit)]));
        const depth = project([(col + .5) * gridX, (row + .5) * gridY])[1];
        relief.push({ points, depth, mean });
      }
    }
    relief.sort((a, b) => a.depth - b.depth);
    for (const { points, mean } of relief) {
      const color = "rgb(" + scaleColor(accumulationScale, mean / accumulationLimit).join(",") + ")";
      fill(points, color);
      ctx.strokeStyle = color;
      ctx.lineWidth = .5;
      ctx.stroke();
    }
  }

  if (area.hasData && selectedCell !== undefined) {
    const [x, y] = project([(selectedCell % replay.cols) * gridX, Math.floor(selectedCell / replay.cols) * gridY]);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#121c2b";
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#ddf9ff";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#f1fbff";
    ctx.fill();
  }

}


type ViewState = {
  view: ReplayView;
  index: number;
  clouds: boolean;
  precipitation: boolean;
  totals?: readonly (number | null)[];
  accumulationLimit: number;
  selectedCell?: number;
};

export function createReplayScene(canvas: HTMLCanvasElement, labels: HTMLDivElement, onContextLoss: () => void, onPick?: (cell: number) => void) {
  if (!canvas.getContext("2d")) throw new Error("Weather canvas unavailable");
  let replay: WeatherReplay | undefined;
  let area: ReplayArea | undefined;
  let state: ViewState | undefined;
  let rotation = 0.42;
  let zoomLevel = 1;
  let tilt = 0.48;
  let previous = 0;
  let started = 0;
  let requested = 0;
  let phase = 0;
  let lastDraw = 0;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointers = new Map<number, [number, number]>();
  let pinchDistance = 0;
  let tap: { x: number; y: number; id: number } | undefined;

  function draw(now: number) {
    requested = 0;
    if (!replay || !area || !state || document.hidden) return;
    const animateRain = area.hasData && !motion.matches
      && (state.view === "rain" || (state.view === "weather" && state.precipitation));
    if (animateRain && lastDraw) phase += Math.min(0.05, (now - lastDraw) / 1000);
    lastDraw = animateRain ? now : 0;
    const progress = motion.matches ? 1 : Math.min(1, (now - started) / 240);
    paintReplay(canvas, replay, { ...state, area, rotation, zoom: zoomLevel, tilt, previous, progress, phase });
    if (animateRain || (state.view === "weather" && progress < 1)) redraw();
  }
  function redraw() {
    if (!requested && !document.hidden) requested = requestAnimationFrame(draw);
  }
  function zoom(factor: number) {
    zoomLevel = Math.max(0.74, Math.min(2.5, zoomLevel * factor));
    redraw();
  }
  function reset() {
    rotation = 0.42;
    zoomLevel = 1;
    tilt = 0.48;
    redraw();
  }
  function onDown(event: PointerEvent) {
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    canvas.setPointerCapture(event.pointerId);
    pinchDistance = 0;
    tap = pointers.size === 1 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : undefined;
  }
  function onMove(event: PointerEvent) {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 5) tap = undefined;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size > 1) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDistance > 0) zoom(distance / pinchDistance);
      pinchDistance = distance;
    } else if (!tap) {
      rotation += (event.clientX - before[0]) * 0.006;
      tilt = Math.max(0.18, Math.min(0.75, tilt + (event.clientY - before[1]) * 0.002));
      redraw();
    }
  }
  function onUp(event: PointerEvent) {
    if (event.type === "pointerup" && tap?.id === event.pointerId && replay && area?.hasData && state) {
      const bounds = canvas.getBoundingClientRect();
      const camera = replayCamera(bounds.width, bounds.height, area, state.view, rotation, zoomLevel, tilt);
      const [col, row] = camera.unproject(event.clientX - bounds.left, event.clientY - bounds.top);
      if (col >= 0 && col <= 1 && row >= 0 && row <= 1) {
        onPick?.(Math.round(row * (replay.rows - 1)) * replay.cols + Math.round(col * (replay.cols - 1)));
      }
    }
    if (tap?.id === event.pointerId) tap = undefined;
    pointers.delete(event.pointerId);
    pinchDistance = 0;
  }
  function onWheel(event: WheelEvent) { event.preventDefault(); zoom(Math.exp(-event.deltaY * 0.001)); }
  function onVisibility() { lastDraw = 0; redraw(); }
  const observer = new ResizeObserver(redraw);
  observer.observe(canvas);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextlost", onContextLoss);
  document.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", redraw);
  labels.replaceChildren();
  return {
    update(archive: WeatherReplay, nextArea: ReplayArea, next: ViewState) {
      previous = replay === archive ? state?.index ?? next.index : next.index;
      if (next.index !== state?.index) started = performance.now();
      if (area?.id !== nextArea.id) reset();
      replay = archive;
      area = nextArea;
      state = next;
      redraw();
    },
    rotate(angle: number) { rotation += angle; redraw(); },
    zoom,
    reset,
    dispose() {
      cancelAnimationFrame(requested);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextlost", onContextLoss);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", redraw);
      labels.replaceChildren();
    },
  };
}
