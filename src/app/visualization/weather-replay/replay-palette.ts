export const rainScale = [
  [0, [247, 224, 175]], [1, [246, 193, 128]], [5, [237, 151, 78]],
  [15, [218, 83, 48]], [30, [184, 44, 33]], [50, [144, 22, 26]], [75, [97, 13, 20]],
] as const;

export const accumulationScale = [
  [0, [48, 116, 167]], [.10, [46, 165, 204]], [.28, [69, 212, 189]],
  [.48, [181, 224, 133]], [.66, [255, 216, 118]], [.83, [251, 153, 99]], [1, [244, 102, 135]],
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
export type ReplayTextureLayer = "rain" | "accumulation" | "infrared" | "cloudCover";
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
    if (layer === "rain" || layer === "accumulation") {
      if (value < (layer === "rain" ? .2 : .05)) return;
      pixels.data.set(layer === "rain" ? rainColor(value, limit) : scaleColor(accumulationScale, value / limit), offset);
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
