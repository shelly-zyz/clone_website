import { chinaProvinces } from "./china-provinces";
import { chinaPowerYearbook } from "./china-power-yearbook";

export type ChinaPowerMetric = keyof typeof chinaPowerYearbook;
export type ProvincePowerFrame = {
  label: string;
  unit: string;
  period: string;
  regions: readonly { code: string; value: number | null }[];
};

export const powerMapNoData = "#394b58";
export const powerMapColors = ["#c6e7fa", "#77bcea", "#378ccf", "#1766af", "#073c7e"] as const;
export const powerAmount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function provincePowerMax(frame: ProvincePowerFrame) {
  return Math.max(0, ...frame.regions.map(row => row.value ?? 0));
}

export function provincePowerColor(value: number | null | undefined, maximum: number) {
  if (value == null) return powerMapNoData;
  const index = maximum > 0 ? Math.floor(value / maximum * powerMapColors.length) : 0;
  return powerMapColors[Math.min(index, powerMapColors.length - 1)];
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
    source: series.source,
    table: series.table,
    regions: chinaProvinces.map(({ code, name }) => ({ code, name, value: series.provinces[code.slice(0, 2)][index] })),
  } satisfies ProvincePowerFrame & { year: number; years: readonly number[]; total: number; source: string; table: string };
}
