import type { WeatherReplay } from "@/lib/weather-replay/model";

export const utcClock = (iso: string) => iso.slice(11, 16);
export const utcStamp = (iso: string) => iso.slice(5, 10) + " " + utcClock(iso);
export type Grid = readonly (number | null)[];
export type Point = [number, number];

export function rainCadence(replay: WeatherReplay) {
  return (replay.metadata?.stepMinutes ?? 15) * 60_000;
}

/** Integrate rates in mm/h, propagating gaps and missing values inside the chosen window. */
export function accumulateRain(replay: WeatherReplay, start = 0) {
  const step = rainCadence(replay);
  return replay.rain.slice(start).reduce<(number | null)[][]>((grids, frame, offset) => {
    const previous = replay.rain[start + offset - 1];
    const consecutive = offset > 0 && Date.parse(frame.time) - Date.parse(previous.time) === step;
    const last = grids.at(-1);
    grids.push(frame.values.map((current, cell) => {
      if (offset === 0) return current == null ? null : 0;
      const before = previous.values[cell];
      const total = last?.[cell];
      return !consecutive || total == null || before == null || current == null
        ? null : total + (before + current) * step / 7_200_000;
    }));
    return grids;
  }, []);
}

/** Bound every valid accumulation window using the longest observed run in each cell. */
export function maxContinuousAccumulation(replay: WeatherReplay) {
  const step = rainCadence(replay);
  const totals = new Float64Array(replay.cols * replay.rows);
  let peak = 0;
  for (let i = 1; i < replay.rain.length; i++) {
    const prior = replay.rain[i - 1], frame = replay.rain[i];
    const consecutive = Date.parse(frame.time) - Date.parse(prior.time) === step;
    frame.values.forEach((current, cell) => {
      const before = prior.values[cell];
      totals[cell] = consecutive && current != null && before != null
        ? totals[cell] + (before + current) * step / 7_200_000 : 0;
      peak = Math.max(peak, totals[cell]);
    });
  }
  return peak;
}

export function accumulationStart(replay: WeatherReplay, index: number, hours: number) {
  if (hours === 0) return 0;
  const elapsed = Date.parse(replay.rain[index].time) - hours * 3_600_000;
  const start = replay.rain.findIndex(frame => Date.parse(frame.time) === elapsed);
  if (start < 0) return undefined;
  for (let i = start + 1; i <= index; i++) {
    if (Date.parse(replay.rain[i].time) - Date.parse(replay.rain[i - 1].time) !== rainCadence(replay)) return undefined;
  }
  return start;
}

export function satelliteAt(replay: WeatherReplay, time: string) {
  const frame = replay.satellite.findLast(item => item.time <= time);
  const tolerance = Math.max(60 * 60_000, rainCadence(replay));
  return frame && Date.parse(time) - Date.parse(frame.time) < tolerance ? frame : undefined;
}

/** Show up to five archive slices. The selected instant always has a plane. */
export function stackFrameIndices(replay: WeatherReplay, index: number) {
  const last = replay.rain.length - 1;
  if (last < 5) return replay.rain.map((_, frame) => frame);
  const frames = new Set([index]);
  for (let slice = 0; slice < 4; slice++) frames.add(Math.round(slice * last / 3));
  return [...frames].sort((a, b) => a - b);
}

export function cellPosition(replay: WeatherReplay, cell: number): Point {
  return [(cell % replay.cols) / (replay.cols - 1), Math.floor(cell / replay.cols) / (replay.rows - 1)];
}

export function cellAreas(replay: WeatherReplay) {
  const { bounds, rows, cols } = replay;
  const rad = Math.PI / 180;
  const lon = (bounds.east - bounds.west) * rad / (cols - 1);
  const lat = (bounds.north - bounds.south) * rad / (rows - 1);
  return Array.from({ length: rows * cols }, (_, cell) => {
    const row = Math.floor(cell / cols);
    const col = cell % cols;
    const center = bounds.south * rad + row * lat;
    const south = center - (row === 0 ? 0 : lat / 2);
    const north = center + (row === rows - 1 ? 0 : lat / 2);
    return 6371 ** 2 * lon * (Math.sin(north) - Math.sin(south)) * (col === 0 || col === cols - 1 ? .5 : 1);
  });
}

export function areaStats(values: Grid, weights: readonly number[], thresholds: readonly number[] = []) {
  let coverage = 0, total = 0, peakCell: number | undefined;
  const above = thresholds.map(() => 0);
  values.forEach((value, cell) => {
    if (value == null) return;
    const weight = weights[cell];
    coverage += weight;
    total += value * weight;
    if (peakCell === undefined || value > (values[peakCell] ?? 0)) peakCell = cell;
    thresholds.forEach((threshold, i) => { if (value >= threshold) above[i] += weight; });
  });
  return { coverage, above, mean: coverage ? total / coverage : null, peakCell };
}

export type Hotspot = {
  id: number;
  frame: number;
  cells: number[];
  center: Point;
  peak: number;
  area: number;
};

