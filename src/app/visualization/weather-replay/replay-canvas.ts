import type { ReplayFrame, WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayArea } from "./replay-geography";
import { satelliteAt } from "./replay-data";
import type { ReplayView } from "@/lib/weather-replay/views";

type Point = [number, number];
type World = [number, number, number?];
type ReplayBackdrop = { canvas: HTMLCanvasElement; key?: string; area?: ReplayArea; satellite?: ReplayFrame };

const rainColor = "224, 117, 52";
const cloudColor = "39, 105, 163";
const rainCeiling = 0.64;
const rainTail = 0.026;
const rainStroke = "rgba(187, 226, 255, .75)";

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

export function paintReplay(
  canvas: HTMLCanvasElement,
  replay: WeatherReplay,
  { index, view, rotation, clouds, precipitation, previous, progress, phase = 0, totals, area, zoom = 1, tilt = 0.39 }: {
    index: number;
    view: ReplayView;
    rotation: number;
    clouds: boolean;
    precipitation: boolean;
    previous: number;
    progress: number;
    phase?: number;
    totals?: readonly (number | null)[];
    area: ReplayArea;
    zoom?: number;
    tilt?: number;
  },
  backdrop?: ReplayBackdrop,
) {
  const target = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!target || !width || !height) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rasterWidth = Math.round(width * ratio);
  const rasterHeight = Math.round(height * ratio);
  if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
  }
  target.setTransform(ratio, 0, 0, ratio, 0, 0);
  target.clearRect(0, 0, width, height);

  const { south, north, west, east } = area.bounds;
  const aspect = Math.cos((south + north) * Math.PI / 360) * (east - west) / (north - south);
  const bearing = rotation;
  const sin = Math.sin(bearing);
  const cos = Math.cos(bearing);
  const stack = view === "time";
  const rain = view === "rain";
  const accumulation = view === "accumulation";
  const current = replay.rain[index];
  const satellite = view === "weather" && clouds ? satelliteAt(replay, current.time) : undefined;
  const showsParticles = area.hasData && (rain || (view === "weather" && precipitation));
  const background = showsParticles ? backdrop?.canvas.getContext("2d") : undefined;
  const key = [width, height, ratio, rotation, zoom, tilt, view].join("/");
  const reuse = background && backdrop?.key === key && backdrop.area === area && backdrop.satellite === satellite;
  let ctx = target;
  if (backdrop && background && !reuse) {
    backdrop.canvas.width = rasterWidth;
    backdrop.canvas.height = rasterHeight;
    background.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx = background;
  }
  const { mapBounds } = area;
  const normalizeLon = (lon: number) => (lon - west) / (east - west);
  const normalizeLat = (lat: number) => (lat - south) / (north - south);
  const mapCorners: World[] = [
    [normalizeLon(mapBounds.west), normalizeLat(mapBounds.south)],
    [normalizeLon(mapBounds.east), normalizeLat(mapBounds.south)],
    [normalizeLon(mapBounds.east), normalizeLat(mapBounds.north)],
    [normalizeLon(mapBounds.west), normalizeLat(mapBounds.north)],
  ];
  const toView = ([longitude, latitude]: World): Point => {
    const x = (longitude - 0.5) * aspect;
    const y = latitude - 0.5;
    const depth = x * sin - y * cos;
    return [(x * cos + y * sin) * (rain ? 1 + depth * 0.26 : 1), depth];
  };
  const mapX = mapCorners.map(point => toView(point)[0]);
  const left = Math.min(...mapX);
  const right = Math.max(...mapX);
  const projectedWidth = Math.abs(cos) * aspect + Math.abs(sin);
  const scale = Math.min(width * (stack ? 0.68 : 0.78) / projectedWidth,
    width * 0.84 / (right - left), height * (stack ? 0.87 : rain ? 0.91 : 0.98)) * zoom;
  const centerX = (left + right) / 2;
  const project = (point: World): Point => {
    const [x, depth] = toView(point);
    const z = point[2] ?? 0;
    const perspective = rain ? 1 + depth * 0.26 : 1;
    return [
      width * 0.5 + (x - centerX) * scale,
      height * (rain ? 0.67 : stack ? 0.70 : 0.63) + (depth * tilt - z * 0.48) * scale * perspective,
    ];
  };
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
  const cell = (x: number, y: number, dx: number, dy: number, z: number) =>
    ([[x - dx, y - dy, z], [x + dx, y - dy, z], [x + dx, y + dy, z], [x - dx, y + dy, z]] satisfies World[]).map(project);
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
  function paintBackdrop() {
    const map = mapCorners.map(project);
    if (area.ocean) fill(map, "rgba(90, 121, 143, .16)");
    paintLand(area.mapPolygons, "#657787");

    if (area.hasData && satellite) {
      ctx.save();
      path(plane(0));
      ctx.clip();
      for (let row = 0; row < replay.rows; row++) {
        for (let col = 0; col < replay.cols; col++) {
          const kelvin = satellite.values[row * replay.cols + col];
          if (kelvin === null) continue;
          const opacity = Math.min(0.86, Math.max(0.025, (300 - kelvin) / 92));
          fill(cell(col * gridX, row * gridY, gridX * 0.51, gridY * 0.51, 0), `rgba(${cloudColor}, ${opacity})`);
        }
      }
      ctx.restore();
    }

    const { west: mapWest, south: mapSouth, east: mapEast, north: mapNorth } = mapBounds;
    const tickCount = width < 480 ? 3 : 5;
    const longitudes = coordinateTicks(mapWest, mapEast, tickCount);
    const latitudes = coordinateTicks(mapSouth, mapNorth, tickCount);
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(183, 207, 224, .32)";
    ctx.beginPath();
    for (const lon of longitudes) mapLine(lon, mapSouth, lon, mapNorth);
    for (const lat of latitudes) mapLine(mapWest, lat, mapEast, lat);
    ctx.stroke();
    ctx.restore();
    paintBoundaries(area.mapPolygons, "#a6b6c1", 0.9);
    paintBoundaries(area.focusPolygons, "#e0edf5", 1.3);

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
  }

  if (!reuse) paintBackdrop();
  if (backdrop && background) {
    backdrop.key = key;
    backdrop.area = area;
    backdrop.satellite = satellite;
    target.drawImage(backdrop.canvas, 0, 0, width, height);
    ctx = target;
  }

  if (stack && area.hasData) {
    const indexes = Array.from({ length: 5 }, (_, layer) => index - (4 - layer) * 2).filter(frame => frame >= 0);
    for (const [layer, frame] of indexes.entries()) {
      const z = (layer + 1) * 0.16;
      const surface = plane(z);
      if (area.ocean) {
        fill(surface, "rgba(14, 35, 54, 0.7)");
        ctx.strokeStyle = "rgba(110, 143, 161, 0.55)";
        ctx.stroke();
      }
      ctx.save();
      path(surface);
      ctx.clip();
      paintLand(area.polygons, "rgba(91,139,157,.62)", z);
      paintBoundaries(area.polygons, "#8aaeba", 1, z);
      ctx.restore();
      for (let row = 1; row < replay.rows - 1; row += 2) {
        for (let col = 1; col < replay.cols - 1; col += 2) {
          const value = replay.rain[frame].values[row * replay.cols + col] ?? 0;
          if (value < 1.5) continue;
          const opacity = Math.min(0.95, 0.1 + value / 32);
          fill(cell(col * gridX, row * gridY, gridX, gridY, z), `rgba(${rainColor}, ${opacity})`);
        }
      }
      const [x, y] = surface.reduce((right, point) => right[0] > point[0] ? right : point);
      ctx.textAlign = "left";
      ctx.fillStyle = "#cfdee4";
      ctx.fillText(utcClock(replay.rain[frame].time), Math.min(width - 36, x + 5), y);
    }
  }

  if (showsParticles) {
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
        if (rate < 0.5) continue;
        const drops = Math.ceil(Math.sqrt(rate) * 1.35);
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
    const maximum = Math.max(1, ...totals.map(value => value ?? 0));
    const relief = [];
    for (let row = 0; row < replay.rows - 2; row += 2) {
      for (let col = 0; col < replay.cols - 2; col += 2) {
        const corners = [[col, row], [col + 2, row], [col + 2, row + 2], [col, row + 2]];
        const values = corners.map(([x, y]) => totals[y * replay.cols + x]);
        if (values.some(value => value == null)) continue;
        const mean = values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 4;
        if (mean < 0.1) continue;
        const points = corners.map(([x, y], corner) => project([x * gridX, y * gridY, Math.sqrt((values[corner] ?? 0) / maximum) * 0.65]));
        const depth = project([(col + 1) * gridX, (row + 1) * gridY])[1];
        relief.push({ points, depth, mean });
      }
    }
    relief.sort((a, b) => a.depth - b.depth);
    for (const { points, mean } of relief) {
      const amount = Math.sqrt(mean / maximum);
      fill(points, `hsl(${194 - amount * 145}, ${67 + amount * 18}%, ${36 + amount * 40}%)`);
      ctx.strokeStyle = "rgba(9,26,40,.20)";
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
  }

}


