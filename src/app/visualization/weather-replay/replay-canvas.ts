import type { WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayArea } from "./replay-geography";
import { satelliteAt } from "./replay-data";
import type { ReplayView } from "@/lib/weather-replay/views";

type Point = [number, number];
type World = [number, number, number?];

const rainColor = "224, 117, 52";
const cloudColor = "39, 105, 163";

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

  const { south, north, west, east } = area.bounds;
  const aspect = Math.cos((south + north) * Math.PI / 360) * (east - west) / (north - south);
  const bearing = rotation;
  const sin = Math.sin(bearing);
  const cos = Math.cos(bearing);
  const stack = view === "time";
  const rain = view === "rain";
  const accumulation = view === "accumulation";
  const projectedWidth = Math.abs(cos) * aspect + Math.abs(sin);
  const scale = Math.min(width * (stack ? 0.68 : 0.78) / projectedWidth, height * (stack ? 0.87 : rain ? 0.91 : 0.98)) * zoom;
  const project = ([longitude, latitude, z = 0]: World): Point => {
    const x = (longitude - 0.5) * aspect;
    const y = latitude - 0.5;
    const depth = x * sin - y * cos;
    const perspective = rain ? 1 + depth * 0.26 : 1;
    return [
      width * 0.5 + (x * cos + y * sin) * scale * perspective,
      height * (rain ? 0.69 : stack ? 0.70 : 0.63) + (depth * tilt - z * 0.48) * scale * perspective,
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
    (lon - west) / (east - west), (lat - south) / (north - south), z,
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
  const paintLand = (z = 0, thickness = false) => {
    for (const polygon of area.polygons) {
      landPath(polygon, z);
      ctx.fillStyle = thickness ? "rgba(50,83,104,.55)" : "rgba(91,139,157,.62)";
      ctx.fill("evenodd");
      if (!thickness) {
        ctx.strokeStyle = "#8aaeba";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  };
  const gridX = 1 / (replay.cols - 1);
  const gridY = 1 / (replay.rows - 1);
  const base = plane(0);
  if (area.ocean) {
    fill(plane(-0.012), "rgba(51,99,128,.4)");
    fill(base, "rgba(62,114,147,.30)");
    ctx.strokeStyle = rain ? "#476c88" : "#537284";
    ctx.stroke();
  } else {
    paintLand(-0.012, true);
  }
  ctx.save();
  path(base);
  ctx.clip();
  paintLand();

  const paintCoastline = () => {
    for (const polygon of area.polygons) {
      landPath(polygon);
      ctx.strokeStyle = rain ? "#4f92b1" : "#8aaeba";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };

  const current = replay.rain[index];
  const satellite = satelliteAt(replay, current.time);
  if (area.hasData && clouds && satellite && view === "weather") {
    for (let row = 0; row < replay.rows; row++) {
      for (let col = 0; col < replay.cols; col++) {
        const kelvin = satellite.values[row * replay.cols + col];
        if (kelvin === null) continue;
        const opacity = Math.min(0.86, Math.max(0.025, (300 - kelvin) / 92));
        fill(cell(col * gridX, row * gridY, gridX * 0.51, gridY * 0.51, 0), `rgba(${cloudColor}, ${opacity})`);
      }
    }
  }
  paintCoastline();
  for (const polygon of area.focusPolygons) {
    landPath(polygon);
    ctx.strokeStyle = "#d3e8ef";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#a4bdcc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labels: [World, string][] = [[[0, -0.08], "西"], [[1, -0.08], "东"], [[0.5, 1.08], "北"]];
  for (const [point, label] of labels) {
    const [x, y] = project(point);
    ctx.fillText(label, x, y);
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
      paintLand(z);
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

  if (rain && area.hasData) {
    const rainBands: [number, number, number, number][][] = [[], [], []];
    const splashes: [number, number, number][] = [];
    for (let row = 0; row < replay.rows; row++) {
      for (let col = 0; col < replay.cols; col++) {
        const cellIndex = row * replay.cols + col;
        const value = current.values[cellIndex];
        if (value === null || value < 0.5) continue;
        const drops = Math.ceil(Math.sqrt(value) * 1.35);
        for (let drop = 0; drop < drops; drop++) {
          const seed = 1 + cellIndex * 23 + drop;
          const random = (salt: number) => ((Math.imul(seed + salt, 2654435761) >>> 8) % 65521) / 65521;
          const x = (col + (random(9) - 0.5) * 0.9) * gridX;
          const y = (row + (random(19) - 0.5) * 0.9) * gridY;
          const age = ((phase * (0.56 + 0.27 * random(29)) + random(39)) % 1 + 1) % 1;
          const ceiling = 0.34 + Math.sqrt(value / 75) * 0.4;
          const z = (1 - age) * ceiling;
          const [px, py] = project([x, y, z]);
          const [tx, ty] = project([x, y, z + 0.009 + 0.027 * random(49)]);
          const band = value >= 20 ? 2 : value >= 5 ? 1 : 0;
          rainBands[band].push([px, py, tx, ty]);
          if (drop === 0 && value >= 5 && age > 0.94) {
            const [sx, sy] = project([x, y]);
            splashes.push([sx, sy, 1 + (age - 0.94) * 43]);
          }
        }
      }
    }
    rainBands.forEach((drops, band) => {
      ctx.strokeStyle = ["rgba(129,181,218,.36)", "rgba(150,208,247,.58)", "rgba(216,241,255,.83)"][band];
      ctx.lineWidth = 0.55 + band * 0.22;
      ctx.beginPath();
      for (const [x, y, tx, ty] of drops) {
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
      }
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.strokeStyle = "rgba(136,213,255,.30)";
    for (const [x, y, radius] of splashes) {
      ctx.moveTo(x + radius, y);
      ctx.ellipse(x, y, radius, radius * 0.34, 0, 0, Math.PI * 2);
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

  if (area.hasData && precipitation && view === "weather") {
    const marks = [];
    for (let row = 0; row < replay.rows; row += 2) {
      for (let col = 0; col < replay.cols; col += 2) {
        const cellIndex = row * replay.cols + col;
        const value = current.values[cellIndex];
        if (value === null) continue;
        const before = replay.rain[previous].values[cellIndex] ?? value;
        const interpolated = before + (value - before) * progress;
        if (interpolated < 1.5) continue;
        const x = col * gridX;
        const y = row * gridY;
        marks.push({ x, y, value: interpolated, depth: project([x, y])[1] });
      }
    }
    marks.sort((a, b) => a.depth - b.depth);
    for (const { x, y, value } of marks) {
      const bottom = cell(x, y, gridX * 0.8, gridY * 0.8, 0);
      const top = cell(x, y, gridX * 0.8, gridY * 0.8, value / 75);
      const faces = [[0, 1], [1, 2], [2, 3], [3, 0]];
      faces.sort(([a, b], [c, d]) => bottom[a][1] + bottom[b][1] - bottom[c][1] - bottom[d][1]);
      faces.slice(2).forEach(([a, b], side) => {
        fill([bottom[a], bottom[b], top[b], top[a]], `rgba(${rainColor}, ${0.32 + value / 230 + side * 0.12})`);
      });
      fill(top, `rgba(${rainColor}, 0.86)`);
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

/** Keep the current controls while restoring the pre-6d506a6 drawing algorithms. */
export function createReplayScene(canvas: HTMLCanvasElement, labels: HTMLDivElement, onContextLoss: () => void) {
  if (!canvas.getContext("2d")) throw new Error("Weather canvas unavailable");
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
    if (!replay || !area || !state || document.hidden) return;
    const animateRain = state.view === "rain" && area.hasData && !motion.matches;
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
