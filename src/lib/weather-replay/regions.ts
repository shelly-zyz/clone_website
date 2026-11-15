export const replayRegions = {
  archive: { label: "西北大西洋 · 档案全域", land: ["USA", "BHS", "BMU", "CUB"] },
  usa: { label: "美国 · 东南沿海覆盖区", land: ["USA"] },
  bahamas: { label: "巴哈马 · 档案覆盖区", land: ["BHS"] },
  china: { label: "中国 · 暂无已发布回放", land: ["CHN"] },
} as const;

export type ReplayRegionId = keyof typeof replayRegions;

export function readReplayRegion(value: string | null): ReplayRegionId | undefined {
  return value !== null && Object.hasOwn(replayRegions, value) ? value as ReplayRegionId : undefined;
}

export const replayRegionOptions = Object.entries(replayRegions).map(([value, { label }]) => ({ value, label }));
