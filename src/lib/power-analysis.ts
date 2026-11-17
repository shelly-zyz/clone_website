import { interpolatePlasma, interpolateTurbo } from "d3-scale-chromatic";
import { chinaProvinces } from "./china-provinces";
import { chinaPowerAnnualFrame, powerAmount, powerMapNoData, type ProvincePowerFrame } from "./china-power-statistics";

export const emberSource = "https://ember-energy.org/data/china-electricity-data/";
export const emberMethod = "https://storage.googleapis.com/emb-prod-bkt-publicdata/public-downloads/ember_china_generation_methodology.pdf";

export const powerFuels = [
  { id: "coal", label: "煤电", color: "#db876c" },
  { id: "gas", label: "气电", color: "#d4a28b" },
  { id: "other", label: "其他化石", color: "#a07775" },
  { id: "bio", label: "生物质", color: "#a1ba6d" },
  { id: "hydro", label: "水电", color: "#69aef1" },
  { id: "nuclear", label: "核电", color: "#a68ce2" },
  { id: "wind", label: "风电", color: "#58cfbd" },
  { id: "solar", label: "太阳能", color: "#eccc79" },
] as const;
export type PowerFuel = typeof powerFuels[number]["id"];
export type PowerGrain = "annual" | "monthly" | "ytd";
export type PowerMeasure = "total" | "growth" | "change" | "clean" | "windsolar";
export type PowerObservation = {
  total: number | null;
  mix?: Partial<Record<PowerFuel | "thermal", number | null>>;
  clean?: number | null;
  windsolar?: number | null;
  reportedGrowth?: number | null;
};
export type PowerPeriod = Readonly<Record<string, PowerObservation>>;
export type PowerSeries = Readonly<Record<string, PowerPeriod>>;
export type EmberArchive = {
  release: string;
  sha256: string;
  fields: string[];
  periods: Record<string, Record<string, (number | null)[]>>;
};
export const nationalPowerCode = "national";
export const powerSources = {
  ember: "Ember · 第三方估算",
  yearbook: "中国电力统计年鉴 2024",
  nbs: "国家统计局 · 规模以上工业",
};
export const powerMeasureLabels: Record<PowerMeasure, string> = {
  total: "总量", growth: "同比增速", change: "双期增量", clean: "清洁电源占比", windsolar: "风光占比",
};
export const powerRegionName = (code: string) => chinaProvinces.find(item => item.code === code)?.name ?? (code === nationalPowerCode ? "中国全国" : code);
export const powerSeriesKeys = (series: PowerSeries) => Object.keys(series).sort();
export const generationUnit = "亿千瓦时";
export const capacityUnit = "万千瓦";

const emberFuelFields = ["Coal", "Gas", "Other fossil", "Bioenergy", "Hydro", "Nuclear", "Wind", "Solar"];
const emberRegions = new Map(chinaProvinces.map(item => [item.iso.slice(3), item.code]));
emberRegions.set("CN", nationalPowerCode);

