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

export function rainColor(rate: number, limit: number) {
  return scaleColor(rainScale, rate / limit * rainScale[rainScale.length - 1][0]);
}

type Grid = readonly (number | null)[];
export type ReplayTextureLayer = "rain" | "infrared" | "cloudCover";
const images = new WeakMap<Grid, { image: HTMLCanvasElement; layer: ReplayTextureLayer; limit: number }>();

export function replayTexture(values: Grid, cols: number, rows: number, layer: ReplayTextureLayer, limit = 75) {
  const saved = images.get(values);
  if (saved?.image.width === cols && saved.image.height === rows && saved.layer === layer && saved.limit === limit) return saved.image;
  const image = document.createElement("canvas");
  image.width = cols;
  image.height = rows;
  const painter = image.getContext("2d");
  if (!painter) return image;
  const pixels = painter.createImageData(cols, rows);
  values.forEach((value, index) => {
    if (value == null) return;
    const offset = 4 * index;
    if (layer === "rain") {
      if (value < .2) return;
      pixels.data.set(rainColor(value, limit), offset);
      pixels.data[offset + 3] = 255;
      return;
    }
    // GFS reports total cloud cover in percent. The satellite archive uses brightness temperature.
    const intensity = layer === "cloudCover" ? (value - 38) / 62 : (278 - value) / 76;
    if (intensity <= 0) return;
    const strength = Math.min(1, intensity);
    pixels.data.set([176 - strength * 90, 193 - strength * 82, 207 - strength * 68], offset);
    pixels.data[offset + 3] = Math.round(100 + 149 * strength);
  });
  painter.putImageData(pixels, 0, 0);
  images.set(values, { image, layer, limit });
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
