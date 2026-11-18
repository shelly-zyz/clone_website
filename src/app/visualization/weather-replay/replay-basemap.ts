import type { ReplayBounds } from "@/lib/weather-replay/model";
import type { Coordinate } from "./replay-geography";

export type Relief = { data: Float32Array; width: number; height: number; bounds: ReplayBounds; source: string };
export type Place = { lon: number; lat: number; name: string; rank: number; population: number; capital: boolean };
type Polygons = Coordinate[][][];
type Lines = Coordinate[][];

type Manifest = { source: string; items: { file: string; bounds: ReplayBounds }[] };
let manifest: Promise<Manifest | null> | undefined;
const reliefs = new Map<string, Promise<Relief | null>>();
let places: Promise<Place[]> | undefined;
let provinceLines: Promise<Lines> | undefined;

const json = <T>(path: string) => fetch(path, { signal: AbortSignal.timeout(20_000) })
  .then(response => response.ok ? response.json() as Promise<T> : Promise.reject(new Error(path)));

/** Elevation (m) for the smallest baked raster that covers the map bounds. Resolves null when unavailable. */
export function loadRelief(bounds: ReplayBounds) {
  manifest ??= json<Manifest>("/data/weather-replay/relief/manifest.json").catch(() => null);
  return manifest.then(index => {
    const item = index?.items.filter(({ bounds: b }) => b.west <= bounds.west + .01 && b.east >= bounds.east - .01
      && b.south <= bounds.south + .01 && b.north >= bounds.north - .01)
      .sort((a, b) => (a.bounds.east - a.bounds.west) - (b.bounds.east - b.bounds.west))[0];
    if (!index || !item) return null;
    let request = reliefs.get(item.file);
    if (!request) {
      request = fetch("/data/weather-replay/relief/" + item.file)
        .then(response => response.ok ? response.blob() : Promise.reject(new Error(item.file)))
        .then(blob => createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
        .then(bitmap => {
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return null;
          context.drawImage(bitmap, 0, 0);
          const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
          const data = new Float32Array(bitmap.width * bitmap.height);
          for (let i = 0; i < data.length; i++) data[i] = pixels[i * 4] * 256 + pixels[i * 4 + 1] - 11000;
          return { data, width: bitmap.width, height: bitmap.height, bounds: item.bounds, source: index.source };
        })
        .catch(() => null);
      reliefs.set(item.file, request);
    }
    return request;
  });
}

export function loadPlaces() {
  places ??= json<{ places: [number, number, string, number, number, number][] }>("/data/weather-replay/places.json")
    .then(({ places }) => places.map(([lon, lat, name, rank, population, capital]) => ({ lon, lat, name, rank, population, capital: capital === 1 })))
    .catch(() => []);
  return places;
}

export function loadProvinceLines() {
  type Collection = { features: { geometry: { type: "LineString"; coordinates: Coordinate[] } | { type: "MultiLineString"; coordinates: Coordinate[][] } }[] };
  provinceLines ??= json<Collection>("/data/natural-earth/ne_50m_admin_1_states_provinces_lines.geojson")
    .then(({ features }) => features.flatMap(({ geometry }) => geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates))
    .catch(() => []);
  return provinceLines;
}

/** Elevation in metres, bilinear; 0 outside the raster. */
export function elevationAt(relief: Relief, lon: number, lat: number) {
  const { bounds, width, height, data } = relief;
  const x = (lon - bounds.west) / (bounds.east - bounds.west) * width - .5;
  const y = (bounds.north - lat) / (bounds.north - bounds.south) * height - .5;
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
  const col = Math.min(width - 2, Math.floor(x)), row = Math.min(height - 2, Math.floor(y));
  const u = x - col, v = y - row, i = row * width + col;
  return (data[i] * (1 - u) + data[i + 1] * u) * (1 - v) + (data[i + width] * (1 - u) + data[i + width + 1] * u) * v;
}

export type BasemapStyle = "terrain" | "dark" | "paper" | "slab";

type Palette = { land: (h: number) => [number, number, number]; ocean: (depth: number) => [number, number, number]; shade: [number, number]; seaShade: number };
const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ramp = (stops: readonly (readonly [number, readonly number[]])[], value: number) => {
  const i = stops.findIndex(([at]) => at >= value);
  if (i <= 0) {
    const edge = stops[i < 0 ? stops.length - 1 : 0][1];
    return mix(edge, edge, 0);
  }
  const [a, ca] = stops[i - 1], [b, cb] = stops[i];
  return mix(ca, cb, (value - a) / (b - a));
};

const palettes: Record<BasemapStyle, Palette> = {
  terrain: {
    land: h => ramp([[0, [128, 142, 112]], [300, [146, 152, 118]], [900, [164, 156, 128]], [1800, [184, 176, 160]], [3200, [226, 224, 218]], [9000, [248, 248, 246]]], h),
    ocean: d => ramp([[0, [74, 108, 128]], [200, [52, 82, 106]], [2000, [32, 54, 78]], [6000, [20, 36, 56]]], d),
    shade: [.48, 1.22], seaShade: .35,
  },
  dark: {
    land: h => ramp([[0, [58, 62, 64]], [1500, [66, 68, 70]], [5000, [80, 80, 80]]], h),
    ocean: d => ramp([[0, [34, 38, 42]], [3000, [27, 30, 34]]], d),
    shade: [.62, 1.3], seaShade: .12,
  },
  paper: {
    land: h => ramp([[0, [238, 236, 230]], [2000, [228, 224, 216]], [6000, [220, 216, 208]]], h),
    ocean: d => ramp([[0, [222, 232, 238]], [3000, [210, 222, 232]]], d),
    shade: [.86, 1.06], seaShade: 0,
  },
  slab: {
    land: h => ramp([[0, [232, 228, 214]], [600, [236, 232, 218]], [2000, [242, 239, 230]], [5000, [250, 249, 246]]], h),
    ocean: d => ramp([[0, [184, 196, 206]], [1500, [170, 184, 197]], [6000, [158, 174, 189]]], d),
    shade: [.6, 1.14], seaShade: .2,
  },
};

/** Lambertian hillshade from the northwest, sampled on the relief grid. */
function hillshade(relief: Relief, exaggeration: number) {
  const { data, width, height, bounds } = relief;
  const shade = new Float32Array(data.length);
  const metresX = (bounds.east - bounds.west) / width * 111_320 * Math.cos((bounds.north + bounds.south) * Math.PI / 360);
  const metresY = (bounds.north - bounds.south) / height * 110_574;
  const azimuth = 315 * Math.PI / 180, altitude = 42 * Math.PI / 180;
  const lx = Math.sin(azimuth) * Math.cos(altitude), ly = Math.cos(azimuth) * Math.cos(altitude), lz = Math.sin(altitude);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (i: number, j: number) => Math.max(-200, data[Math.min(height - 1, Math.max(0, j)) * width + Math.min(width - 1, Math.max(0, i))]);
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * metresX) * exaggeration;
      const dy = (at(x, y - 1) - at(x, y + 1)) / (2 * metresY) * exaggeration;
      const length = Math.hypot(dx, dy, 1);
      shade[y * width + x] = Math.max(0, (-dx * lx - dy * ly + lz) / length) / lz;
    }
  }
  return shade;
}
const shades = new WeakMap<Relief, Float32Array>();

