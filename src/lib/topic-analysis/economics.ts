import gep from "../../../public/data/economy/gep.json";
import wdi from "../../../public/data/economy/wdi.json";
import { analysisTopics } from "./catalog";
import { distribution } from "./distribution";
import { metric, relativeIndex, type Analysis, type AnalysisChartSpec, type Source, type Value } from "./model";

const GDP = "NY.GDP.MKTP.CD";
const PER_CAPITA = "NY.GDP.PCAP.CD";
const EXPORTS = "NE.EXP.GNFS.CD";
const forecasts = gep.values as Record<string, Value[] | undefined>;
const globalForecast = forecasts.WLT ?? [];
const wdiSource = (indicator: string): Source => ({
  label: "世界银行 · " + ({ [GDP]: "GDP", [PER_CAPITA]: "人均 GDP", [EXPORTS]: "商品与服务出口" }[indicator] ?? "WDI"),
  href: "https://data.worldbank.org/indicator/" + indicator,
});
const gdpSource = wdiSource(GDP);
const perCapitaSource = wdiSource(PER_CAPITA);
const exportSource = wdiSource(EXPORTS);
const forecastSource = { label: "世界银行 · 全球经济展望 2026 年 6 月版", href: gep.sourceUrl };
const geographies = { label: "Natural Earth · 地图边界", href: "https://www.naturalearthdata.com/" };
const hundredMillionUsd = (value: Value) => value === null ? null : value / 1e8;
const percentOf = (value: Value, total: Value) => value === null || total === null || total <= 0 ? null : value / total * 100;

export const economyCountries = wdi.countries.map(({ code, label }) => ({ code, label }))
  .toSorted((a, b) => a.label.localeCompare(b.label, "zh-CN"));
export const economyYears = wdi.years.toReversed();
export const latestEconomyYear = economyYears[0];
export const outlookYears = gep.years;
export const outlookCountries = economyCountries.filter(({ code }) => forecasts[code]?.some(value => value !== null));
export const economyIndicators = { total: "GDP 总量", perCapita: "人均 GDP" };
export type EconomyIndicator = keyof typeof economyIndicators;
export type EconomyComparisonMode = "value" | "growth" | "index";
export const economyComparisonModes = {
  value: "原值", growth: "同比变化", index: "起始年 = 100",
} as const;

function countryAt(code: string) {
  return wdi.countries.find(item => item.code === code) ?? wdi.countries[0];
}

function historicalYears(year: number, startYear = wdi.years[0]) {
  const index = wdi.years.indexOf(year);
  const start = Math.max(0, wdi.years.indexOf(startYear));
  return { index, start, labels: wdi.years.slice(start, index + 1).map(String) };
}

