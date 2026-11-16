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
