import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import type { ReplayBounds, WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayArea } from "./replay-geography";

export type Grid = readonly (number | null)[];
type RGB = readonly [number, number, number];
type Palette = readonly (readonly [number, RGB])[];

export const precipitationPalette: Palette = [
  [0, [34, 68, 107]],
  [0.22, [55, 110, 156]],
  [0.48, [66, 166, 185]],
  [0.73, [118, 210, 196]],
  [1, [198, 231, 215]],
];

export const accumulationPalette: Palette = [
  [0, [30, 57, 108]],
  [0.25, [43, 111, 165]],
  [0.55, [58, 163, 186]],
  [0.78, [113, 205, 198]],
  [1, [193, 235, 222]],
];

export const clamp = (value: number) => Math.min(1, Math.max(0, value));
export const rainStrength = (rate: number) => Math.sqrt(clamp(rate / 75));

export function paletteColor(stops: Palette, value: number): RGB {
  const amount = clamp(value);
  const upper = stops.findIndex(([threshold]) => amount <= threshold);
  if (upper <= 0) return stops[0][1];
  const [a, low] = stops[upper - 1];
  const [b, high] = stops[upper];
  const t = (amount - a) / (b - a);
  return [
    Math.round(low[0] + (high[0] - low[0]) * t),
    Math.round(low[1] + (high[1] - low[1]) * t),
    Math.round(low[2] + (high[2] - low[2]) * t),
  ];
}

function drawingSurface(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Weather texture canvas unavailable");
  return { canvas, context };
}

function canvasTexture(canvas: HTMLCanvasElement, color = true) {
  const texture = new CanvasTexture(canvas);
  if (color) texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export function geographicTexture(area: ReplayArea, bounds: ReplayBounds, mask = false) {
  const { south, north, west, east } = bounds;
  const { canvas, context } = drawingSurface(1024, 1024);
  const x = (lon: number) => (lon - west) / (east - west) * canvas.width;
  const y = (lat: number) => (north - lat) / (north - south) * canvas.height;
  context.beginPath();
  for (const ring of area.rings) {
    context.moveTo(x(ring[0][0]), y(ring[0][1]));
    for (const [lon, lat] of ring.slice(1)) context.lineTo(x(lon), y(lat));
    context.closePath();
  }
  if (mask) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
  } else {
    const light = context.createLinearGradient(0, 0, canvas.width * 0.32, canvas.height);
    light.addColorStop(0, "#96bac9");
    light.addColorStop(0.55, "#709caf");
    light.addColorStop(1, "#486f88");
    context.fillStyle = light;
  }
  context.fill("evenodd");
  return canvasTexture(canvas, !mask);
}

/** Texture edges are half a cell beyond the first and last sample centers. */
export function textureBounds(replay: WeatherReplay): ReplayBounds {
  const { south, north, west, east } = replay.bounds;
  const dx = (east - west) / (replay.cols - 1) / 2;
  const dy = (north - south) / (replay.rows - 1) / 2;
  return { west: west - dx, east: east + dx, south: south - dy, north: north + dy };
}

export function fieldTexture(replay: WeatherReplay, values: Grid, kind: "cloud" | "rain") {
  const { rows, cols } = replay;
  const { canvas, context } = drawingSurface(cols, rows);
  const image = context.createImageData(cols, rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const value = values[(rows - row - 1) * cols + col];
      if (value == null) continue;
      const i = (row * cols + col) * 4;
      if (kind === "cloud") {
        // Infrared brightness temperature is rendered as a cool cloud texture.
        const intensity = clamp((286 - value) / 77);
        image.data[i] = 111 + intensity * 116;
        image.data[i + 1] = 145 + intensity * 91;
        image.data[i + 2] = 183 + intensity * 64;
        const edge = Math.min(1, (Math.min(row, col, rows - 1 - row, cols - 1 - col) + 0.3) / 2);
        image.data[i + 3] = Math.round(216 * Math.pow(intensity, 1.45) * edge);
      } else {
        const strength = rainStrength(value);
        const [r, g, b] = paletteColor(precipitationPalette, strength);
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = Math.round(227 * Math.min(1, strength * 1.72));
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvasTexture(canvas);
}