export function buildEconomyAnalysis(code: string, year: number, view: EconomyIndicator, startYear?: number): Analysis {
  const country = countryAt(code);
  const { index, start, labels } = historicalYears(year, startYear);
  const color = analysisTopics.economy.color;
  const name = economyIndicators[view];
  const isTotal = view === "total";
  const unit = isTotal ? "亿美元" : "美元/人";
  const indicatorSource = isTotal ? gdpSource : perCapitaSource;
  const economies = wdi.countries.map(item => ({
    label: item.label, code: item.code, mapId: item.mapId,
    value: isTotal ? hundredMillionUsd(item.values[GDP][index]) : item.values[PER_CAPITA][index],
  }));
  const ranking = economies.filter(item => item.value !== null).toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 10);
  return {
    scope: `${country.label} · 世界银行 WDI · ${wdi.years[start]}–${year} 年 · 现价美元`,
    metrics: [
      metric(`${year} 年 GDP`, hundredMillionUsd(country.values[GDP][index]), "亿美元"),
      metric(`${year} 年人均 GDP`, country.values[PER_CAPITA][index], "美元/人"),
      metric(`${year} 年商品和服务出口`, hundredMillionUsd(country.values[EXPORTS][index]), "亿美元"),
    ],
    charts: [
      {
        id: "gdp-map", label: "全球地图", title: `${year} 年全球 ${name}`,
        caption: "按数量级着色，灰色表示地图上无对应数值。点击有值区域可切换经济体。",
        kind: "map", labels: economies.map(item => item.label), mapIds: economies.map(item => item.mapId), unit, color,
        focus: country.label, stops: isTotal ? [100, 1000, 10000, 50000] : [1000, 5000, 15000, 50000],
        series: [{ name, values: economies.map(item => item.value) }], sources: [indicatorSource, geographies],
      },
      {
        id: "gdp-ranking", label: "规模排行", title: `${year} 年${name}最高的经济体`,
        caption: "展示站内 WDI 快照中该指标有值的前十个国家或地区。点击排行可切换国家档案。",
        kind: "horizontal", labels: ranking.map(item => item.label), unit, color,
        focus: country.label,
        series: [{ name, values: ranking.map(item => item.value) }], sources: [indicatorSource],
      },
      {
        id: "gdp-trend", label: "GDP 走势", title: `${country.label}的 GDP 总量`,
        caption: "采用现价美元。曲线包含价格和汇率变动的影响。",
        kind: "area", labels, unit: "亿美元", color,
        series: [{ name: "GDP", values: country.values[GDP].slice(start, index + 1).map(hundredMillionUsd) }], sources: [gdpSource],
      },
      {
        id: "gdp-per-capita", label: "人均走势", title: `${country.label}的人均 GDP`,
        caption: "现价 GDP 按人口折算。",
        kind: "line", labels, unit: "美元/人", color,
        series: [{ name: "人均 GDP", values: country.values[PER_CAPITA].slice(start, index + 1) }], sources: [perCapitaSource],
      },
    ],
  };
}

export function buildTradeAnalysis(code: string, year: number, startYear?: number): Analysis {
  const country = countryAt(code);
  const { index, start, labels } = historicalYears(year, startYear);
  const color = analysisTopics.trade.color;
  const economies = wdi.countries.flatMap(item => {
    const exports = item.values[EXPORTS][index];
    const gdp = item.values[GDP][index];
    return exports !== null && exports > 0 && gdp !== null && gdp > 0
      ? [{ code: item.code, label: item.label, exports: exports / 1e8, gdp: gdp / 1e8, share: exports / gdp * 100 }]
      : [];
  });
  const top = wdi.countries.flatMap(item => {
    const value = item.values[EXPORTS][index];
    return value !== null && value > 0 ? [{ label: item.label, value: value / 1e8 }] : [];
  }).toSorted((a, b) => b.value - a.value).slice(0, 12);
  return {
    scope: `${country.label} · 世界银行 WDI · ${wdi.years[start]}–${year} 年 · 商品与服务出口`,
    metrics: [
      metric(`${year} 年出口额`, hundredMillionUsd(country.values[EXPORTS][index]), "亿美元"),
      metric("出口额占 GDP", percentOf(country.values[EXPORTS][index], country.values[GDP][index]), "%"),
      metric("散点图覆盖经济体", economies.length, "个"),
    ],
    charts: [
      {
        id: "export-relationship", label: "开放度气泡图", title: `${year} 年经济规模与出口开放度`,
        caption: "横轴为 GDP（对数坐标），纵轴为出口占 GDP 比重。气泡面积随出口规模增大。紫色表示出口占比达到 100%，转口贸易等可使该比重超过 100%。点击气泡可切换经济体。",
        kind: "bubble", labels: economies.map(item => item.label), unit: "%", xUnit: "亿美元", xLog: true, color, focus: country.label,
        categoryColors: economies.map(item => item.share >= 100 ? "#9698c9" : "#91b7d5"),
        sizes: economies.map(item => item.exports), sizeName: "商品与服务出口额", sizeUnit: "亿美元",
        series: [
          { name: "GDP", values: economies.map(item => item.gdp) },
          { name: "出口占 GDP", values: economies.map(item => item.share) },
        ],
        sources: [exportSource, gdpSource],
      },
      {
        id: "exports-mix", label: "出口规模格局", title: `${year} 年主要出口经济体`,
        caption: "扇区以图示前 12 个经济体的出口额之和为分母。点击扇区可切换经济体。",
        kind: "donut", labels: top.map(item => item.label), unit: "亿美元", color, focus: country.label,
        center: { value: top.length ? top.reduce((sum, item) => sum + item.value, 0) : null, label: "图示前列经济体合计", unit: "亿美元" },
        series: [{ name: "商品与服务出口额", values: top.map(item => item.value) }], sources: [exportSource],
      },
      {
        id: "exports-trend", label: "出口历史", title: `${country.label}的历年出口规模`,
        caption: "商品与服务出口额按现价美元计。",
        kind: "area", labels, unit: "亿美元", color,
        series: [{ name: "出口额", values: country.values[EXPORTS].slice(start, index + 1).map(hundredMillionUsd) }], sources: [exportSource],
      },
      {
        id: "exports-share", label: "开放度走势", title: `${country.label}的出口占 GDP 比重`,
        caption: "以同年、同币种的商品与服务出口额除以 GDP。",
        kind: "line", labels, unit: "%", color,
        series: [{ name: "出口占 GDP", values: country.values[EXPORTS].slice(start, index + 1)
          .map((value, item) => percentOf(value, country.values[GDP][start + item])) }],
        sources: [exportSource, gdpSource],
      },
    ],
  };
}

