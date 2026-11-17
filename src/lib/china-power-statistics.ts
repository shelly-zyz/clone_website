import { chinaProvinces } from "./china-provinces";
import { chinaPowerYearbook } from "./china-power-yearbook";

export type ChinaPowerMetric = keyof typeof chinaPowerYearbook;
export type ProvincePowerFrame = {
  label: string;
  unit: string;
  period: string;
  scaleMax: number;
  regions: readonly { code: string; value: number | null }[];
  demo?: true;
  total?: number;
};

export const powerDemoNotice = "演示数据 · 人工合成，非真实统计，不用于预测或分析";
const demoSeason = [0.9, 0.82, 0.96, 0.92, 0.98, 1.06, 1.18, 1.16, 1.04, 0.98, 1.02, 1.1] as const;
const demoProducts = { electricity: 1, "thermal-power": 0.64, "hydro-power": 0.17, "nuclear-power": 0.05, "wind-power": 0.09, "solar-power": 0.05 } as const;

export function chinaPowerMonthlyDemoFrame(month: string, product: string = "electricity"): ProvincePowerFrame {
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "2025-12";
  const season = demoSeason[Number(validMonth.slice(5)) - 1];
  const factor = demoProducts[product as keyof typeof demoProducts] ?? 1;
  // Fixed synthetic samples: no API facts, random values or database publication are used.
  const regions = chinaProvinces.map(({ code }, index) => ({
    code, value: Math.round((70 + ((index * 67 + 41) % 330)) * season * factor * 100) / 100,
  }));
  return {
    label: "月度发电量（演示）", unit: "亿千瓦时", period: validMonth,
    demo: true, regions, total: Math.round(regions.reduce((sum, row) => sum + row.value, 0) * 100) / 100,
    scaleMax: Math.max(...regions.map(row => row.value)),
  };
}

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
