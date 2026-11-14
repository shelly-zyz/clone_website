import type { WeatherReplay } from "@/lib/weather-replay/model";

type Point = [number, number];
type World = [number, number, number?];
export type ReplayView = "weather" | "time";

const bearings = [0.42, -0.42, 2.72, 3.56];
const rainColor = "224, 117, 52";
const cloudColor = "39, 105, 163";

export const utcClock = (iso: string) => iso.slice(11, 16);

export function paintReplay(
  canvas: HTMLCanvasElement,
  replay: WeatherReplay,
  { index, view, rotation, clouds, precipitation, previous, progress }: {
    index: number;
    view: ReplayView;
    rotation: number;
    clouds: boolean;
    precipitation: boolean;
    previous: number;
    progress: number;
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

  const { south, north, west, east } = replay.bounds;
  const aspect = Math.cos((south + north) * Math.PI / 360) * (east - west) / (north - south);
  const bearing = bearings[rotation % bearings.length];
  const sin = Math.sin(bearing);
  const cos = Math.cos(bearing);
  const stack = view === "time";
  const projectedWidth = Math.abs(cos) * aspect + Math.abs(sin);
  const scale = Math.min(width * (stack ? 0.68 : 0.8) / projectedWidth, height * (stack ? 0.9 : 1.02));
  const project = ([longitude, latitude, z = 0]: World): Point => {
    const x = (longitude - 0.5) * aspect;
    const y = latitude - 0.5;
    return [
      width * 0.5 + (x * cos + y * sin) * scale,
      height * (stack ? 0.72 : 0.66) + ((x * sin - y * cos) * 0.43 - z * 0.48) * scale,
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
  const gridX = 1 / (replay.cols - 1);
  const gridY = 1 / (replay.rows - 1);
  const base = plane(0);
  fill(base, "#dce8ee");
  ctx.strokeStyle = "#869eac";
  ctx.stroke();
  ctx.save();
  ctx.clip();

  const paintCoastline = () => {
    ctx.strokeStyle = "#426373";
    ctx.lineWidth = 1;
    for (const line of replay.coastline) {
      ctx.beginPath();
      ctx.moveTo(...project(line[0]));
      for (let point = 1; point < line.length; point++) ctx.lineTo(...project(line[point]));
      ctx.stroke();
    }
  };

  const current = replay.rain[index];
  const satellite = replay.satellite.findLast(frame => frame.time <= current.time);
  if (clouds && satellite && !stack) {
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
  ctx.restore();

  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#395665";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labels: [World, string][] = [[[0, -0.08], "西"], [[1, -0.08], "东"], [[0.5, 1.08], "北"]];
  for (const [point, label] of labels) {
    const [x, y] = project(point);
    ctx.fillText(label, x, y);
  }

  if (stack) {
    const indexes = Array.from({ length: 5 }, (_, layer) => index - (4 - layer) * 2).filter(frame => frame >= 0);
    for (const [layer, frame] of indexes.entries()) {
      const z = (layer + 1) * 0.16;
      const surface = plane(z);
      fill(surface, "rgba(233, 241, 246, 0.55)");
      ctx.strokeStyle = "rgba(110, 143, 161, 0.55)";
      ctx.stroke();
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
      ctx.fillStyle = "#243f50";
      ctx.fillText(utcClock(replay.rain[frame].time), Math.min(width - 36, x + 5), y);
    }
  }

  if (precipitation && !stack) {
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
