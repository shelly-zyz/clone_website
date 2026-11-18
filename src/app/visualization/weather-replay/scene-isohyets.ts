import type { WeatherReplay } from "@/lib/weather-replay/model";
import { choosePlaces, clipLines, loadPlaces, loadProvinceLines, loadRelief, paintBasemap, traceRings, type Place, type Relief } from "./replay-basemap";
import type { RendererContext, SceneInput, SurfaceSize, ViewRenderer } from "./replay-canvas";
import { blurField, isolines, joinSegments, localMaxima, upsample, type Field, type Grid } from "./replay-field";
import { gridCoordinate, type Coordinate } from "./replay-geography";
import { accumulationLevels, bandIndex, bandPalette } from "./replay-palette";
import { clipToBounds, createPlanCamera, drawGeoImage, haloText, paintFrame } from "./replay-plan";

const factor = 8;

type Bands = { totals: Grid; levels: readonly number[]; field: Field; image: HTMLCanvasElement; lines: { level: number; lines: [number, number][][] }[] };

function paintBands(replay: WeatherReplay, totals: Grid, levels: readonly number[]): Bands {
  const field = blurField(upsample(totals, replay.cols, replay.rows, factor), 2);
  const colors = bandPalette(levels);
  const canvas = document.createElement("canvas");
  canvas.width = field.width;
  canvas.height = field.height;
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(field.width, field.height);
    for (let y = 0; y < field.height; y++) {
      const source = (field.height - 1 - y) * field.width;
      for (let x = 0; x < field.width; x++) {
        const band = bandIndex(levels, field.data[source + x]);
        if (band < 0) continue;
        const i = (y * field.width + x) * 4;
        image.data.set(colors[band], i);
        image.data[i + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }
  const lines = levels.map(level => ({ level, lines: joinSegments(isolines(field, level)).filter(line => line.length > 6) }));
  return { totals, levels, field, image: canvas, lines };
}

const format = (value: number) => Number(value.toPrecision(3)).toString();

export async function createIsohyetScene({ overlay, invalidate }: RendererContext): Promise<ViewRenderer> {
  const camera = createPlanCamera(overlay, invalidate, { left: 128, right: 48, top: 60, bottom: 60 });
  let input: SceneInput | undefined;
  let relief: Relief | null = null;
  let places: Place[] = [];
  let provinces: Coordinate[][] = [];
  let basemap: { key: string; image: HTMLCanvasElement } | undefined;
  let bands: Bands | undefined;
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

  return {
    update(next) {
      if (input?.area !== next.area) {
        basemap = undefined;
        assets(next.area);
      }
      input = next;
    },
    render(_now: number, { width, height, ratio }: SurfaceSize) {
      const context = overlay.getContext("2d");
      if (!context || !input) return false;
      const { replay, area, state } = input;
      const compact = width < 640;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const paper = context.createLinearGradient(0, 0, 0, height);
      paper.addColorStop(0, "#f7f6f2");
      paper.addColorStop(1, "#ecebe6");
      context.fillStyle = paper;
      context.fillRect(0, 0, width, height);
      camera.layout(area.mapBounds, width, height);
      const point = (lon: number, lat: number) => camera.point(lon, lat);

      const key = area.id + "|" + replay.id + "|" + (relief ? "r" : "-");
      if (basemap?.key !== key) {
        const aspect = Math.cos((area.mapBounds.north + area.mapBounds.south) * Math.PI / 360) * (area.mapBounds.east - area.mapBounds.west) / (area.mapBounds.north - area.mapBounds.south);
        const w = 1400;
        basemap = { key, image: paintBasemap(w, Math.round(w / aspect), area.mapBounds, "paper", area.mapPolygons, relief, 8) };
      }
      context.save();
      context.shadowColor = "rgba(40, 44, 52, .18)";
      context.shadowBlur = 18;
      context.shadowOffsetY = 6;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      drawGeoImage(context, camera, basemap.image, area.mapBounds);
      context.restore();

      const levels = accumulationLevels(state.accumulationLimit);
      if (state.totals && area.hasData) {
        if (bands?.totals !== state.totals || bands.levels.join() !== levels.join()) bands = paintBands(replay, state.totals, levels);
        const { bounds } = replay;
        const dx = (bounds.east - bounds.west) / (replay.cols - 1) / factor / 2;
        const dy = (bounds.north - bounds.south) / (replay.rows - 1) / factor / 2;
        context.save();
        context.globalAlpha = .93;
        drawGeoImage(context, camera, bands.image, { west: bounds.west - dx, east: bounds.east + dx, south: bounds.south - dy, north: bounds.north + dy });
        context.restore();
      } else bands = undefined;

      const fieldPoint = (x: number, y: number) => {
        const [lon, lat] = gridCoordinate(replay, x / factor, y / factor);
        return point(lon, lat);
      };
      const labels: [number, number, number][] = [];
      if (bands) {
        // Isohyets: thin dark lines; heavier every other band, labelled along the longest runs.
        context.lineJoin = "round";
        bands.lines.forEach(({ level, lines }, i) => {
          context.strokeStyle = i % 2 ? "rgba(28, 32, 38, .62)" : "rgba(28, 32, 38, .38)";
          context.lineWidth = i % 2 ? .95 : .6;
          context.beginPath();
          for (const line of lines) {
            line.forEach(([x, y], k) => {
              const [px, py] = fieldPoint(x, y);
              if (k) context.lineTo(px, py); else context.moveTo(px, py);
            });
          }
          context.stroke();
          const runs = [...lines].sort((a, b) => b.length - a.length).slice(0, compact ? 1 : 2);
          for (const run of runs) {
            if (run.length < 30) continue;
            const [mx, my] = fieldPoint(...run[Math.floor(run.length / 2)]);
            if (labels.some(([x, y, r]) => Math.hypot(x - mx, y - my) < r)) continue;
            labels.push([mx, my, 46]);
            context.font = "600 10px system-ui, sans-serif";
            context.textAlign = "center";
            context.textBaseline = "middle";
            haloText(context, format(level), mx, my, "#1d2530", "rgba(255,255,255,.92)", 3.5);
          }
        });
      }

      context.save();
      clipToBounds(context, camera, area.mapBounds);
      context.strokeStyle = "rgba(70, 76, 84, .42)";
      context.lineWidth = .6;
      traceRings(context, provinces, point, false);
      context.stroke();
      context.strokeStyle = "rgba(48, 56, 66, .78)";
      context.lineWidth = 1;
      for (const polygon of area.mapPolygons) {
        traceRings(context, polygon, point, true);
        context.stroke();
      }
      context.restore();
      paintFrame(context, camera, replay.bounds, "rgba(40,46,54,.55)", "rgba(44,50,58,.85)", compact);

      if (bands) {
        // Rain maxima: strongest centre in red, secondary centres in dark ink.
        const maxima = localMaxima(bands.field, levels[Math.min(levels.length - 1, 3)], factor * 5, compact ? 3 : 6)
          .map(peak => ({ ...peak, raw: sourcePeak(state.totals!, replay, peak.x / factor, peak.y / factor) }))
          .sort((a, b) => b.raw - a.raw);
        maxima.forEach(({ x, y, raw }, i) => {
          const [px, py] = fieldPoint(x, y);
          const strongest = i === 0;
          context.strokeStyle = strongest ? "#b3122b" : "#1f2730";
          context.fillStyle = "#fff";
          context.lineWidth = strongest ? 2 : 1.4;
          context.beginPath();
          context.arc(px, py, strongest ? 6 : 4.5, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          context.beginPath();
          context.arc(px, py, strongest ? 2 : 1.5, 0, Math.PI * 2);
          context.fillStyle = context.strokeStyle;
          context.fill();
          context.font = (strongest ? "700 13px" : "600 11px") + " system-ui, sans-serif";
          context.textAlign = "left";
          context.textBaseline = "middle";
          haloText(context, raw.toFixed(1) + (strongest ? " mm" : ""), px + 9, py - 1, strongest ? "#a40f26" : "#1f2730", "rgba(255,255,255,.95)", 4);
          labels.push([px, py, 36]);
        });
      }

      context.font = (compact ? 10 : 11) + "px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "top";
      for (const place of choosePlaces(places, area.mapBounds, point, compact ? 10 : 26, compact ? 30 : 42, labels)) {
        context.fillStyle = "#2a3038";
        context.fillRect(place.x - 1.5, place.y - 1.5, 3, 3);
        haloText(context, place.name, place.x, place.y + 3, "#20262d", "rgba(255,255,255,.88)", 3);
      }

      if (state.selectedCell !== undefined && area.hasData) {
        const [x, y] = point(...gridCoordinate(replay, state.selectedCell % replay.cols, Math.floor(state.selectedCell / replay.cols)));
        context.strokeStyle = "#111";
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(x, y, 7, 0, Math.PI * 2);
        context.moveTo(x - 11, y); context.lineTo(x + 11, y);
        context.moveTo(x, y - 11); context.lineTo(x, y + 11);
        context.stroke();
      }

      if (area.hasData && state.accumulationStart !== undefined) {
        const start = replay.rain[state.accumulationStart].time, end = replay.rain[state.index].time;
        const text = `累计时段 ${start.slice(5, 10)} ${start.slice(11, 16)} — ${end.slice(5, 10)} ${end.slice(11, 16)} UTC`;
        context.font = "600 11px system-ui, sans-serif";
        context.textAlign = "left";
        context.textBaseline = "middle";
        const boxWidth = context.measureText(text).width + 16;
        context.fillStyle = "rgba(255,255,255,.9)";
        context.beginPath();
        context.roundRect(12, height - 34, boxWidth, 22, 5);
        context.fill();
        context.fillStyle = "#2a323c";
        context.fillText(text, 20, height - 23);
      }
      return false;
    },
    pick(x, y) {
      if (!input) return;
      const { replay } = input;
      const [lon, lat] = camera.unpoint(x, y);
      const { west, east, south, north } = replay.bounds;
      if (lon < west || lon > east || lat < south || lat > north) return;
      return {
        cell: Math.round((lat - south) / (north - south) * (replay.rows - 1)) * replay.cols
          + Math.round((lon - west) / (east - west) * (replay.cols - 1)),
      };
    },
    zoom: camera.zoom,
    reset: camera.reset,
    dispose() {
      disposed = true;
      camera.dispose();
    },
  };
}

/** Report the largest source-grid value near a smoothed maximum so labels match the readings panel. */
function sourcePeak(totals: Grid, replay: WeatherReplay, gx: number, gy: number) {
  let best = 0;
  for (let row = Math.max(0, Math.floor(gy) - 1); row <= Math.min(replay.rows - 1, Math.ceil(gy) + 1); row++) {
    for (let col = Math.max(0, Math.floor(gx) - 1); col <= Math.min(replay.cols - 1, Math.ceil(gx) + 1); col++) {
      best = Math.max(best, totals[row * replay.cols + col] ?? 0);
    }
  }
  return best;
}
