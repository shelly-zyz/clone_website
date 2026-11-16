export const rainScale = [
  [0, [247, 224, 175]], [1, [246, 193, 128]], [5, [237, 151, 78]],
  [15, [218, 83, 48]], [30, [184, 44, 33]], [50, [144, 22, 26]], [75, [97, 13, 20]],
] as const;

export const accumulationScale = [
  [0, [247, 224, 175]], [.10, [246, 193, 128]], [.28, [237, 151, 78]],
  [.48, [218, 83, 48]], [.66, [184, 44, 33]], [.83, [144, 22, 26]], [1, [97, 13, 20]],
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
    const color = clouds ? [176 - cold * 90, 193 - cold * 82, 207 - cold * 68] : scaleColor(rainScale, value);
    pixels.data.set(color, offset);
    pixels.data[offset + 3] = clouds ? Math.round(100 + 149 * cold) : 255;
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
