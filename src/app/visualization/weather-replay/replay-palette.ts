export const rainScale = [
  [0, [30, 117, 181]], [1, [31, 163, 227]], [5, [32, 201, 182]],
  [15, [145, 219, 125]], [30, [251, 218, 95]], [50, [251, 131, 62]], [75, [231, 55, 81]],
] as const;

export const accumulationScale = [
  [0, [25, 111, 177]], [.1, [32, 165, 228]], [.28, [34, 202, 179]],
  [.48, [158, 221, 115]], [.66, [252, 220, 99]], [.83, [250, 134, 69]], [1, [231, 56, 83]],
] as const;

type Scale = readonly (readonly [number, readonly [number, number, number]])[];

export function scaleColor(scale: Scale, value: number) {
  const index = scale.findIndex(stop => stop[0] >= value);
  if (index === -1) return scale[scale.length - 1][1];
  if (index === 0) return scale[0][1];
  const [low, a] = scale[index - 1];
  const [high, b] = scale[index];
  const fraction = (value - low) / (high - low);
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * fraction));
}

export function visibleRain(value: number) {
  return Math.max(0, Math.min(1, Math.log1p(value) / Math.log(76)));
}

type Grid = readonly (number | null)[];
const rainImages = new WeakMap<Grid, HTMLCanvasElement>();
const cloudImages = new WeakMap<Grid, HTMLCanvasElement>();

export function replayTexture(values: Grid, cols: number, rows: number, clouds: boolean) {
  const cache = clouds ? cloudImages : rainImages;
  const saved = cache.get(values);
  if (saved?.width === cols && saved.height === rows) return saved;
  const image = document.createElement("canvas");
  image.width = cols;
  image.height = rows;
  const painter = image.getContext("2d");
  if (!painter) return image;
  const pixels = painter.createImageData(cols, rows);
  values.forEach((value, index) => {
    if (value == null || (clouds ? value >= 278 : value < .2)) return;
    const offset = 4 * index;
    const cold = Math.min(1, (278 - value) / 76);
    const color = clouds ? [115 + cold * 87, 123 + cold * 85, 226 + cold * 21] : scaleColor(rainScale, value);
    pixels.data.set(color, offset);
    pixels.data[offset + 3] = clouds ? Math.round(145 * cold) : Math.round(60 + visibleRain(value) * 190);
  });
  painter.putImageData(pixels, 0, 0);
  cache.set(values, image);
  return image;
}

export function smoothAccumulation(values: Grid, cols: number, rows: number) {
  return values.map((value, index) => {
    if (value == null || value === 0) return value;
    const x = index % cols;
    const y = Math.floor(index / cols);
    let sum = value * 4;
    let weight = 4;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= cols || y + dy < 0 || y + dy >= rows) continue;
        const neighbor = values[index + dy * cols + dx];
        if (neighbor == null) continue;
        sum += neighbor;
        weight++;
      }
    }
    return sum / weight;
  });
}
