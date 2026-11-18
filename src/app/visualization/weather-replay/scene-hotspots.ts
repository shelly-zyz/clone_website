import type { WeatherReplay } from "@/lib/weather-replay/model";
import { choosePlaces, clipLines, loadPlaces, loadProvinceLines, loadRelief, paintBasemap, traceRings, type Place, type Relief } from "./replay-basemap";
import type { RendererContext, SceneInput, SurfaceSize, ViewRenderer } from "./replay-canvas";
import { displacement, rainCadence, utcClock, type Hotspot } from "./replay-data";
import { blurField, upsample, type Grid } from "./replay-field";
import { gridCoordinate, type Coordinate } from "./replay-geography";
import { radarScale } from "./replay-palette";
import { clipToBounds, createPlanCamera, drawGeoImage, haloText, paintFrame } from "./replay-plan";

const factor = 6;
type Image = HTMLCanvasElement;

/** Stepped radar classes with soft edges from the interpolated field. */
function radarImage(replay: WeatherReplay, values: Grid) {
  const field = blurField(upsample(values, replay.cols, replay.rows, factor), 1);
  const canvas = document.createElement("canvas");
  canvas.width = field.width;
  canvas.height = field.height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(field.width, field.height);
  const classes = radarScale.map(([at, color], i) => ({ at, color, alpha: Math.min(.96, .62 + i * .05) }));
  for (let y = 0; y < field.height; y++) {
    const source = (field.height - 1 - y) * field.width;
    for (let x = 0; x < field.width; x++) {
      const value = field.data[source + x];
      if (!(value >= classes[0].at)) continue;
      let k = 0;
      while (k < classes.length - 1 && value >= classes[k + 1].at) k++;
      const { color, alpha } = classes[k];
      // Feather the lightest class so rain shields fade into the map.
      const fade = k === 0 ? Math.min(1, (value - classes[0].at) / .5 + .35) : 1;
      const i = (y * field.width + x) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255 * alpha * fade;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function hull(points: [number, number][]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const levelOf = (peak: number) => peak >= 25 ? 3 : peak >= 10 ? 2 : 1;
const levelColor = { 1: "#5b8cff", 2: "#ffd84a", 3: "#ff4d8d" } as const;
const levelName = { 1: "一般", 2: "较强", 3: "强" } as const;

export async function createHotspotScene({ overlay, invalidate }: RendererContext): Promise<ViewRenderer> {
  const camera = createPlanCamera(overlay, invalidate, { left: 120, right: 16, top: 8, bottom: 30 });
  let input: SceneInput | undefined;
  let relief: Relief | null = null;
  let places: Place[] = [];
  let provinces: Coordinate[][] = [];
  let basemap: { key: string; image: Image } | undefined;
  const fields = new Map<Grid, Image>();
  let shown: { index: number; changed: number; previous?: number } = { index: -1, changed: 0 };
  let polygons: { id: number; ring: [number, number][]; spot: Hotspot }[] = [];
  let disposed = false;

  function assets(area: SceneInput["area"]) {
    void Promise.all([loadRelief(area.mapBounds), loadPlaces(), loadProvinceLines()]).then(([r, p, lines]) => {
      if (disposed) return;
      relief = r;
      places = p;
      provinces = clipLines(lines, area.mapBounds);
      basemap = undefined;
      invalidate();
    });
  }

  function field(replay: WeatherReplay, index: number) {
    const values = replay.rain[index].values;
    let image = fields.get(values);
    if (!image) {
      image = radarImage(replay, values);
      fields.set(values, image);
      if (fields.size > 8) fields.delete(fields.keys().next().value!);
    }
    return image;
  }

  return {
    update(next) {
      if (input?.area !== next.area) {
        basemap = undefined;
        assets(next.area);
      }
      if (next.state.index !== shown.index) {
        shown = { index: next.state.index, changed: performance.now(), previous: input && input.replay === next.replay && shown.index >= 0 ? shown.index : undefined };
      }
      input = next;
    },
    render(now: number, { width, height, ratio }: SurfaceSize) {
      const surface = overlay.getContext("2d");
      if (!surface || !input) return false;
      const context = surface;
      const { replay, area, state } = input;
      const compact = width < 640;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      camera.layout(area.mapBounds, width, height, state.insets);
      const point = (lon: number, lat: number) => camera.point(lon, lat);

      const key = area.id + "|" + replay.id + "|" + (relief ? "r" : "-");
      if (basemap?.key !== key) {
        const aspect = Math.cos((area.mapBounds.north + area.mapBounds.south) * Math.PI / 360) * (area.mapBounds.east - area.mapBounds.west) / (area.mapBounds.north - area.mapBounds.south);
        const w = 1400, h = Math.round(w / aspect);
        basemap = { key, image: paintBasemap(w, h, area.mapBounds, "dark", area.mapPolygons, relief, 9) };
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      drawGeoImage(context, camera, basemap.image, area.mapBounds);

      if (area.hasData) {
        const { bounds } = replay;
        const dx = (bounds.east - bounds.west) / (replay.cols - 1) / factor / 2;
        const dy = (bounds.north - bounds.south) / (replay.rows - 1) / factor / 2;
        const imageBounds = { west: bounds.west - dx, east: bounds.east + dx, south: bounds.south - dy, north: bounds.north + dy };
        const t = Math.min(1, (now - shown.changed) / 420);
        context.save();
        if (shown.previous !== undefined && t < 1) {
          context.globalAlpha = 1 - t;
          drawGeoImage(context, camera, field(replay, shown.previous), imageBounds);
        }
        context.globalAlpha = shown.previous === undefined ? 1 : t;
        drawGeoImage(context, camera, field(replay, state.index), imageBounds);
        context.restore();
      }

      // Reference lines sit above the rain, as on radar products.
      context.save();
      clipToBounds(context, camera, area.mapBounds);
      context.lineJoin = "round";
      context.strokeStyle = "rgba(220, 226, 232, .16)";
      context.lineWidth = .7;
      traceRings(context, provinces, point, false);
      context.stroke();
      context.strokeStyle = "rgba(226, 232, 238, .5)";
      context.lineWidth = .9;
      for (const polygon of area.mapPolygons) {
        traceRings(context, polygon, point, true);
        context.stroke();
      }
      context.restore();
      paintFrame(context, camera, replay.bounds, "rgba(220,228,236,.28)", "rgba(206,214,222,.78)", compact);

      polygons = [];
      const labelAvoid: [number, number, number][] = [];
      if (area.hasData) paintHotspots();

      context.font = (compact ? 10 : 11) + "px system-ui, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "middle";
      for (const place of choosePlaces(places, area.mapBounds, point, compact ? 10 : 22, compact ? 30 : 46, labelAvoid)) {
        context.fillStyle = "#e9edf0";
        context.beginPath();
        context.arc(place.x, place.y, place.rank <= 2 ? 2.4 : 1.7, 0, Math.PI * 2);
        context.fill();
        haloText(context, place.name, place.x + 5, place.y, place.rank <= 2 ? "#f2f5f7" : "#c9d0d6", "rgba(20,22,24,.85)", 3);
      }

      if (state.selectedCell !== undefined && area.hasData) {
        const [lon, lat] = gridCoordinate(replay, state.selectedCell % replay.cols, Math.floor(state.selectedCell / replay.cols));
        const [x, y] = point(lon, lat);
        context.strokeStyle = "#fff";
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(x - 8, y); context.lineTo(x - 3, y);
        context.moveTo(x + 3, y); context.lineTo(x + 8, y);
        context.moveTo(x, y - 8); context.lineTo(x, y - 3);
        context.moveTo(x, y + 3); context.lineTo(x, y + 8);
        context.stroke();
      }
      return shown.previous !== undefined && now - shown.changed < 420;

      function paintHotspots() {
        const { spots, tracks, trackId, index } = state;
        const values = replay.rain[index].values;
        const halfX = .5, halfY = .5;
        // Polygons for the strongest systems; minor cells keep a core dot only.
        const ranked = [...spots].sort((a, b) => b.peak * Math.sqrt(b.area) - a.peak * Math.sqrt(a.area));
        const major = new Set(ranked.filter(spot => spot.cells.length >= 3).slice(0, compact ? 4 : 7).map(spot => spot.id));
        if (trackId !== undefined) major.add(trackId);
        const step = rainCadence(replay) / 3_600_000;
        const stepLabel = step >= 1 ? `未来 ${Number(step.toFixed(1))} 小时` : `未来 ${Math.round(step * 60)} 分钟`;
        for (const spot of [...spots].sort((a, b) => (a.id === trackId ? 1 : 0) - (b.id === trackId ? 1 : 0))) {
          const selected = spot.id === trackId;
          const level = levelOf(spot.peak);
          const color = levelColor[level];
          let peakCell = spot.cells[0];
          for (const cell of spot.cells) if ((values[cell] ?? 0) > (values[peakCell] ?? 0)) peakCell = cell;
          const core = point(...gridCoordinate(replay, peakCell % replay.cols, Math.floor(peakCell / replay.cols)));
          if (!major.has(spot.id)) {
            context.fillStyle = color;
            context.globalAlpha = .75;
            context.beginPath();
            context.arc(core[0], core[1], 2, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = 1;
            continue;
          }
          const corners: [number, number][] = [];
          for (const cell of spot.cells) {
            const col = cell % replay.cols, row = Math.floor(cell / replay.cols);
            for (const [ox, oy] of [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]]) {
              corners.push(point(...gridCoordinate(replay, col + ox, row + oy)));
            }
          }
          const ring = hull(corners);
          polygons.push({ id: spot.id, ring, spot });
          context.beginPath();
          ring.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
          context.closePath();
          context.fillStyle = color + (selected ? "1f" : "10");
          context.fill();
          if (selected) {
            context.shadowColor = color;
            context.shadowBlur = 10;
          }
          context.strokeStyle = color;
          context.lineWidth = selected ? 2.4 : 1.5;
          context.stroke();
          context.shadowBlur = 0;

          const track = (tracks.get(spot.id) ?? []).filter(item => item.frame <= index);
          const centers = track.map(item => point(...gridCoordinate(replay, item.center[0] * (replay.cols - 1), item.center[1] * (replay.rows - 1))));
          const here = centers[centers.length - 1] ?? point(...gridCoordinate(replay, spot.center[0] * (replay.cols - 1), spot.center[1] * (replay.rows - 1)));
          if (centers.length > 1) {
            context.strokeStyle = selected ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.55)";
            context.lineWidth = selected ? 1.8 : 1.1;
            context.setLineDash([]);
            context.beginPath();
            centers.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
            context.stroke();
            let lastLabel: [number, number] | undefined;
            centers.slice(0, -1).forEach(([x, y], i) => {
              context.fillStyle = "#fff";
              context.beginPath();
              context.arc(x, y, selected ? 2.6 : 1.8, 0, Math.PI * 2);
              context.fill();
              // Dense 15-minute tracks only label points that have room.
              if (selected && (!lastLabel || Math.hypot(x - lastLabel[0], y - lastLabel[1]) > 34) && Math.hypot(x - here[0], y - here[1]) > 24) {
                lastLabel = [x, y];
                context.font = "600 10px system-ui, sans-serif";
                context.textAlign = "right";
                context.textBaseline = "bottom";
                haloText(context, utcClock(replay.rain[track[i].frame].time), x - 5, y - 3, "#ffffff", "rgba(10,12,14,.85)");
              }
            });
          }
          // Linear extrapolation from the last two matched centres; drawn only for consecutive frames.
          const last = track[track.length - 1], before = track[track.length - 2];
          if (last && before && last.frame - before.frame === 1) {
            const [ex, ey] = [here[0] - centers[centers.length - 2][0], here[1] - centers[centers.length - 2][1]];
            const length = Math.hypot(ex, ey);
            if (length > 2) {
              const tip: [number, number] = [here[0] + ex, here[1] + ey];
              const angle = Math.atan2(ey, ex);
              context.strokeStyle = selected ? "rgba(64, 170, 255, .95)" : "rgba(64, 170, 255, .7)";
              context.fillStyle = context.strokeStyle;
              context.lineWidth = selected ? 6 : 3.5;
              context.lineCap = "round";
              context.beginPath();
              context.moveTo(here[0], here[1]);
              context.lineTo(tip[0] - Math.cos(angle) * 10, tip[1] - Math.sin(angle) * 10);
              context.stroke();
              context.lineCap = "butt";
              const head = selected ? 15 : 11;
              context.beginPath();
              context.moveTo(tip[0], tip[1]);
              context.lineTo(tip[0] - head * Math.cos(angle - .42), tip[1] - head * Math.sin(angle - .42));
              context.lineTo(tip[0] - head * Math.cos(angle + .42), tip[1] - head * Math.sin(angle + .42));
              context.closePath();
              context.fill();
              if (selected) {
                const [kx, ky] = displacement(replay, before.center, last.center);
                const speed = Math.hypot(kx, ky) / step;
                context.font = "600 11px system-ui, sans-serif";
                context.textAlign = Math.cos(angle) >= 0 ? "left" : "right";
                context.textBaseline = "middle";
                const ox = Math.cos(angle) >= 0 ? 10 : -10;
                haloText(context, `${stepLabel} · 外推`, tip[0] + ox, tip[1] - 7, "#8fd0ff", "rgba(10,12,14,.9)");
                haloText(context, `${Math.round(speed)} km/h`, tip[0] + ox, tip[1] + 8, "#cfe9ff", "rgba(10,12,14,.9)");
                labelAvoid.push([tip[0], tip[1], 40]);
              }
            }
          }
          // Core: peak cell triangle.
          context.fillStyle = selected ? "#ffffff" : color;
          context.strokeStyle = "rgba(10,12,14,.9)";
          context.lineWidth = 1.2;
          context.beginPath();
          const r = selected ? 6.5 : 4.5;
          context.moveTo(core[0], core[1] - r);
          context.lineTo(core[0] + r * .87, core[1] + r * .5);
          context.lineTo(core[0] - r * .87, core[1] + r * .5);
          context.closePath();
          context.fill();
          context.stroke();
          labelAvoid.push([core[0], core[1], 24]);

          // Callout to the upper right of the polygon, or upper left near the right edge.
          const flip = ring.some(([x]) => x > width - (selected ? 230 : 70));
          const top = ring.reduce((best, p) => (flip ? -p[0] : p[0]) - p[1] > (flip ? -best[0] : best[0]) - best[1] ? p : best, ring[0]);
          const anchor: [number, number] = [top[0] + (selected ? 26 : 14) * (flip ? -1 : 1), top[1] - (selected ? 22 : 12)];
          context.strokeStyle = selected ? "#ffffff" : "rgba(255,255,255,.6)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(top[0], top[1]);
          context.lineTo(anchor[0], anchor[1]);
          context.stroke();
          context.textAlign = flip ? "right" : "left";
          context.textBaseline = "bottom";
          context.font = selected ? "700 13px system-ui, sans-serif" : "600 10px system-ui, sans-serif";
          const reach = selected ? Math.max(context.measureText(`热点 ${spot.id} · ${levelName[level]}降水核`).width, 170) : 40;
          // Keep the callout text inside the stage on narrow screens.
          const textX = flip ? Math.max(reach + 8, anchor[0] - 4) : Math.min(width - reach - 8, anchor[0] + 4);
          if (selected) {
            context.font = "700 13px system-ui, sans-serif";
            haloText(context, `热点 ${spot.id} · ${levelName[level]}降水核`, textX, anchor[1] - 1, "#ffffff", "rgba(10,12,14,.92)", 4);
            context.font = "600 11px system-ui, sans-serif";
            context.textBaseline = "top";
            haloText(context, `峰值 ${spot.peak.toFixed(1)} mm/h · ${Math.round(spot.area).toLocaleString("zh-CN")} km²`, textX, anchor[1] + 2, color, "rgba(10,12,14,.92)", 4);
          } else {
            context.font = "600 10px system-ui, sans-serif";
            haloText(context, `${spot.id} · ${spot.peak.toFixed(0)}`, textX, anchor[1] + 4, "#e8edf2", "rgba(10,12,14,.9)");
          }
          labelAvoid.push([anchor[0] + 40, anchor[1], 50]);
        }
      }
    },
    pick(x, y) {
      if (!input) return;
      const { replay } = input;
      const [lon, lat] = camera.unpoint(x, y);
      const { west, east, south, north } = replay.bounds;
      if (lon < west || lon > east || lat < south || lat > north) return;
      const col = Math.round((lon - west) / (east - west) * (replay.cols - 1));
      const row = Math.round((lat - south) / (north - south) * (replay.rows - 1));
      const cell = row * replay.cols + col;
      const inside = (ring: [number, number][]) => {
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [a, b] = ring[i], [c, d] = ring[j];
          if ((b > y) !== (d > y) && x < a + (c - a) * (y - b) / (d - b)) hit = !hit;
        }
        return hit;
      };
      const hotspot = polygons.find(polygon => inside(polygon.ring))?.id ?? input.state.spots.find(spot => spot.cells.includes(cell))?.id;
      return { cell, hotspot };
    },
    zoom: camera.zoom,
    reset: camera.reset,
    dispose() {
      disposed = true;
      camera.dispose();
    },
  };
}
