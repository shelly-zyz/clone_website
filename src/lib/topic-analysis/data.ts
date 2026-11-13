import official from "../../../public/data/china-validation/official-totals.json";
import gep from "../../../public/data/economy/gep.json";
import wdi from "../../../public/data/economy/wdi.json";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import carbon from "./carbon.json";
import { analysisTopics } from "./catalog";
import weather from "./weather.json";

type Source = { label: string; href: string };
type Value = number | null;
type Series = { name: string; values: readonly Value[]; color?: string };

export type AnalysisChartSpec = {
  id: string;
  title: string;
  caption: string;
  unit: string;
  kind: "line" | "column" | "horizontal" | "treemap";
  labels: readonly string[];
  series: readonly Series[];
  sources: readonly Source[];
  color: string;
  categoryColors?: readonly string[];
  focus?: string;
  forecast?: boolean;
};

type Metric = { label: string; value: string; unit?: string };
type Analysis = { scope: string; metrics: Metric[]; charts: AnalysisChartSpec[] };

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export function formatAnalysisValue(value: Value) {
  return value === null ? "暂无" : number.format(value);
}

function metric(label: string, value: Value, unit: string): Metric {
  return { label, value: formatAnalysisValue(value), unit: value === null ? undefined : unit };
}

const mix = [
  { id: "thermal", name: "火电", color: "#ad7056" },
  { id: "hydro", name: "水电", color: "#3a91ad" },
  { id: "nuclear", name: "核电", color: "#7868aa" },
  { id: "wind", name: "风电", color: "#3a927d" },
  { id: "solar", name: "太阳能", color: "#b77717" },
] as const;
const mixLabels = mix.map(({ name }) => name);
const mixColors = mix.map(({ color }) => color);
const report2025 = "https://www.stats.gov.cn/sj/zxfb/202602/t20260228_1962662.html";

const power = {
  "2024": {
    capacity: official.installedCapacityMw.total / 1000,
    generation: official.generationGwh.total / 1000,
    capacityMix: mix.map(({ id }) => official.installedCapacityMw[id] / 1000),
    generationMix: mix.map(({ id }) => official.generationGwh[id] / 1000),
    capacitySource: { label: "国家能源局 · 2024 年全国电力工业统计", href: official.installedCapacityMw.sourceUrl },
    generationSource: { label: "国家统计局 · 2024 年统计公报", href: official.generationGwh.sourceUrl },
  },
  "2025": {
    capacity: 3891.34,
    generation: 10575.25,
    capacityMix: [1539.04, 448.02, 62.48, 640.01, 1201.73],
    generationMix: [6327.15, 1461.67, 485.23, 1127.92, 1173.24],
    capacitySource: { label: "国家统计局 · 2025 年统计公报年末装机", href: report2025 },
    generationSource: { label: "国家统计局 · 2025 年统计公报表 3", href: report2025 },
  },
};

export const powerYears = ["2025", "2024"] as const;
type PowerYear = typeof powerYears[number];

export function buildPowerAnalysis(year: PowerYear): Analysis {
  const data = power[year];
  const color = analysisTopics.power.color;
  const windSolarShare = (data.capacityMix[3] + data.capacityMix[4]) / data.capacity * 100;
  const generation = mix.map(({ name, color }, index) => ({ name, color, value: data.generationMix[index] }))
    .toSorted((a, b) => b.value - a.value);
  return {
    scope: "中国全国 · " + year + " 年 · 官方统计",
    metrics: [
      metric("年末发电装机", data.capacity, "GW"),
      metric("全年发电量", data.generation, "TWh"),
      metric("风电和太阳能装机占比", windSolarShare, "%"),
    ],
    charts: [
      {
        id: "capacity-mix", title: "全国电源装机由哪些类型构成？",
        caption: "矩形面积表示公开列出的五类电源的年末装机容量。",
        kind: "treemap", labels: mixLabels, categoryColors: mixColors, unit: "GW", color,
        series: [{ name: "年末装机", values: data.capacityMix }], sources: [data.capacitySource],
      },
      {
        id: "generation-by-source", title: "各类电源全年发电量是多少？",
        caption: "按发电量从高到低排列，以太瓦时（TWh）显示。",
        kind: "horizontal", labels: generation.map(({ name }) => name),
        categoryColors: generation.map(({ color }) => color), unit: "TWh", color,
        series: [{ name: "全年发电量", values: generation.map(({ value }) => value) }], sources: [data.generationSource],
      },
      {
        id: "capacity-comparison", title: "两年间各类电源装机如何变化？",
        caption: "并列对照 2024 年和 2025 年的年末装机容量。",
        kind: "column", labels: mixLabels, unit: "GW", color,
        series: [
          { name: "2024 年", values: power["2024"].capacityMix, color: "#668895" },
          { name: "2025 年", values: power["2025"].capacityMix, color },
        ],
        sources: [power["2024"].capacitySource, power["2025"].capacitySource],
      },
    ],
  };
}

