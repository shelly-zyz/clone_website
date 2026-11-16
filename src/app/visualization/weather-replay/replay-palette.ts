const precipitationColors = [
  [0, [109, 137, 129]], [.025, [145, 148, 180]], [.075, [178, 150, 188]],
  [.18, [212, 137, 166]], [.38, [243, 145, 152]], [.65, [255, 169, 151]], [1, [255, 212, 180]],
] as const;

export const rainScale = precipitationColors;
export const accumulationScale = precipitationColors;

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
const rainImages = new WeakMap<Grid, { image: HTMLCanvasElement; limit: number }>();

export function replayTexture(values: Grid, cols: number, rows: number, limit: number) {
  const saved = rainImages.get(values);
  if (saved?.image.width === cols && saved.image.height === rows && saved.limit === limit) return saved.image;
  const image = document.createElement("canvas");
  image.width = cols;
  image.height = rows;
  const painter = image.getContext("2d");
  if (!painter) return image;
  const pixels = painter.createImageData(cols, rows);
  values.forEach((value, index) => {
    if (value == null || value < .2) return;
    const offset = 4 * index;
    const intensity = Math.min(1, Math.sqrt(value / limit));
    pixels.data.set(scaleColor(rainScale, value / limit), offset);
    pixels.data[offset + 3] = Math.round(100 + 155 * intensity);
  });
  painter.putImageData(pixels, 0, 0);
  rainImages.set(values, { image, limit });
  return image;
}

const puffs = new Map<string, HTMLCanvasElement>();

export function volumeSprite(colors: readonly string[]) {
  const key = colors.join("|");
  const cached = puffs.get(key);
  if (cached) return cached;
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 64;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;
  const fade = ctx.createRadialGradient(29, 26, 3, 32, 32, 31);
  colors.forEach((color, i) => fade.addColorStop(i / (colors.length - 1), color));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 64, 64);
  puffs.set(key, sprite);
  return sprite;
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