const forecastComparison = ["CHN", "USA", "IND", "DEU", "BRA"];

export function buildEconomicComparison(codes: readonly string[], startYear: number, endYear: number,
  indicator: "gdp" | "perCapita" | "exports", mode: EconomyComparisonMode,
): AnalysisChartSpec {
  const { index, start, labels } = historicalYears(endYear, startYear);
  const metricCode = indicator === "gdp" ? GDP : indicator === "exports" ? EXPORTS : PER_CAPITA;
  const source = wdiSource(metricCode);
  const name = indicator === "gdp" ? "GDP" : indicator === "exports" ? "商品和服务出口额" : "人均 GDP";
  const unit = mode === "growth" ? "%" : mode === "index" ? "指数" : indicator === "perCapita" ? "美元/人" : "亿美元";
  const valuesFor = (values: Value[]) => values.slice(start, index + 1).map((value, offset) => {
    if (mode === "index") return relativeIndex(value, values[start] ?? null);
    if (mode === "growth") {
      const base = values[start + offset - 1];
      return value === null || base == null || base <= 0 ? null : (value / base - 1) * 100;
    }
    return indicator === "perCapita" ? value : hundredMillionUsd(value);
  });
  return {
    id: "economic-comparison", label: "经济体对比", title: name + " · " + economyComparisonModes[mode],
    caption: mode === "growth" ? "同一 WDI 快照的现价美元同比，包含价格和汇率变化。缺测或上年为零时留空。"
      : mode === "index" ? `各经济体以 ${startYear} 年为 100。基期缺测或为零时该序列留空。`
      : "同一 WDI 快照的现价美元数据，缺测保留断线。",
    unit, color: "#246591", labels, kind: "line",
    series: codes.map((code, index) => {
      const country = countryAt(code);
      return { name: country.label, values: valuesFor(country.values[metricCode]), color: comparisonColors[index] };
    }),
    sources: [source],
  };
}

const comparisonColors = ["#246591", "#b86134", "#217e66"];

