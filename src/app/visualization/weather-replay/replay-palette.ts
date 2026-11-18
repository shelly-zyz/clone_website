import type { ReplayView } from "@/lib/weather-replay/views";

export type RGB = readonly [number, number, number];
/** Stops are [position, colour]. Positions are 0–1 for relative scales and mm/h for the radar scale. */
export type Scale = readonly (readonly [number, RGB])[];

/** Cloud–rain volume: spectral blue → red, after the GPM/DPR precipitation-rate convention. */
export const volumeScale: Scale = [
  [0, [24, 44, 176]], [.12, [28, 92, 236]], [.28, [34, 170, 246]], [.44, [48, 214, 170]],
  [.6, [168, 230, 74]], [.74, [252, 222, 48]], [.87, [250, 138, 32]], [1, [214, 26, 30]],
];

/** Radar reflectivity style classes, in mm/h. */
export const radarScale: Scale = [
  [.2, [168, 228, 150]], [1, [104, 200, 96]], [2.5, [44, 158, 66]], [5, [20, 116, 50]],
  [8, [246, 230, 82]], [12, [244, 186, 62]], [18, [238, 128, 44]], [25, [216, 52, 40]],
  [40, [168, 22, 40]], [60, [186, 44, 162]], [90, [238, 170, 240]],
];

/** Rain painted on light slabs: pale teal → ultramarine → plum keeps contrast on white. */
export const stackScale: Scale = [
  [0, [126, 208, 214]], [.16, [72, 180, 212]], [.36, [40, 128, 204]], [.56, [44, 74, 184]],
  [.78, [96, 50, 158]], [1, [158, 28, 110]],
];

/** Discrete isohyet fills, light cyan through blue, green, yellow, red and magenta. */
const bandColors: RGB[] = [
  [214, 246, 250], [158, 228, 246], [92, 196, 240], [48, 146, 226], [36, 98, 196],
  [64, 178, 80], [30, 132, 58], [244, 228, 80], [248, 184, 58], [238, 122, 40],
  [222, 52, 44], [168, 26, 44], [196, 60, 180], [238, 164, 236],
];

export function accumulationLevels(limit: number) {
  const ladder = limit >= 150 ? [1, 5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 700]
    : limit >= 40 ? [1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150]
      : [.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40];
  const end = ladder.findIndex(level => level >= limit);
  return ladder.slice(0, end < 0 ? ladder.length : end + 1);
}

/** Colour for each band [levels[i], levels[i + 1]); spread across the palette so small ladders stay distinct. */
export function bandPalette(levels: readonly number[]) {
  const count = levels.length;
  return levels.map((_, i) => bandColors[Math.round(i * (bandColors.length - 1) / Math.max(1, count - 1))]);
}

export function bandIndex(levels: readonly number[], value: number) {
  let index = -1;
  for (let i = 0; i < levels.length && value >= levels[i]; i++) index = i;
  return index;
}

export function scaleColor(scale: Scale, value: number): RGB {
  const index = scale.findIndex(stop => stop[0] >= value);
  if (index === -1) return scale[scale.length - 1][1];
  if (index === 0) return scale[0][1];
  const [low, a] = scale[index - 1];
  const [high, b] = scale[index];
  const t = (value - low) / (high - low);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 256-entry RGBA lookup for shaders. */
export function scaleLookup(scale: Scale) {
  const lookup = new Uint8Array(256 * 4);
  const low = scale[0][0], high = scale[scale.length - 1][0];
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = scaleColor(scale, low + (high - low) * i / 255);
    lookup.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4);
  }
  return lookup;
}

export const css = ([r, g, b]: RGB, alpha = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;

export type ReplayLegend = {
  title: string;
  unit: string;
  kind: "ramp" | "classes";
  /** Ramp: gradient stops bottom (0) to top (1). Classes: equal-height blocks, bottom first. */
  colors: { at: number; color: string; label?: string }[];
  ends?: [low: string, high: string];
};

const format = (value: number) => Number(value.toPrecision(3)).toString();

export function replayLegend(view: ReplayView, rainLimit: number, accumulationLimit: number): ReplayLegend {
  if (view === "weather") {
    return {
      title: "降水率", unit: "mm/h", kind: "ramp", ends: ["弱", "强"],
      colors: volumeScale.map(([at, color]) => ({ at, color: css(color) })),
    };
  }
  if (view === "rain") {
    return {
      title: "降水强度", unit: "mm/h", kind: "classes",
      colors: radarScale.map(([at, color]) => ({ at, color: css(color), label: format(at) })),
    };
  }
  if (view === "time") {
    return {
      title: "降水率", unit: "mm/h", kind: "ramp", ends: ["0", format(rainLimit)],
      colors: stackScale.map(([at, color]) => ({ at, color: css(color) })),
    };
  }
  const levels = accumulationLevels(accumulationLimit);
  const colors = bandPalette(levels);
  return {
    title: "累计降水", unit: "mm", kind: "classes",
    colors: levels.map((level, i) => ({ at: level, color: css(colors[i]), label: format(level) })),
  };
}