function landMask(polygons: Polygons, bounds: ReplayBounds, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const x = (lon: number) => (lon - bounds.west) / (bounds.east - bounds.west) * width;
  const y = (lat: number) => (bounds.north - lat) / (bounds.north - bounds.south) * height;
  context.fillStyle = "#fff";
  for (const polygon of polygons) {
    context.beginPath();
    for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => i ? context.lineTo(x(lon), y(lat)) : context.moveTo(x(lon), y(lat)));
      context.closePath();
    }
    context.fill("evenodd");
  }
  return context.getImageData(0, 0, width, height).data;
}

/**
 * Paint land and sea for an equirectangular image of `bounds`. Land comes from the country polygons;
 * relief only shades and tints it, so coastlines stay exact even where the DEM is coarse.
 */
export function paintBasemap(width: number, height: number, bounds: ReplayBounds, style: BasemapStyle,
  polygons: Polygons, relief: Relief | null, exaggeration = 6) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const palette = palettes[style];
  const mask = landMask(polygons, bounds, width, height);
  let shade = relief ? shades.get(relief) : undefined;
  if (relief && !shade) shades.set(relief, shade = hillshade(relief, exaggeration));
  const image = context.createImageData(width, height);
  const [dark, light] = palette.shade;
  for (let py = 0; py < height; py++) {
    const lat = bounds.north - (py + .5) / height * (bounds.north - bounds.south);
    for (let px = 0; px < width; px++) {
      const lon = bounds.west + (px + .5) / width * (bounds.east - bounds.west);
      const i = py * width + px;
      const land = mask ? mask[i * 4 + 3] / 255 : 0;
      let h = 0, s = 1;
      if (relief && shade) {
        h = elevationAt(relief, lon, lat);
        const rx = Math.min(relief.width - 1, Math.max(0, Math.floor((lon - relief.bounds.west) / (relief.bounds.east - relief.bounds.west) * relief.width)));
        const ry = Math.min(relief.height - 1, Math.max(0, Math.floor((relief.bounds.north - lat) / (relief.bounds.north - relief.bounds.south) * relief.height)));
        s = shade[ry * relief.width + rx];
      }
      const shaded = dark + (light - dark) * Math.min(1.25, s) / 1.25;
      const ground = palette.land(Math.max(0, h)).map(c => c * shaded);
      const seaShade = 1 + (shaded - 1) * palette.seaShade;
      const sea = palette.ocean(Math.max(0, -h)).map(c => c * seaShade);
      const color = mix(sea, ground, land);
      image.data[i * 4] = color[0];
      image.data[i * 4 + 1] = color[1];
      image.data[i * 4 + 2] = color[2];
      image.data[i * 4 + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Stroke polygon rings or polylines through a lon/lat → pixel transform. */
export function traceRings(context: CanvasRenderingContext2D, rings: readonly (readonly Coordinate[])[], point: (lon: number, lat: number) => [number, number], close: boolean) {
  context.beginPath();
  for (const ring of rings) {
    if (ring.length < 2) continue;
    let previous: [number, number] | undefined;
    for (const [lon, lat] of ring) {
      const p = point(lon, lat);
      if (!previous) context.moveTo(p[0], p[1]);
      else if (Math.abs(p[0] - previous[0]) + Math.abs(p[1] - previous[1]) > .35) context.lineTo(p[0], p[1]);
      else continue;
      previous = p;
    }
    if (close) context.closePath();
  }
}

export function clipLines(lines: Lines, bounds: ReplayBounds) {
  const inside = ([lon, lat]: Coordinate) => lon >= bounds.west - 1 && lon <= bounds.east + 1 && lat >= bounds.south - 1 && lat <= bounds.north + 1;
  return lines.filter(line => line.some(inside));
}

/** Pick legible place labels with simple collision avoidance in screen space. */
export function choosePlaces(all: readonly Place[], bounds: ReplayBounds, point: (lon: number, lat: number) => [number, number],
  maxCount: number, spacing: number, avoid: readonly [number, number, number][] = []) {
  const chosen: (Place & { x: number; y: number })[] = [];
  for (const place of all) {
    if (place.lon < bounds.west || place.lon > bounds.east || place.lat < bounds.south || place.lat > bounds.north) continue;
    const [x, y] = point(place.lon, place.lat);
    if (chosen.some(other => Math.abs(other.x - x) < spacing * 1.6 && Math.abs(other.y - y) < spacing * .7)) continue;
    if (avoid.some(([ax, ay, r]) => Math.hypot(ax - x, ay - y) < r)) continue;
    chosen.push({ ...place, x, y });
    if (chosen.length >= maxCount) break;
  }
  return chosen;
}