export function buildOutlookAnalysis(code: string, year: number, compared?: readonly string[]): Analysis {
  const worldSelection = code === "WLT";
  const country = worldSelection ? { label: "全球", code: "WLT" } : countryAt(code);
  const index = gep.years.indexOf(year);
  const color = analysisTopics.outlook.color;
  const edition = gep.edition.replace(/^(\d{4})-0?(\d{1,2})$/, "$1 年 $2 月");
  const comparison = [...new Set([...(worldSelection ? [] : [country.code]), ...(compared ?? forecastComparison)])];
  const projections = forecasts[country.code] ?? gep.years.map(() => null);
  const world = globalForecast[index] ?? null;
  const value = projections[index] ?? null;
  const ranking = outlookCountries.flatMap(item => {
    const current = forecasts[item.code]?.[index];
    return current === null || current === undefined ? [] : [{ ...item, current }];
  }).toSorted((a, b) => b.current - a.current).slice(0, 10);
  const distributions = gep.years.map((_, offset) => distribution(outlookCountries.map(item => forecasts[item.code]?.[offset])));
  return {
    scope: `${country.label} · 世界银行全球经济展望 ${edition}版 · ${gep.years[0]}–${gep.years.at(-1)} 年预测`,
    metrics: worldSelection ? [
      metric(`${year} 年全球预测增速`, world, "%"),
      metric("同期经济体预测中位数", distributions[index]?.median ?? null, "%"),
      metric("同期有预测值经济体", distributions[index]?.count ?? null, "个"),
    ] : [
      metric(`${year} 年${country.label}预测增速`, value, "%"),
      metric("同期全球预测增速", world, "%"),
      metric("相对全球预测差值", value === null || world === null ? null : value - world, "百分点"),
    ],
    charts: [
      {
        id: "growth-outlook", label: "增长路径", title: worldSelection ? "全球实际 GDP 增长预测" : `${country.label}与全球的增长预测`,
        caption: "同一版实际 GDP 年增速预测。虚线表示预测值，竖线标记所选年份。",
        kind: "line", forecast: true, labels: gep.years.map(String), unit: "%", color, focus: String(year),
        series: worldSelection ? [{ name: "全球", values: globalForecast }]
          : [{ name: country.label, values: projections }, { name: "全球", color: "#347e85", values: globalForecast }],
        sources: [forecastSource],
      },
      {
        id: "growth-range", label: "预测增速区间", title: `${country.label}与有预测值经济体的增长区间`,
        caption: "阴影为每年各经济体预测值的第 25–75 百分位，虚线对照所选经济体。每个经济体等权，覆盖数见数值表。区间表示跨经济体差异。",
        kind: "range-band", labels: gep.years.map(String), unit: "%", color, focus: String(year),
        series: [
          { name: country.label, values: projections },
          { name: "经济体中位数", values: distributions.map(item => item.median), color: "#347e85" },
          { name: "第 25 百分位", values: distributions.map(item => item.lower) },
          { name: "第 75 百分位", values: distributions.map(item => item.upper) },
          { name: "有预测值经济体", values: distributions.map(item => item.count), unit: "个" },
        ],
        sources: [forecastSource],
      },
      {
        id: "growth-comparison", label: "经济体对照", title: "主要经济体的增长预测对照",
        caption: "同一发布批次的实际 GDP 增速预测，含世界银行发布的全球汇总。",
        kind: "heatmap", labels: gep.years.map(item => item + " 年"), unit: "%", color,
        series: [
          ...(worldSelection ? [{ name: "全球", values: globalForecast }] : []),
          ...comparison.map(item => ({ name: countryAt(item).label, values: forecasts[item] ?? gep.years.map(() => null) })),
          ...(worldSelection ? [] : [{ name: "全球", values: globalForecast }]),
        ],
        sources: [forecastSource],
      },
      {
        id: "growth-ranking", label: "预测排行", title: `${year} 年预测增速最高的经济体`,
        caption: "按此版预测值排序，展示有国家或地区标识的前十名。点击排行可切换增长路径。",
        kind: "horizontal", labels: ranking.map(item => item.label), unit: "%", color,
        focus: country.label,
        series: [{ name: "实际 GDP 增速预测", values: ranking.map(item => item.current) }], sources: [forecastSource],
      },
    ],
  };
}
