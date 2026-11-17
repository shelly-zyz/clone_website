import { chinaProvinces } from "./china-provinces";
import { chinaPowerYearbook } from "./china-power-yearbook";

export type ChinaPowerMetric = keyof typeof chinaPowerYearbook;
export type ProvincePowerFrame = {
  label: string;
  unit: string;
  period: string;
  scaleMax: number;
  regions: readonly { code: string; value: number | null }[];
};

export const powerMapNoData = "#46586a";
export const powerMapColors = ["#b8e2f2", "#7fc9ed", "#549fdb", "#2e78c5", "#1c52a6"] as const;
export const powerAmount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function provincePowerMax(frame: ProvincePowerFrame) {
  return Math.max(0, ...frame.regions.map(row => row.value ?? 0));
}

export function provincePowerRatio(value: number, maximum: number) {
  return maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0;
}

export function chinaPowerAnnualFrame(metric: ChinaPowerMetric, requestedYear?: number) {
  const series = chinaPowerYearbook[metric];
  const yearIndex = series.years.findIndex(year => year === requestedYear);
  const index = yearIndex === -1 ? series.years.length - 1 : yearIndex;

  return {
    label: series.label,
    unit: series.unit,
    year: series.years[index],
    years: series.years,
    period: `${series.years[index]} 年`,
    total: series.total[index],
    scaleMax: Math.max(...Object.values(series.provinces).flat()),
    source: series.source,
    table: series.table,
    regions: chinaProvinces.map(({ code, name }) => ({ code, name, value: series.provinces[code.slice(0, 2)][index] })),
  } satisfies ProvincePowerFrame & { year: number; years: readonly number[]; total: number; source: string; table: string };
}