const latitudeLabels = ["90°S–60°S", "60°S–30°S", "30°S–0°", "0°–30°N", "30°N–60°N", "60°N–90°N"];
const speedLabels = ["<3", "3–<6", "6–<9", "9–<12", "12–<15", "≥15"];
const directionLabels = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
const gfs = { label: "NOAA / NCEP · GFS 1° 归档帧", href: "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast" };
export const weatherRegions = { global: "全球", north: "北半球（含赤道）", south: "南半球" };
type WeatherRegion = keyof typeof weatherRegions;
const utc = (date: string) => date.slice(0, 16).replace("T", " ") + " UTC";

export function buildWeatherAnalysis(region: WeatherRegion): Analysis {
  const data = weather.regions[region];
  const bands = latitudeLabels.flatMap((label, index) => {
    const value = data.latitudeMeans[index];
    return value === null ? [] : [{ label, value }];
  });
  const color = analysisTopics.weather.color;
  return {
    scope: weatherRegions[region] + " · GFS 10 米风 · 有效 " + utc(weather.valid),
    metrics: [
      metric("面积加权平均风速", data.mean, "m/s"),
      metric("最大格点风速", data.max, "m/s"),
      metric("有效格点", data.cells, "个"),
    ],
    charts: [
      {
        id: "wind-by-latitude", title: "哪些纬度带风速更高？",
        caption: "历史起报 " + utc(weather.issued) + "。每 30° 按格点面积加权平均。",
        kind: "column", labels: bands.map(({ label }) => label), unit: "m/s", color,
        series: [{ name: "平均风速", values: bands.map(({ value }) => value) }], sources: [gfs],
      },
      {
        id: "wind-speed-distribution", title: "各风速区间覆盖多大面积？",
        caption: "横轴为风速区间（m/s），纵轴为选定范围的加权面积占比。",
        kind: "column", labels: speedLabels, unit: "%", color,
        series: [{ name: "面积占比", values: data.speedShares }], sources: [gfs],
      },
      {
        id: "wind-directions", title: "风主要从哪个方向吹来？",
        caption: "按风的来向分为八个方位，统计风速达到 0.5 m/s 的格点面积占比。",
        kind: "horizontal", labels: directionLabels, unit: "%", color,
        series: [{ name: "方向占比", values: data.directionShares }], sources: [gfs],
      },
    ],
  };
}

const graced = { label: "Carbon Monitor · GRACED Power", href: "https://carbonmonitor-graced.com/datasets.html" };
export const carbonDates = carbon.days.map(({ date }) => date);
const carbonLabels = carbonDates.map(date => date.slice(5));
const carbonUnit = "亿 kgC/h";

export function buildCarbonAnalysis(date: string): Analysis {
  const day = carbon.days.find(item => item.date === date) ?? carbon.days[carbon.days.length - 1];
  const color = analysisTopics.carbon.color;
  const share = day.rate > 0
    ? day.latitudeRates.slice(3).reduce((sum, value) => sum + value, 0) / day.rate * 100
    : null;
  return {
    scope: "GRACED Power · 全球 0.1° 网格 · 2025 年 8 月历史样本",
    metrics: [
      metric(day.date + " 全球速率合计", day.rate / 1e8, carbonUnit),
      metric("非零排放格点", day.activeCells, "个"),
      metric("北半球速率占比", share, "%"),
    ],
    charts: [
      {
        id: "emission-trend", title: "一个月内电力部门排放如何波动？",
        caption: "逐日合计全球格点排放速率，虚线标记所选日期。",
        kind: "line", labels: carbonLabels, unit: carbonUnit, color, focus: day.date.slice(5),
        series: [{ name: "排放速率合计", values: carbon.days.map(item => item.rate / 1e8) }], sources: [graced],
      },
      {
        id: "emission-by-latitude", title: "所选日的排放集中在哪些纬度带？",
        caption: day.date + " · 每 30° 合计电力部门网格排放速率。",
        kind: "horizontal", labels: latitudeLabels, unit: carbonUnit, color,
        series: [{ name: "排放速率合计", values: day.latitudeRates.map(value => value / 1e8) }], sources: [graced],
      },
      {
        id: "emission-grid-count", title: "有排放的网格数量怎样变化？",
        caption: "按日统计速率大于零的格点，虚线标记所选日期。",
        kind: "line", labels: carbonLabels, unit: "个", color, focus: day.date.slice(5),
        series: [{ name: "非零格点", values: carbon.days.map(item => item.activeCells) }], sources: [graced],
      },
    ],
  };
}

