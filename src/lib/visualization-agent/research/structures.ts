import type { ChartKind, DataStructure } from "./contracts";

export const structureLabels: Record<DataStructure, string> = {
  timeline: "时间序列", categories: "同一时期分类或地区对比", composition: "构成与占比",
  grid: "空间网格", forecast: "历史与预测", flow: "流向关系", relationship: "同范围指标关系",
};

export const structureCharts: Record<DataStructure, readonly ChartKind[]> = {
  timeline: ["calendar", "columns", "trend", "box", "trend-distribution", "violin", "density"],
  categories: ["rank", "horizontal-bars", "columns", "dumbbell", "waterfall", "rose", "box"],
  composition: ["ring", "composition-columns", "stack"],
  grid: ["grid", "surface"],
  forecast: ["forecast", "forecast-diagnostics"],
  flow: ["flow"],
  relationship: ["scatter", "correlation"],
};