function hotspots(replay: WeatherReplay, frame: number, weights: readonly number[], threshold: number) {
  const { cols, rows } = replay;
  const values = replay.rain[frame].values;
  const marked = new Uint8Array(values.length);
  const regions: Hotspot[] = [];
  values.forEach((value, first) => {
    if (value == null || value < threshold || marked[first]) return;
    const cells = [first];
    const center: Point = [0, 0];
    let peak = value, area = 0, mass = 0;
    marked[first] = 1;
    for (const cell of cells) {
      const rate = values[cell] ?? 0;
      const weight = weights[cell];
      const position = cellPosition(replay, cell);
      peak = Math.max(peak, rate);
      area += weight;
      mass += rate * weight;
      center[0] += position[0] * rate * weight;
      center[1] += position[1] * rate * weight;
      const col = cell % cols, row = Math.floor(cell / cols);
      const neighbors = [col > 0 ? cell - 1 : -1, col < cols - 1 ? cell + 1 : -1,
        row > 0 ? cell - cols : -1, row < rows - 1 ? cell + cols : -1];
      for (const next of neighbors) {
        if (next < 0 || marked[next] || (values[next] ?? 0) < threshold) continue;
        marked[next] = 1;
        cells.push(next);
      }
    }
    regions.push({ id: 0, frame, cells, center: [center[0] / mass, center[1] / mass], peak, area });
  });
  return regions.sort((a, b) => b.peak - a.peak);
}

export function displacement(replay: WeatherReplay, from: Point, to: Point): Point {
  const { bounds } = replay;
  const lat = bounds.south + (from[1] + to[1]) / 2 * (bounds.north - bounds.south);
  return [(to[0] - from[0]) * (bounds.east - bounds.west) * 111.195 * Math.cos(lat * Math.PI / 180),
    (to[1] - from[1]) * (bounds.north - bounds.south) * 111.195];
}

/** Link mutual best matches with overlap or a bounded center displacement. Gaps break tracks. */
export function trackHotspots(replay: WeatherReplay, weights: readonly number[], threshold: number) {
  const tracks = new Map<number, Hotspot[]>();
  const frames: Hotspot[][] = [];
  for (const [index, frame] of replay.rain.entries()) {
    const current = hotspots(replay, index, weights, threshold);
    const prior = replay.rain[index - 1];
    const interval = prior ? Date.parse(frame.time) - Date.parse(prior.time) : 0;
    const previous = interval === rainCadence(replay) ? frames[index - 1] : [];
    const membership = new Map(previous.flatMap((spot, i) => spot.cells.map(cell => [cell, i] as const)));
    const bestFrom = new Map<number, { other: number; score: number }>();
    const bestTo = new Map<number, { other: number; score: number }>();
    current.forEach((spot, to) => {
      const overlaps = new Map<number, number>();
      for (const cell of spot.cells) {
        const from = membership.get(cell);
        if (from !== undefined) overlaps.set(from, (overlaps.get(from) ?? 0) + 1);
      }
      previous.forEach((old, from) => {
        const distance = Math.hypot(...displacement(replay, old.center, spot.center));
        const maxDistance = 120 * interval / 3_600_000 + 25;
        const overlap = (overlaps.get(from) ?? 0) / Math.min(old.cells.length, spot.cells.length);
        if (distance > maxDistance || (overlap === 0 && Math.min(old.area, spot.area) / Math.max(old.area, spot.area) < .33)) return;
        const score = overlap * 2 + 1 - distance / maxDistance;
        if (score > (bestFrom.get(from)?.score ?? 0)) bestFrom.set(from, { other: to, score });
        if (score > (bestTo.get(to)?.score ?? 0)) bestTo.set(to, { other: from, score });
      });
    });
    current.forEach((spot, to) => {
      const from = bestTo.get(to)?.other;
      spot.id = from !== undefined && bestFrom.get(from)?.other === to ? previous[from].id : tracks.size + 1;
      const track = tracks.get(spot.id) ?? [];
      track.push(spot);
      tracks.set(spot.id, track);
    });
    frames.push(current);
  }
  return { frames, tracks };
}

/** Interpolate isolines only across squares with four valid samples. */
export function contourSegments(values: Grid, cols: number, rows: number, level: number): [Point, Point][] {
  const segments: [Point, Point][] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const offset = row * cols + col;
      const indices = [offset, offset + 1, offset + cols + 1, offset + cols];
      const corners = indices.map(i => values[i]);
      if (corners.some(value => value == null)) continue;
      const amounts = corners as number[];
      const edges: Point[] = [];
      for (let a = 0; a < 4; a++) {
        const b = (a + 1) % 4;
        if ((amounts[a] >= level) === (amounts[b] >= level)) continue;
        const t = (level - amounts[a]) / (amounts[b] - amounts[a]);
        const x = indices[a] % cols, y = Math.floor(indices[a] / cols);
        edges.push([(x + (indices[b] % cols - x) * t) / (cols - 1),
          (y + (Math.floor(indices[b] / cols) - y) * t) / (rows - 1)]);
      }
      if (edges.length === 2) segments.push([edges[0], edges[1]]);
      if (edges.length === 4) {
        const centerHigh = amounts.reduce((sum, value) => sum + value, 0) / 4 >= level;
        const shift = centerHigh === (amounts[0] >= level) ? 0 : 1;
        segments.push([edges[shift], edges[shift + 1]], [edges[shift + 2], edges[(shift + 3) % 4]]);
      }
    }
  }
  return segments;
}