type ViewState = {
  view: ReplayView;
  index: number;
  clouds: boolean;
  precipitation: boolean;
  totals?: readonly (number | null)[];
  accumulationLimit: number;
};

export function createReplayScene(canvas: HTMLCanvasElement, labels: HTMLDivElement, onContextLoss: () => void) {
  if (!canvas.getContext("2d")) throw new Error("Weather canvas unavailable");
  // Reuse the projected geography and cloud grid while only the rain particles move.
  const backdrop: ReplayBackdrop = { canvas: document.createElement("canvas") };
  let replay: WeatherReplay | undefined;
  let area: ReplayArea | undefined;
  let state: ViewState | undefined;
  let rotation = 0.42;
  let zoomLevel = 1;
  let tilt = 0.39;
  let previous = 0;
  let started = 0;
  let requested = 0;
  let phase = 0;
  let lastDraw = 0;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointers = new Map<number, [number, number]>();
  let pinchDistance = 0;

  function draw(now: number) {
    requested = 0;
    if (!replay || !area || !state || document.hidden || !canvas.clientWidth || !canvas.clientHeight) return;
    const animateRain = area.hasData && !motion.matches
      && (state.view === "rain" || (state.view === "weather" && state.precipitation));
    if (animateRain && lastDraw) phase += Math.min(0.05, (now - lastDraw) / 1000);
    lastDraw = animateRain ? now : 0;
    const progress = motion.matches ? 1 : Math.min(1, (now - started) / 240);
    paintReplay(canvas, replay, { ...state, area, rotation, zoom: zoomLevel, tilt, previous, progress, phase }, backdrop);
    canvas.dataset.replayReady ??= String(area.hasData);
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
    tilt = 0.39;
    redraw();
  }
  function onDown(event: PointerEvent) {
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    canvas.setPointerCapture(event.pointerId);
    pinchDistance = 0;
  }
  function onMove(event: PointerEvent) {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size > 1) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDistance > 0) zoom(distance / pinchDistance);
      pinchDistance = distance;
    } else {
      rotation += (event.clientX - before[0]) * 0.006;
      tilt = Math.max(0.18, Math.min(0.75, tilt + (event.clientY - before[1]) * 0.002));
      redraw();
    }
  }
  function onUp(event: PointerEvent) { pointers.delete(event.pointerId); pinchDistance = 0; }
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
      if (replay !== archive || area?.id !== nextArea.id || state?.view !== next.view) delete canvas.dataset.replayReady;
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
      delete canvas.dataset.replayReady;
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
