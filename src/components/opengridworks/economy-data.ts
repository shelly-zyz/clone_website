export const economyMetrics = {
  gdp: { code: "NY.GDP.MKTP.CD", label: "GDP 总量", min: 1e8, max: 3e13, unit: "美元" },
  perCapita: { code: "NY.GDP.PCAP.CD", label: "人均 GDP", min: 5e2, max: 1e5, unit: "美元/人" },
  exports: { code: "NE.EXP.GNFS.CD", label: "商品与服务出口", min: 1e7, max: 4e12, unit: "美元" },
} as const;

export type EconomyMetric = keyof typeof economyMetrics;
type Indicator = typeof economyMetrics[EconomyMetric]["code"];

export type EconomyCountry = {
  code: string;
  mapId: string;
  label: string;
  coordinates: [number, number];
  values: Record<Indicator, (number | null)[]>;
};

export type EconomySnapshot = {
  years: number[];
  updateDates: Record<Indicator, string>;
  countries: EconomyCountry[];
};

export type EconomicOutlook = {
  edition: string;
  sourceUrl: string;
  years: number[];
  values: Record<string, (number | null)[] | undefined>;
};

export type EconomyValue = { country: EconomyCountry; value: number | null };
export type EconomyRank = { country: EconomyCountry; value: number; rank: number };

const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });
const amount = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function formatEconomyAmount(value: number | null, metric: EconomyMetric) {
  if (value === null) return "暂无";
  const number = metric === "perCapita" ? amount : compact;
  return `${number.format(value)} ${economyMetrics[metric].unit}`;
}

export function formatGrowth(value: number, suffix = "%") {
  return `${amount.format(value)}${suffix}`;
}

export function rankEconomies(values: EconomyValue[]): EconomyRank[] {
  return values.flatMap(({ country, value }) => value === null ? [] : [{ country, value }])
    .toSorted((a, b) => b.value - a.value)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
