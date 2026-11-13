export type Source = { label: string; href: string };
export type Value = number | null;
export type Series = { name: string; values: readonly Value[]; color?: string };

export type AnalysisChartSpec = {
  id: string;
  label: string;
  title: string;
  caption: string;
  unit: string;
  labels: readonly string[];
  series: readonly Series[];
  sources: readonly Source[];
  color: string;
  categoryColors?: readonly string[];
  focus?: string;
  forecast?: boolean;
  zoom?: boolean;
} & (
  | { kind: "line" | "area" | "stacked-area" | "column" | "horizontal" | "treemap" | "rose" | "heatmap" }
  | { kind: "bubble"; xUnit: string; xLog?: boolean; sizeName: string; sizeUnit: string; sizes: readonly number[] }
  | { kind: "map"; mapIds: readonly string[]; stops: readonly number[] }
);

export type Metric = { label: string; value: string; unit?: string };
export type Analysis = { scope: string; metrics: Metric[]; charts: AnalysisChartSpec[] };

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function formatAnalysisValue(value: Value) {
  return value === null ? "暂无" : number.format(value);
}

export function metric(label: string, value: Value, unit: string): Metric {
  return { label, value: formatAnalysisValue(value), unit: value === null ? undefined : unit };
}

export function relativeIndex(value: Value, base: Value) {
  return value === null || base === null || base === 0 ? null : value / base * 100;
}
