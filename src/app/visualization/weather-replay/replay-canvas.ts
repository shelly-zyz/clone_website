import type { WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayArea } from "./replay-geography";
import { cellPosition, contourSegments, satelliteAt, stackFrameIndices, utcClock, type Hotspot } from "./replay-data";
import { replayTexture, type ReplayTextureLayer } from "./replay-palette";
import type { ReplayView } from "@/lib/weather-replay/views";

type Point = [number, number];
type World = [number, number, number?];

// Clouds float above the map; rain starts just under the cloud base and falls to the ground.
const cloudBase = .36;
const cloudDepth = .2;
const rainCeiling = .33;
const rainTail = 0.03;
const rainStroke = "rgba(139, 201, 245, .63)";

function timeStack(replay: WeatherReplay, index: number) {
  const frames = stackFrameIndices(replay, index);
  const last = frames[frames.length - 1];
  const start = Date.parse(replay.rain[frames[0]].time);
  const duration = Date.parse(replay.rain[last].time) - start;
  const heightAt = (frame: number) => .09 + .81 * (duration ? (Date.parse(replay.rain[frame].time) - start) / duration : 0);
  return { frames, last, heightAt };
}

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

type Grid = readonly (number | null)[];
type CloudField = { density: Float32Array; key: string };
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const densities = new WeakMap<Grid, Float32Array>();

/** Cloud amount from infrared brightness temperature or GFS cover, softened over neighboring cells. */
function cloudDensity(values: Grid, cols: number, rows: number, cover: boolean) {
  const saved = densities.get(values);
  if (saved) return saved;
  let field = new Float32Array(values.length);
  values.forEach((value, i) => {
    if (value != null) field[i] = clamp01(cover ? (value - 30) / 70 : (282 - value) / 80);
  });
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(field.length);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let sum = 0, weights = 0;
        for (let y = Math.max(0, row - 1); y <= Math.min(rows - 1, row + 1); y++) {
          for (let x = Math.max(0, col - 1); x <= Math.min(cols - 1, col + 1); x++) {
            const weight = (x === col ? 2 : 1) * (y === row ? 2 : 1);
            sum += field[y * cols + x] * weight;
            weights += weight;
          }
        }
        next[row * cols + col] = sum / weights;
      }
    }
    field = next;
  }
  // Thin the clouds toward the data edge so the deck dissolves instead of ending in a straight line.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const edge = Math.min(row, col, rows - 1 - row, cols - 1 - col);
      field[row * cols + col] *= clamp01((edge + .5) / 6);
    }
  }
  densities.set(values, field);
  return field;
}

/** Use the same cloud source frame as the transect readout. */
function cloudField(replay: WeatherReplay, time: string): CloudField | undefined {
  const frame = satelliteAt(replay, time);
  if (!frame) return;
  return {
    density: cloudDensity(frame.values, replay.cols, replay.rows, replay.metadata?.cloudVariable === "cover"),
    key: frame.time,
  };
}

function densityRaster(density: Float32Array, cols: number, rows: number, color: readonly [number, number, number], opacity: number) {
  const image = document.createElement("canvas");
  image.width = cols;
  image.height = rows;
  const painter = image.getContext("2d");
  if (!painter) return image;
  const pixels = painter.createImageData(cols, rows);
  density.forEach((amount, i) => {
    if (amount < .04) return;
    pixels.data.set(color, i * 4);
    pixels.data[i * 4 + 3] = Math.round(255 * opacity * Math.min(1, amount * 1.25));
  });
  painter.putImageData(pixels, 0, 0);
  return image;
}

// Overlapping lobes give each puff an irregular cumulus edge instead of a perfect disc.
const puffLobes = [
  [[64, 66, 44], [42, 72, 28], [88, 70, 30], [58, 46, 28], [78, 52, 24]],
  [[62, 64, 42], [36, 66, 26], [90, 62, 28], [70, 44, 30], [52, 84, 24]],
  [[66, 62, 40], [44, 54, 30], [86, 78, 28], [40, 82, 22], [84, 46, 24]],
] as const;
let sprites: { lit: HTMLCanvasElement[]; shade: HTMLCanvasElement[] } | undefined;

