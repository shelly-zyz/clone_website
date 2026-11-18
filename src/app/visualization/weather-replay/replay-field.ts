/** Continuous sampling of the replay grids. Grid row 0 is the southern edge. */

export type Grid = readonly (number | null)[];

export type Field = {
  data: Float32Array;
  width: number;
  height: number;
  /** Samples per source cell along each axis. */
  factor: number;
};

function catmullRom(a: number, b: number, c: number, d: number, t: number) {
  return b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

/**
 * Upsample a grid with Catmull-Rom interpolation. Missing cells stay missing (NaN):
 * a sample is only produced where its four surrounding source cells are valid, and missing
 * outer neighbours fall back to the nearer valid value instead of inventing data.
 */
export function upsample(values: Grid, cols: number, rows: number, factor: number, floor = 0): Field {
  const width = (cols - 1) * factor + 1;
  const height = (rows - 1) * factor + 1;
  const data = new Float32Array(width * height);
  const at = (col: number, row: number, fallback: number) => {
    const value = values[Math.min(rows - 1, Math.max(0, row)) * cols + Math.min(cols - 1, Math.max(0, col))];
    return value ?? fallback;
  };
  const column = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    const gy = y / factor;
    const row = Math.min(rows - 2, Math.floor(gy));
    const ty = gy - row;
    for (let x = 0; x < width; x++) {
      const gx = x / factor;
      const col = Math.min(cols - 2, Math.floor(gx));
      const tx = gx - col;
      const a = values[row * cols + col], b = values[row * cols + col + 1];
      const c = values[(row + 1) * cols + col], d = values[(row + 1) * cols + col + 1];
      if (a == null || b == null || c == null || d == null) {
        data[y * width + x] = NaN;
        continue;
      }
      for (let j = -1; j <= 2; j++) {
        const r = row + j;
        const near1 = at(col, r, j <= 0 ? a : c), near2 = at(col + 1, r, j <= 0 ? b : d);
        column[j + 1] = catmullRom(at(col - 1, r, near1), near1, near2, at(col + 2, r, near2), tx);
      }
      data[y * width + x] = Math.max(floor, catmullRom(column[0], column[1], column[2], column[3], ty));
    }
  }
  return { data, width, height, factor };
}

/** Separable box blur repeated three times (close to Gaussian). NaN samples are skipped. */
export function blurField(field: Field, radius: number): Field {
  if (radius < 1) return field;
  const { width, height } = field;
  let source = field.data;
  const pass = (input: Float32Array, horizontal: boolean) => {
    const output = new Float32Array(input.length);
    const outer = horizontal ? height : width, inner = horizontal ? width : height;
    for (let o = 0; o < outer; o++) {
      for (let i = 0; i < inner; i++) {
        const index = horizontal ? o * width + i : i * width + o;
        if (Number.isNaN(input[index])) { output[index] = NaN; continue; }
        let sum = 0, count = 0;
        for (let k = Math.max(0, i - radius); k <= Math.min(inner - 1, i + radius); k++) {
          const value = input[horizontal ? o * width + k : k * width + o];
          if (Number.isNaN(value)) continue;
          sum += value;
          count++;
        }
        output[index] = sum / count;
      }
    }
    return output;
  };
  for (let n = 0; n < 2; n++) source = pass(pass(source, true), false);
  return { ...field, data: source };
}

export type Segment = [x1: number, y1: number, x2: number, y2: number];

/** Marching-squares isolines in field pixel coordinates. Squares with missing corners are skipped. */
export function isolines(field: Field, level: number): Segment[] {
  const { data, width, height } = field;
  const segments: Segment[] = [];
  const edge = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): [number, number] => {
    const t = (level - v0) / (v1 - v0);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = data[y * width + x], b = data[y * width + x + 1];
      const c = data[(y + 1) * width + x + 1], d = data[(y + 1) * width + x];
      if (Number.isNaN(a + b + c + d)) continue;
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => edge(x, y, a, x + 1, y, b);
      const right = () => edge(x + 1, y, b, x + 1, y + 1, c);
      const bottom = () => edge(x, y + 1, d, x + 1, y + 1, c);
      const left = () => edge(x, y, a, x, y + 1, d);
      const add = (p: [number, number], q: [number, number]) => segments.push([p[0], p[1], q[0], q[1]]);
      switch (code) {
        case 1: case 14: add(left(), top()); break;
        case 2: case 13: add(top(), right()); break;
        case 3: case 12: add(left(), right()); break;
        case 4: case 11: add(right(), bottom()); break;
        case 6: case 9: add(top(), bottom()); break;
        case 7: case 8: add(left(), bottom()); break;
        case 5: case 10: {
          const center = (a + b + c + d) / 4 >= level;
          if ((code === 5) === center) { add(left(), bottom()); add(top(), right()); }
          else { add(left(), top()); add(right(), bottom()); }
          break;
        }
      }
    }
  }
  return segments;
}

/** Join unordered segments into polylines so labels and smooth strokes follow whole contours. */
export function joinSegments(segments: Segment[]) {
  const key = (x: number, y: number) => Math.round(x * 64) + "," + Math.round(y * 64);
  const ends = new Map<string, number[]>();
  segments.forEach(([x1, y1, x2, y2], i) => {
    for (const k of [key(x1, y1), key(x2, y2)]) {
      const list = ends.get(k);
      if (list) list.push(i); else ends.set(k, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines: [number, number][][] = [];
  const extend = (line: [number, number][], forward: boolean) => {
    for (;;) {
      const [x, y] = forward ? line[line.length - 1] : line[0];
      const next = ends.get(key(x, y))?.find(i => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [x1, y1, x2, y2] = segments[next];
      const point: [number, number] = key(x1, y1) === key(x, y) ? [x2, y2] : [x1, y1];
      if (forward) line.push(point); else line.unshift(point);
    }
  };
  segments.forEach(([x1, y1, x2, y2], i) => {
    if (used[i]) return;
    used[i] = 1;
    const line: [number, number][] = [[x1, y1], [x2, y2]];
    extend(line, true);
    extend(line, false);
    lines.push(line);
  });
  return lines;
}

/** Local maxima above `minimum`, separated by at least `spacing` field pixels. */
export function localMaxima(field: Field, minimum: number, spacing: number, limit = 8) {
  const { data, width, height } = field;
  const peaks: { x: number; y: number; value: number }[] = [];
  const r = Math.max(2, Math.round(spacing / 2));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const value = data[y * width + x];
      if (!(value >= minimum)) continue;
      let top = true;
      for (let j = -r; j <= r && top; j++) {
        for (let i = -r; i <= r; i++) {
          const yy = y + j, xx = x + i;
          if (yy < 0 || xx < 0 || yy >= height || xx >= width || (i === 0 && j === 0)) continue;
          if (data[yy * width + xx] > value) { top = false; break; }
        }
      }
      if (top) peaks.push({ x, y, value });
    }
  }
  peaks.sort((a, b) => b.value - a.value);
  const kept: typeof peaks = [];
  for (const peak of peaks) {
    if (kept.every(other => Math.hypot(other.x - peak.x, other.y - peak.y) >= spacing)) kept.push(peak);
    if (kept.length >= limit) break;
  }
  return kept;
}