function sumComplete(values: readonly (number | null | undefined)[]) {
  if (!values.length || values.some(value => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function readEmberSeries(archive: EmberArchive): PowerSeries {
  const indexes = new Map(archive.fields.map((item, index) => [item, index]));
  return Object.fromEntries(Object.entries(archive.periods).map(([period, rows]) => [period,
    Object.fromEntries(Object.entries(rows).flatMap(([region, values]) => {
      const code = emberRegions.get(region);
      if (!code) return [];
      // Ember TWh → 亿千瓦时. Nulls are distinct from reported zeros.
      const value = (name: string) => {
        const raw = values[indexes.get(name) ?? -1];
        return raw == null ? null : raw * 10;
      };
      const mix = Object.fromEntries(powerFuels.map(({ id }, index) => [id, value(emberFuelFields[index])]));
      return [[code, {
        total: value("Total generation"), mix,
        clean: value("Clean"), windsolar: value("Wind and solar"),
      } satisfies PowerObservation]];
    })),
  ]));
}

export function cumulativePowerSeries(monthly: PowerSeries): PowerSeries {
  const regions = [nationalPowerCode, ...chinaProvinces.map(item => item.code)];
  return Object.fromEntries(powerSeriesKeys(monthly).flatMap(period => {
    const year = period.slice(0, 4);
    const months = Array.from({ length: Number(period.slice(5)) }, (_, index) =>
      monthly[year + "-" + String(index + 1).padStart(2, "0")]);
    const records = regions.flatMap(code => {
      const rows = months.map(frame => frame?.[code]);
      const total = sumComplete(rows.map(row => row?.total));
      if (total == null) return [];
      return [[code, {
        total,
        mix: Object.fromEntries(powerFuels.map(({ id }) => [id, sumComplete(rows.map(row => row?.mix?.[id]))])),
        clean: sumComplete(rows.map(row => row?.clean)),
        windsolar: sumComplete(rows.map(row => row?.windsolar)),
      } satisfies PowerObservation]];
    });
    return records.length ? [[period, Object.fromEntries(records)]] : [];
  }));
}

export function yearbookPowerSeries(metric: "generation" | "capacity"): PowerSeries {
  return Object.fromEntries(chinaPowerAnnualFrame(metric).years.map(year => {
    const frame = chinaPowerAnnualFrame(metric, year);
    return [String(year), Object.fromEntries([
      [nationalPowerCode, { total: frame.total }],
      ...frame.regions.map(row => [row.code, { total: row.value }] as const),
    ])];
  }));
}

export const yearbookGeneration = yearbookPowerSeries("generation");
export const yearbookCapacity = yearbookPowerSeries("capacity");

export function previousPowerYear(period: string) {
  return String(Number(period.slice(0, 4)) - 1) + period.slice(4);
}

export function powerPeriodLabel(period: string, grain: PowerGrain) {
  if (!period) return "暂无可用统计期";
  if (grain === "annual") return period + " 年";
  return grain === "ytd" ? period.slice(0, 4) + " 年 1–" + Number(period.slice(5)) + " 月" : period;
}

export function powerProductAmount(row?: PowerObservation, product = "electricity"): number | null {
  switch (product) {
    case "wind-power": return row?.mix?.wind ?? null;
    case "solar-power": return row?.mix?.solar ?? null;
    case "hydro-power": return row?.mix?.hydro ?? null;
    case "nuclear-power": return row?.mix?.nuclear ?? null;
    case "thermal-power": return row?.mix?.thermal ?? sumComplete([row?.mix?.coal, row?.mix?.gas, row?.mix?.other, row?.mix?.bio]);
    default: return row?.total ?? null;
  }
}

export function powerDifference(current: number | null, baseline: number | null) {
  return current == null || baseline == null ? null : current - baseline;
}

export function powerGrowth(current: number | null, baseline: number | null) {
  return current == null || baseline == null || baseline <= 0 ? null : (current - baseline) / baseline * 100;
}

function powerShare(value: number | null | undefined, total: number | null | undefined) {
  return value != null && total != null && total > 0 ? value / total * 100 : null;
}

export function readPowerMeasure(measure: PowerMeasure, current?: PowerObservation, yoy?: PowerObservation, baseline?: PowerObservation, product?: string) {
  const value = powerProductAmount(current, product);
  switch (measure) {
    case "growth": return (!product || product === "electricity" ? current?.reportedGrowth : null) ?? powerGrowth(value, powerProductAmount(yoy, product));
    case "change": return powerDifference(value, powerProductAmount(baseline, product));
    case "clean": return powerShare(current?.clean, current?.total);
    case "windsolar": return powerShare(current?.windsolar, current?.total);
    default: return value;
  }
}

export function powerHistoricalExtent(history: PowerSeries, product: string, compareCalendarMonth: boolean) {
  const peaks = new Map<string, [number, number]>();
  const growth: number[] = [];
  for (const [period, frame] of Object.entries(history)) {
    for (const { code } of chinaProvinces) {
      const value = powerProductAmount(frame[code], product);
      if (value == null) continue;
      const key = compareCalendarMonth ? code + period.slice(4) : code;
      const limits = peaks.get(key);
      if (limits) {
        limits[0] = Math.min(limits[0], value);
        limits[1] = Math.max(limits[1], value);
      } else peaks.set(key, [value, value]);
      const change = powerGrowth(value, powerProductAmount(history[previousPowerYear(period)]?.[code], product));
      if (change != null) growth.push(Math.abs(change));
    }
  }
  growth.sort((a, b) => a - b);
  // Use the full archive's P95 to keep near-zero baselines from flattening the map's color range.
  const p95 = growth[Math.floor((growth.length - 1) * .95)] ?? 0;
  const growthLimit = Math.max(10, Math.ceil(p95 / 5) * 5);
  const changeLimit = Math.max(0, ...Array.from(peaks.values(), ([min, max]) => max - min));
  return { growthLimit, changeLimit };
}

export const powerDefaultPalette = "spectrum";
export type PowerPalette = typeof powerDefaultPalette | "plasma" | "turbo";
const spectrumStops: readonly (readonly [offset: number, rgb: readonly number[]])[] = [
  [0, [54, 215, 242]],
  [.225, [57, 140, 246]],
  [.375, [36, 201, 170]],
  [.525, [120, 217, 108]],
  [.675, [245, 230, 91]],
  [.825, [255, 163, 77]],
  [1, [241, 94, 112]],
];
const divergingStops = [[52, 148, 228], [68, 87, 164], [88, 87, 103], [192, 70, 102], [255, 181, 65]];
export const powerSelectionColors = ["#f5f9ff", "#abc4e5", "#9f9bd6"];

function mixPowerColors(lower: readonly number[], upper: readonly number[], blend: number) {
  const channels = lower.map((channel, index) => Math.round(channel + (upper[index] - channel) * blend));
  return "rgb(" + channels.join(", ") + ")";
}

export function powerRampColor(ratio: number, diverging: boolean, palette: PowerPalette = powerDefaultPalette) {
  if (diverging) {
    const position = ratio * (divergingStops.length - 1);
    const index = Math.min(divergingStops.length - 2, Math.floor(position));
    return mixPowerColors(divergingStops[index], divergingStops[index + 1], position - index);
  }
  if (palette === "turbo") return interpolateTurbo(ratio);
  if (palette === "plasma") return interpolatePlasma(.12 + ratio * .86);
  const index = Math.max(1, spectrumStops.findIndex(([offset]) => ratio <= offset));
  const [low, lowerColor] = spectrumStops[index - 1];
  const [high, upperColor] = spectrumStops[index];
  return mixPowerColors(lowerColor, upperColor, (ratio - low) / (high - low));
}

export const powerLegendColors = (diverging: boolean, palette: PowerPalette = powerDefaultPalette) =>
  Array.from({ length: 5 }, (_, index) => powerRampColor((index + .5) / 5, diverging, palette));
export const powerMagnitude = (value: number | null, max: number, diverging: boolean) =>
  value == null || max <= 0 ? (diverging ? .5 : 0) : Math.max(0, Math.min(1, diverging ? (value / max + 1) / 2 : value / max));
export const powerBin = (value: number | null, max: number, diverging: boolean) =>
  value == null ? -1 : Math.min(4, Math.floor(powerMagnitude(value, max, diverging) * 5));
export const powerClassColor = (value: number | null, max: number, diverging: boolean, palette: PowerPalette = powerDefaultPalette) => {
  const index = powerBin(value, max, diverging);
  return index < 0 ? powerMapNoData : powerRampColor((index + .5) / 5, diverging, palette);
};

export function formatPowerNumber(value: number | null | undefined, unit = "", signed = false) {
  return value == null ? "—" : (signed && value > 0 ? "+" : "") + powerAmount.format(value) + (unit === "%" ? "%" : unit ? " " + unit : "");
}

export function comparisonScatter(year: string) {
  const previous = previousPowerYear(year);
  const capacity = yearbookCapacity[year];
  const generation = yearbookGeneration[year];
  if (!capacity || !generation || !yearbookCapacity[previous] || !yearbookGeneration[previous]) return [];
  return chinaProvinces.flatMap(({ code, name }) => {
    const stock = capacity[code]?.total ?? null;
    const x = powerGrowth(stock, yearbookCapacity[previous][code]?.total ?? null);
    const y = powerGrowth(generation[code]?.total ?? null, yearbookGeneration[previous][code]?.total ?? null);
    return x == null || y == null || stock == null ? [] : [{ code, name, x, y, stock }];
  });
}

export function powerAnalysisMapFrame({ current, previous, reference, period, grain, measure, product,
  valueUnit, scaleMax, label, demo }: {
  current: PowerPeriod; previous?: PowerPeriod; reference?: PowerPeriod;
  period: string; grain: PowerGrain; measure: PowerMeasure; product: string;
  valueUnit: string; scaleMax?: number; label: string; demo?: true;
}): ProvincePowerFrame {
  const isSigned = measure === "growth" || measure === "change";
  const percent = measure === "growth" || measure === "clean" || measure === "windsolar";
  const totals = chinaProvinces.map(({ code }) => ({ code, amount: powerProductAmount(current[code], product) }));
  const ordered = totals.flatMap(row => row.amount == null ? [] : [row.amount]).sort((a, b) => b - a);
  const regions = totals.map(({ code, amount }) => {
    const change = readPowerMeasure("growth", current[code], previous?.[code], undefined, product);
    return {
      code, value: readPowerMeasure(measure, current[code], previous?.[code], reference?.[code], product),
      detail: amount == null ? undefined : [
        formatPowerNumber(amount, valueUnit),
        ...(change == null ? [] : ["同比 " + formatPowerNumber(change, "%", true)]),
        "规模第 " + (ordered.indexOf(amount) + 1),
      ].join(" · "),
    };
  });
  const peak = scaleMax ?? Math.max(0, ...regions.map(row => Math.abs(row.value ?? 0)));
  return {
    label, period: powerPeriodLabel(period, grain), unit: percent ? "%" : valueUnit,
    scaleMax: measure === "clean" || measure === "windsolar" ? 100 : peak, regions,
    encoding: isSigned ? "diverging" : "sequential", demo,
  };
}