function puffSprite(lobes: (typeof puffLobes)[number], light: boolean) {
  const image = document.createElement("canvas");
  image.width = image.height = 128;
  const painter = image.getContext("2d");
  if (!painter) return image;
  for (const [x, y, r] of lobes) {
    // Lit puffs are brightest toward the upper-left sun; the shade sprite darkens the cloud base.
    const glow = painter.createRadialGradient(x - r * (light ? .32 : 0), y - r * (light ? .38 : 0), r * .08, x, y, r);
    glow.addColorStop(0, light ? "rgba(255, 255, 255, .92)" : "rgba(70, 82, 102, .85)");
    glow.addColorStop(light ? .5 : .55, light ? "rgba(238, 243, 249, .62)" : "rgba(92, 104, 124, .42)");
    glow.addColorStop(1, light ? "rgba(214, 224, 236, 0)" : "rgba(110, 122, 142, 0)");
    painter.fillStyle = glow;
    painter.beginPath();
    painter.arc(x, y, r, 0, Math.PI * 2);
    painter.fill();
  }
  return image;
}

function cloudSprites() {
  if (sprites) return sprites;
  sprites = {
    lit: puffLobes.map(lobes => puffSprite(lobes, true)),
    shade: puffLobes.map(lobes => puffSprite(lobes, false)),
  };
  return sprites;
}

const layers = new WeakMap<HTMLCanvasElement, Map<string, { key: string; image: HTMLCanvasElement }>>();

/** Reuse static scene layers while only the falling rain animates. */
function cachedLayer(owner: HTMLCanvasElement, name: string, key: string | undefined, ratio: number,
  output: CanvasRenderingContext2D, paint: (target: CanvasRenderingContext2D) => void) {
  if (key === undefined) {
    paint(output);
    return;
  }
  let named = layers.get(owner);
  if (!named) layers.set(owner, named = new Map());
  let entry = named.get(name);
  if (!entry) named.set(name, entry = { key: "", image: document.createElement("canvas") });
  if (entry.key !== key) {
    entry.image.width = owner.width;
    entry.image.height = owner.height;
    const target = entry.image.getContext("2d");
    if (!target) {
      paint(output);
      return;
    }
    target.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint(target);
    entry.key = key;
  }
  output.save();
  output.setTransform(1, 0, 0, 1, 0, 0);
  output.drawImage(entry.image, 0, 0);
  output.restore();
}

function replayCamera(width: number, height: number, area: ReplayArea, view: ReplayView,
  rotation: number, zoom: number, tilt: number, pan: Point = [0, 0]) {
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
  const bottom = Math.max(...ys), top = Math.min(...ys) - (area.hasData ? view === "time" ? .48 : view === "weather" ? .28 : 0 : 0);
  const scale = Math.min(width * (width > 960 ? .55 : .83) / (right - left), height * (width < 600 ? .77 : view === "time" ? .62 : view === "weather" ? .68 : .54) / (bottom - top)) * zoom;
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const offsetX = width * .5 + pan[0], offsetY = height * (view === "time" ? .43 : .46) + pan[1];
  const project = ([lon, lat, z = 0]: World): Point => {
    const [x, depth] = toView([lon, lat]);
    return [offsetX + (x - centerX) * scale, offsetY + (depth * tilt - z * .48 - centerY) * scale];
  };
  const unproject = (x: number, y: number): Point => {
    const vx = (x - offsetX) / scale + centerX;
    const depth = ((y - offsetY) / scale + centerY) / tilt;
    return [(vx * cos + depth * sin) / aspect + .5, vx * sin - depth * cos + .5];
  };
  const depth = ([lon, lat, z = 0]: World) => toView([lon, lat])[1] + z * tilt / .48;
  return { project, unproject, mapCorners, normalizeLat, normalizeLon, depth };
}