const GDP = "NY.GDP.MKTP.CD";
const PER_CAPITA = "NY.GDP.PCAP.CD";
const EXPORTS = "NE.EXP.GNFS.CD";
const outlook = gep.values as Record<string, Value[] | undefined>;
export const economyCountries = wdi.countries.map(({ code, label }) => ({ code, label }))
  .toSorted((a, b) => a.label.localeCompare(b.label, "zh-CN"));
export const economyYears = wdi.years.toReversed();
export const latestEconomyYear = economyYears[0];
const hundredMillionUsd = (value: Value) => value === null ? null : value / 1e8;
const wdiSource = (indicator: string): Source => ({
  label: "世界银行 · WDI",
  href: "https://data.worldbank.org/indicator/" + indicator,
});

export function buildEconomyAnalysis(code: string, year: number): Analysis {
  const country = wdi.countries.find(item => item.code === code) ?? wdi.countries[0];
  const index = wdi.years.indexOf(year);
  const pastYears = wdi.years.slice(0, index + 1).map(String);
  const projections = outlook[country.code] ?? gep.years.map(() => null);
  const color = analysisTopics.economy.color;
  const ranking = wdi.countries.flatMap(item => {
    const value = item.values[GDP][index];
    return value === null ? [] : [{ label: item.label, value: value / 1e8, selected: item.code === country.code }];
  }).toSorted((a, b) => b.value - a.value).slice(0, 8);
  return {
    scope: country.label + " · WDI 历史统计截至 " + year + " 年 · GEP 2026 年 6 月版",
    metrics: [
      metric(year + " 年 GDP", hundredMillionUsd(country.values[GDP][index]), "亿美元"),
      metric(year + " 年人均 GDP", country.values[PER_CAPITA][index], "美元/人"),
      metric(gep.years[0] + " 年实际 GDP 增速预测", projections[0] ?? null, "%"),
    ],
    charts: [
      {
        id: "gdp-trend", title: country.label + "的 GDP 历年怎样变化？",
        caption: "现价美元口径，按亿美元显示。",
        kind: "line", labels: pastYears, unit: "亿美元", color,
        series: [{ name: "GDP", values: country.values[GDP].slice(0, index + 1).map(hundredMillionUsd) }], sources: [wdiSource(GDP)],
      },
      {
        id: "gdp-ranking", title: year + " 年 GDP 最高的经济体有哪些？",
        caption: "按站内快照的现价美元 GDP 排序，显示数据齐备的前八个国家或地区。",
        kind: "horizontal", labels: ranking.map(({ label }) => label), unit: "亿美元", color,
        categoryColors: ranking.map(({ selected }) => selected ? color : "#467d8c"),
        series: [{ name: "GDP", values: ranking.map(({ value }) => value) }], sources: [wdiSource(GDP)],
      },
      {
        id: "gdp-per-capita", title: country.label + "的人均 GDP 怎样变化？",
        caption: "每人现价美元。",
        kind: "line", labels: pastYears, unit: "美元/人", color,
        series: [{ name: "人均 GDP", values: country.values[PER_CAPITA].slice(0, index + 1) }], sources: [wdiSource(PER_CAPITA)],
      },
      {
        id: "exports-trend", title: country.label + "的出口规模怎样变化？",
        caption: "商品与服务出口额，现价美元口径。",
        kind: "line", labels: pastYears, unit: "亿美元", color,
        series: [{ name: "商品与服务出口额", values: country.values[EXPORTS].slice(0, index + 1).map(hundredMillionUsd) }],
        sources: [wdiSource(EXPORTS)],
      },
      {
        id: "growth-outlook", title: "世界银行如何预测" + country.label + "的经济增长？",
        caption: "2026–2028 年实际 GDP 年增速，按不变价计算。",
        kind: "line", labels: gep.years.map(String), unit: "%", color, forecast: true,
        series: [{ name: "世界银行预测", values: projections }],
        sources: [{ label: "世界银行 · 全球经济展望 2026 年 6 月版", href: gep.sourceUrl }],
      },
    ],
  };
}

export function defaultAnalysis(topic: WorkspaceTopic) {
  switch (topic) {
    case "power": return buildPowerAnalysis(powerYears[0]);
    case "weather": return buildWeatherAnalysis("global");
    case "carbon": return buildCarbonAnalysis(carbonDates[carbonDates.length - 1]);
    case "economy": return buildEconomyAnalysis("CHN", latestEconomyYear);
  }
}
