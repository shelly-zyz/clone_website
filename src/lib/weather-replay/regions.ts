import catalog from "../../../public/data/weather-replay/regional-catalog.json";

export const replayRegions = {
  archive: { label: "西北大西洋 · 卫星档案", land: ["USA", "BHS", "BMU", "CUB"] as const },
  usa: { label: "美国 · 东南沿海覆盖区", land: ["USA"] as const },
  bahamas: { label: "巴哈马 · 档案覆盖区", land: ["BHS"] as const },
  china: { label: "中国东南沿海 · 台风格美", land: ["CHN"] as const },
};

export type ReplayRegionId = string;

export function regionalReplay(region: string) {
  return catalog.find(item => item.value === region);
}

export function readReplayRegion(value: string | null): ReplayRegionId | undefined {
  return value !== null && (Object.hasOwn(replayRegions, value) || regionalReplay(value)) ? value : undefined;
}

export const replayRegionOptions = [
  { value: "archive", label: replayRegions.archive.label },
  ...catalog.map(({ value, label }) => ({ value, label })),
];

export function replayRegionAt(longitude: number, latitude: number) {
  const contains = ({ west, east, south, north }: { west: number; east: number; south: number; north: number }) =>
    longitude >= west && longitude <= east && latitude >= south && latitude <= north;
  return catalog.find(({ bounds }) => contains(bounds))
    ?? (contains({ west: -80, east: -64, south: 23, north: 35 }) ? { value: "archive", label: replayRegions.archive.label } : undefined);
}