export function paintReplay(
  canvas: HTMLCanvasElement,
  replay: WeatherReplay,
  { index, view, rotation, clouds, precipitation, cloudOpacity = .68, sectionRow, peakCell, spots = [], trail = [], hotspotThreshold = 2.5, levels = [], previous, progress, phase = 0, totals, accumulationLimit = 1, rainLimit = 75, selectedCell, area, zoom = 1, tilt = 0.48, pan }: {
    index: number;
    view: ReplayView;
    rotation: number;
    clouds: boolean;
    precipitation: boolean;
    cloudOpacity?: number;
    sectionRow?: number;
    peakCell?: number;
    spots?: readonly Hotspot[];
    trail?: readonly Hotspot[];
    hotspotThreshold?: number;
    levels?: readonly number[];
    previous: number;
    progress: number;
    phase?: number;
    totals?: readonly (number | null)[];
    accumulationLimit?: number;
    rainLimit?: number;
    selectedCell?: number;
    area: ReplayArea;
    zoom?: number;
    tilt?: number;
    pan?: Point;
  },
) {
  const output = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!output || !width || !height) return;
  // Painters draw through `ctx`, which points at a cached layer while that layer is rebuilt.
  let ctx = output;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rasterWidth = Math.round(width * ratio);
  const rasterHeight = Math.round(height * ratio);
  if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
  }
  output.setTransform(ratio, 0, 0, ratio, 0, 0);
  output.clearRect(0, 0, width, height);

  const camera = replayCamera(width, height, area, view, rotation, zoom, tilt, pan);
  const { project, mapCorners, normalizeLat, normalizeLon, depth } = camera;
  const { mapBounds } = area;
  const stack = view === "time";
  const time = stack ? timeStack(replay, index) : undefined;
  const rain = view === "rain";
  const accumulation = view === "accumulation";
  const path = (polygon: Point[]) => {
    ctx.beginPath();
    ctx.moveTo(...polygon[0]);
    polygon.slice(1).forEach(point => ctx.lineTo(...point));
    ctx.closePath();
  };
  const plane = (z: number) => ([[0, 0, z], [1, 0, z], [1, 1, z], [0, 1, z]] satisfies World[]).map(project);
  const drawRaster = (raster: HTMLCanvasElement, z: number, alpha: number, [dx, dy]: Point = [0, 0], blur = 0) => {
    const [x, y] = project([dx, dy, z]);
    const [rightX, rightY] = project([1 + dx, dy, z]);
    const [downX, downY] = project([dx, 1 + dy, z]);
    ctx.save();
    path(plane(z));
    ctx.clip();
    ctx.globalAlpha = alpha;
    if (blur) ctx.filter = "blur(" + blur.toFixed(1) + "px)";
    ctx.imageSmoothingEnabled = true;
    ctx.transform((rightX - x) / (replay.cols - 1), (rightY - y) / (replay.cols - 1),
      (downX - x) / (replay.rows - 1), (downY - y) / (replay.rows - 1), x, y);
    ctx.drawImage(raster, -.5, -.5);
    ctx.restore();
  };
  const drawTexture = (values: readonly (number | null)[], z: number, alpha: number, layer: ReplayTextureLayer = "rain") =>
    drawRaster(replayTexture(values, replay.cols, replay.rows, layer, accumulation && layer === "accumulation" ? accumulationLimit : rainLimit), z, alpha);
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
  const cellSize = (z: number) => {
    const [x, y] = project([.5, .5, z]);
    const [ax, ay] = project([.5 + gridX, .5, z]);
    const [bx, by] = project([.5, .5 + gridY, z]);
    return (Math.hypot(ax - x, ay - y) + Math.hypot(bx - x, by - y)) / 2;
  };
  const current = replay.rain[index];
  const raining = area.hasData && view === "weather" && precipitation;
  const field = area.hasData && view === "weather" && clouds ? cloudField(replay, current.time) : undefined;
  const cut = sectionRow === undefined ? undefined : sectionRow * gridY;
  const cameraKey = [canvas.width, canvas.height, rotation, zoom, tilt, pan?.join(",") ?? "", view, area.id, replay.id].join("|");
  const animated = raining;

  cachedLayer(canvas, "scene", animated ? [cameraKey, index, field?.key ?? "", rainLimit, cut].join("|") : undefined,
    ratio, output, target => {
      ctx = target;
      paintScene();
      ctx = output;
    });

  function paintScene() {
    const [glowX, glowY] = project([.5, .5]);
    const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(width, height) * .61);
    glow.addColorStop(0, "#1b3344");
    glow.addColorStop(.6, "#102431");
    glow.addColorStop(1, "#09141d");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    paintLand(area.mapPolygons, "#1b3541");

    if (area.hasData && (view === "weather" || rain)) drawTexture(current.values, .008, rain ? .7 : .78);
    if (accumulation && totals) drawTexture(totals, .005, .91, "accumulation");

    const { west: mapWest, south: mapSouth, east: mapEast, north: mapNorth } = mapBounds;
    const tickCount = width < 480 ? 3 : 5;
    const longitudes = coordinateTicks(mapWest, mapEast, tickCount);
    const latitudes = coordinateTicks(mapSouth, mapNorth, tickCount);
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(165, 213, 226, .24)";
    ctx.beginPath();
    for (const lon of longitudes) mapLine(lon, mapSouth, lon, mapNorth);
    for (const lat of latitudes) mapLine(mapWest, lat, mapEast, lat);
    ctx.stroke();
    ctx.restore();
    paintBoundaries(area.mapPolygons, "rgba(180, 216, 225, .53)", 1.05);
    paintBoundaries(area.focusPolygons, "#b2d3e0", 1.35);

    // Anchor both scale axes to the nearest corner so labels stay outside the map.
    const corner = map.reduce((nearest, point, i) => point[1] > map[nearest][1] ? i : nearest, 0);
    const edgeLon = corner === 0 || corner === 3 ? mapWest : mapEast;
    const edgeLat = corner < 2 ? mapSouth : mapNorth;
    ctx.strokeStyle = "#7897a9";
    ctx.lineWidth = 1;
    ctx.font = (width < 480 ? 10 : 11) + "px system-ui, sans-serif";
    ctx.fillStyle = "#b5cbd9";
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

    if (time && area.hasData) {
      const { frames, last, heightAt } = time;
      const axis: World = [1, 0];
      const caption = project([axis[0], axis[1], .98]);
      strokeLine([project(axis), caption], "#a5beca", 1);
      ctx.textAlign = "left";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.fillStyle = "#cfe4ef";
      ctx.fillText("时间 UTC", Math.min(width - 53, caption[0] + 7), caption[1] - 9);
      for (const frame of frames) {
        const z = heightAt(frame);
        const active = frame === index;
        path(plane(z));
        ctx.fillStyle = active ? "rgba(28, 77, 91, .54)" : "rgba(17, 46, 66, .3)";
        ctx.fill();
        ctx.lineWidth = active ? 1.35 : .75;
        ctx.strokeStyle = active ? "#80e3ea" : "rgba(134, 190, 216, .44)";
        ctx.stroke();
        drawTexture(replay.rain[frame].values, z, active ? .97 : .33);
        paintBoundaries(area.mapPolygons, active ? "rgba(227, 249, 255, .76)" : "rgba(187, 217, 232, .38)", .9, z);
        const [x, y] = project([axis[0], axis[1], z]);
        strokeLine([[x - 3, y], [x + 5, y]], active ? "#8ce9f2" : "#a5beca", 1);
        ctx.fillStyle = active ? "#a2f2ff" : "#c5d4de";
        const stamp = replay.rain[frame].time;
        const label = replay.rain[frames[0]].time.slice(0, 10) !== replay.rain[last].time.slice(0, 10)
          ? stamp.slice(5, 10) + " " + utcClock(stamp) : utcClock(stamp);
        const activeY = project([axis[0], axis[1], heightAt(index)])[1];
        if (active || Math.abs(y - activeY) >= 13) {
          ctx.fillText(label, Math.min(width - (label.length > 5 ? 68 : 35), x + 7), y);
        }
      }
      paintTrail(trail.filter(spot => spot.frame >= frames[0] && spot.frame <= last), heightAt);
    }

    if (rain && area.hasData) {
      paintContours(current.values, [...new Set([hotspotThreshold, 10, 25])].sort((a, b) => a - b), "mm/h");
      paintTrail(trail, () => 0);
      for (const spot of spots) {
        const [x, y] = project(spot.center);
        const active = trail.some(item => item.id === spot.id);
        ctx.beginPath();
        ctx.arc(x, y, active ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = active ? "#8cf5ff" : "#ffdf9f";
        ctx.fill();
        if (active) {
          ctx.fillStyle = "#e5fbff";
          ctx.textAlign = "left";
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.fillText("热点 " + spot.id, x + 9, y - 8);
        }
      }
    }

    if (accumulation && totals) {
      paintContours(totals, levels, "mm");
      if (peakCell !== undefined) {
        const [x, y] = project(cellPosition(replay, peakCell));
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#fff8eb";
        ctx.fill();
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.strokeStyle = "#0c1c2a";
        ctx.lineWidth = 3;
        const label = (totals[peakCell] ?? 0).toFixed(1) + " mm";
        ctx.strokeText(label, x + 8, y - 6);
        ctx.fillText(label, x + 8, y - 6);
      }
    }

  }

  function strokeLine(points: Point[], color: string, width: number) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    points.slice(1).forEach(point => ctx.lineTo(...point));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function paintContours(values: readonly (number | null)[], thresholds: readonly number[], unit: string) {
    for (const [index, level] of thresholds.entries()) {
      const segments = contourSegments(values, replay.cols, replay.rows, level);
      ctx.beginPath();
      for (const [first, last] of segments) {
        ctx.moveTo(...project(first));
        ctx.lineTo(...project(last));
      }
      ctx.strokeStyle = index === 0 ? "#d5f8ff" : index === 1 ? "#fff4ce" : "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Label a segment near the outside of each contour to keep the interior legible.
      const label = segments.findLast(([point]) => point[0] < .8 && point[1] > .18);
      if (!label) continue;
      const [x, y] = project(label[0]);
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.strokeStyle = "#0b1824";
      ctx.lineWidth = 3;
      ctx.strokeText(level + " " + unit, x + 4, y - 5);
      ctx.fillText(level + " " + unit, x + 4, y - 5);
    }
  }

  function paintTrail(path: readonly Hotspot[], heightAt: (frame: number) => number) {
    const points = path.map(spot => project([...spot.center, heightAt(spot.frame)]));
    strokeLine(points, "#0a2631", 4);
    strokeLine(points, "#7ff4ff", 1.8);
    for (const [i, [x, y]] of points.entries()) {
      ctx.beginPath();
      ctx.arc(x, y, 2.9, 0, Math.PI * 2);
      ctx.fillStyle = "#aaf7ff";
      ctx.fill();
      const previous = points[i - 1];
      if (previous) {
        const angle = Math.atan2(y - previous[1], x - previous[0]);
        if (Math.hypot(x - previous[0], y - previous[1]) > 13) {
          strokeLine([[x - 9 * Math.cos(angle - .45), y - 9 * Math.sin(angle - .45)],
            [x, y], [x - 9 * Math.cos(angle + .45), y - 9 * Math.sin(angle + .45)]], "#7ff4ff", 1.8);
        }
      }
      if (rain && i < points.length - 1) {
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(utcClock(replay.rain[path[i].frame].time), x - 6, y - 6);
      }
    }
  }

  if (raining) {
    const previousValues = replay.rain[previous].values;
    ctx.strokeStyle = rainStroke;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    for (let row = sectionRow ?? 0; row < replay.rows; row++) {
      for (let col = 0; col < replay.cols; col++) {
        const cellIndex = row * replay.cols + col;
        const value = current.values[cellIndex];
        if (value == null) continue;
        const before = previousValues[cellIndex] ?? value;
        const rate = before + (value - before) * progress;
        if (rate < 0.4) continue;
        const drops = Math.ceil(Math.sqrt(rate) * 1.05);
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

  if (field) {
    const density = field.density;
    cachedLayer(canvas, "clouds", [cameraKey, field.key, cloudOpacity, cut].join("|"), ratio, output, target => {
      ctx = target;
      paintClouds(density, cloudOpacity);
      ctx = output;
    });
  }

  // Volumetric cloud puffs, painted back to front with darker bases under thick convective cells.
  function paintClouds(density: Float32Array, strength: number) {
    const { lit, shade: base } = cloudSprites();
    const cell = cellSize(cloudBase);
    if (cut === undefined) drawRaster(densityRaster(density, replay.cols, replay.rows, [228, 235, 244], .4 * strength),
      cloudBase + .04, 1, [0, 0], cell);
    const puffs: { x: number; y: number; radius: number; alpha: number; amount: number; variant: number; depth: number }[] = [];
    for (let row = sectionRow ?? 0; row < replay.rows; row++) {
      for (let col = 0; col < replay.cols; col++) {
        const cellIndex = row * replay.cols + col;
        const amount = density[cellIndex];
        if (amount < .1 || (amount < .4 && (row + col) % 2)) continue;
        const count = amount > .62 ? 2 : 1;
        for (let puff = 0; puff < count; puff++) {
          const seed = 7 + cellIndex * 5 + puff;
          const lon = clamp01((col + (rainRandom(seed, 3) - .5) * 1.4) * gridX);
          const lat = Math.max(cut ?? 0, clamp01((row + (rainRandom(seed, 5) - .5) * 1.4) * gridY));
          const z = cloudBase + amount * cloudDepth * (.25 + .75 * rainRandom(seed, 7));
          const [x, y] = project([lon, lat, z]);
          puffs.push({
            x, y, amount,
            radius: cell * (1.15 + 1.9 * amount) * (.75 + .5 * rainRandom(seed, 11)),
            alpha: strength * (.16 + .6 * amount) * (.8 + .2 * rainRandom(seed, 13)),
            variant: Math.floor(rainRandom(seed, 17) * puffLobes.length),
            depth: depth([lon, lat, z]),
          });
        }
      }
    }
    puffs.sort((a, b) => a.depth - b.depth);
    for (const { x, y, radius, alpha, amount, variant } of puffs) {
      ctx.globalAlpha = alpha * (.3 + .7 * amount);
      ctx.drawImage(base[variant], x - radius, y - radius * .64, radius * 2, radius * 2);
      ctx.globalAlpha = alpha;
      ctx.drawImage(lit[variant], x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.globalAlpha = 1;
  }

  if (area.hasData && cut !== undefined) {
    const left = project([0, cut]), right = project([1, cut]);
    const topLeft = project([0, cut, cloudBase + cloudDepth]);
    const topRight = project([1, cut, cloudBase + cloudDepth]);
    path([left, right, topRight, topLeft]);
    ctx.fillStyle = "rgba(77, 191, 206, .09)";
    ctx.fill();
    ctx.setLineDash([4, 4]);
    strokeLine([left, topLeft, topRight, right], "#75acb6", 1);
    ctx.setLineDash([]);
    strokeLine([left, right], "#8ceaff", 1.6);
    ctx.fillStyle = "#b7f0fb";
    ctx.textAlign = "center";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText("A", left[0] - 9, left[1]);
    ctx.fillText("B", right[0] + 9, right[1]);
  }

  if (area.hasData && selectedCell !== undefined) {
    const position = cellPosition(replay, selectedCell);
    const [x, y] = project([...position, time?.heightAt(index) ?? 0]);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#3f3229";
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#fff8ed";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff8ed";
    ctx.fill();
  }

}


type ViewState = {
  view: ReplayView;
  index: number;
  clouds: boolean;
  precipitation: boolean;
  cloudOpacity: number;
  sectionRow?: number;
  peakCell?: number;
  spots: readonly Hotspot[];
  trail: readonly Hotspot[];
  hotspotThreshold: number;
  levels: readonly number[];
  totals?: readonly (number | null)[];
  accumulationLimit: number;
  rainLimit: number;
  selectedCell?: number;
};

export function createReplayScene(canvas: HTMLCanvasElement, onContextLoss: () => void, onPick?: (cell: number, hotspot: number | undefined, view: ReplayView) => void) {
  if (!canvas.getContext("2d")) throw new Error("Weather canvas unavailable");
  let replay: WeatherReplay | undefined;
  let area: ReplayArea | undefined;
  let state: ViewState | undefined;
  let rotation = 0.42;
  let zoomLevel = 1;
  let tilt = 0.48;
  let pan: Point = [0, 0];
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
      && state.view === "weather" && state.precipitation;
    if (animateRain && lastDraw && now - lastDraw < 30) {
      redraw();
      return;
    }
    if (animateRain && lastDraw) phase += Math.min(0.05, (now - lastDraw) / 1000);
    lastDraw = animateRain ? now : 0;
    const progress = motion.matches ? 1 : Math.min(1, (now - started) / 240);
    paintReplay(canvas, replay, { ...state, area, rotation, zoom: zoomLevel, tilt, pan, previous, progress, phase });
    if (animateRain) redraw();
  }
  function redraw() {
    if (!requested && !document.hidden) requested = requestAnimationFrame(draw);
  }
  function zoom(factor: number) {
    zoomLevel = Math.max(0.74, Math.min(2.5, zoomLevel * factor));
    redraw();
  }
  function reset() {
    const topDown = state?.view === "rain" || state?.view === "accumulation";
    rotation = topDown ? 0 : 0.42;
    zoomLevel = 1;
    tilt = topDown ? 1 : 0.48;
    pan = [0, 0];
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
      pan = [pan[0] + (event.clientX - before[0]) / 2, pan[1] + (event.clientY - before[1]) / 2];
      redraw();
    } else if (!tap && (state?.view === "rain" || state?.view === "accumulation" || event.shiftKey || event.buttons === 2)) {
      pan = [pan[0] + event.clientX - before[0], pan[1] + event.clientY - before[1]];
      redraw();
    } else if (!tap) {
      rotation += (event.clientX - before[0]) * 0.006;
      tilt = Math.max(0.18, Math.min(0.75, tilt + (event.clientY - before[1]) * 0.002));
      redraw();
    }
  }
  function onUp(event: PointerEvent) {
    if (event.type === "pointerup" && tap?.id === event.pointerId && replay && area?.hasData && state) {
      const bounds = canvas.getBoundingClientRect();
      const camera = replayCamera(bounds.width, bounds.height, area, state.view, rotation, zoomLevel, tilt, pan);
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const altitude = state.view === "time" ? timeStack(replay, state.index).heightAt(state.index) : 0;
      const shift = camera.project([0, 0, altitude])[1] - camera.project([0, 0])[1];
      const [col, row] = camera.unproject(x, y - shift);
      if (col >= 0 && col <= 1 && row >= 0 && row <= 1) {
        const cell = Math.round(row * (replay.rows - 1)) * replay.cols + Math.round(col * (replay.cols - 1));
        const hotspot = state.view === "rain" ? state.spots.find(spot => {
          const [cx, cy] = camera.project(spot.center);
          return Math.hypot(cx - x, cy - y) <= 9;
        }) ?? state.spots.find(spot => spot.cells.includes(cell)) : undefined;
        onPick?.(cell, hotspot?.id, state.view);
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
  const suppressMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener("contextmenu", suppressMenu);
  canvas.addEventListener("contextlost", onContextLoss);
  document.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", redraw);
  return {
    update(archive: WeatherReplay, nextArea: ReplayArea, next: ViewState) {
      if (next.index !== state?.index || replay !== archive) {
        previous = replay === archive ? state?.index ?? next.index : next.index;
        started = performance.now();
      }
      const changedView = state?.view !== next.view || area?.id !== nextArea.id;
      replay = archive;
      area = nextArea;
      state = next;
      if (changedView) reset();
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
      canvas.removeEventListener("contextmenu", suppressMenu);
      canvas.removeEventListener("contextlost", onContextLoss);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", redraw);
    },
  };
}
