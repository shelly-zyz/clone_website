import type { VreTechnology } from "@/lib/climate-vre";
import { analysisTopics } from "./catalog";
import carbon from "./carbon.json";
import { distribution } from "./distribution";
import { monthAxis, monthLabels, monthRange, observationMonths, seasonalSeries } from "./energy";
import { carbonMetrics, type PublishedHistory, type RenewableScenario } from "./history";
import { metric, type Analysis, type AnalysisChartSpec, type Value } from "./model";
import weather from "./weather.json";

const latitudeLabels = ["90°S–60°S", "60°S–30°S", "30°S–0°", "0°–30°N", "30°N–60°N", "60°N–90°N"];
const speedLabels = ["<3", "3–<6", "6–<9", "9–<12", "12–<15", "≥15"];
const directionLabels = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
const gfs = { label: "NOAA / NCEP · GFS 1° 归档帧", href: "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast" };
const scenarioSource = { label: "Scientific Data · 风光气候情景数据", href: "https://doi.org/10.1038/s41597-025-06396-5" };
export const gracedSource = { label: "Carbon Monitor · GRACED Power", href: "https://carbonmonitor-graced.com/datasets.html" };
const utc = (date: string) => date.slice(0, 16).replace("T", " ") + " UTC";

export const weatherRegions = { global: "全球", north: "北半球（含赤道）", south: "南半球" };

export function buildWeatherAnalysis(region: keyof typeof weatherRegions): Analysis {
  const data = weather.regions[region];
  const bands = latitudeLabels.flatMap((label, index) => {
    const value = data.latitudeMeans[index];
    return value === null ? [] : [{ label, value }];
  });
  const color = analysisTopics.weather.color;
  return {
    scope: weatherRegions[region] + " · GFS 10 米风 · 归档有效时刻 " + utc(weather.valid),
    metrics: [
      metric("面积加权平均风速", data.mean, "m/s"),
      metric("最大格点风速", data.max, "m/s"),
      metric("有效格点", data.cells, "个"),
    ],
    charts: [
      {
        id: "wind-directions", label: "风向玫瑰", title: "风主要从哪个方向吹来",
        caption: "扇形半径为对应来向的面积占比。统计风速达到 0.5 m/s 的格点，按格点面积加权。",
        kind: "rose", labels: directionLabels, unit: "%", color,
        series: [{ name: "方向占比", values: data.directionShares }], sources: [gfs],
      },
      {
        id: "wind-speed-distribution", label: "风速分布", title: "各风速区间覆盖的面积",
        caption: "横轴为风速区间（m/s），纵轴为选定范围的加权面积占比。",
        kind: "column", labels: speedLabels, unit: "%", color,
        series: [{ name: "面积占比", values: data.speedShares }], sources: [gfs],
      },
      {
        id: "wind-by-latitude", label: "纬度对照", title: "各纬度带的平均风速",
        caption: "历史起报 " + utc(weather.issued) + "。每 30° 按格点面积加权平均。",
        kind: "horizontal", labels: bands.map(({ label }) => label), unit: "m/s", color,
        series: [{ name: "平均风速", values: bands.map(({ value }) => value) }], sources: [gfs],
      },
    ],
  };
}

export const carbonDates = carbon.days.map(({ date }) => date);
const carbonLabels = carbonDates.map(date => date.slice(5));
const carbonUnit = "亿 kgC/h";
const carbonScale = 1e8;
export const carbonRateUnit = "kgC/h";
export type CarbonGrain = "day" | "month";
export type CarbonPeriod = { period: string; rate: Value; grids: Value; coverage: number };

export function carbonPeriods(grain: CarbonGrain, history: PublishedHistory | null): CarbonPeriod[] {
  if (history) {
    const facts = grain === "month"
      ? history.facts.map(item => ({ ...item, period: item.month }))
      : (history.days ?? []).map(item => ({ ...item, period: item.date }));
    const counts = new Map(facts.filter(item => item.series === carbonMetrics[1]).map(item => [item.period, item.value]));
    return facts.filter(item => item.series === carbonMetrics[0])
      .map(item => ({ period: item.period, rate: item.value, grids: counts.get(item.period) ?? null, coverage: item.coverage }))
      .toSorted((a, b) => a.period.localeCompare(b.period));
  }
  if (grain === "day") return carbon.days.map(item => ({ period: item.date, rate: item.rate, grids: item.activeCells, coverage: 1 }));
  return [{
    period: carbonDates[0].slice(0, 7),
    rate: carbon.days.reduce((sum, day) => sum + day.rate, 0) / carbon.days.length,
    grids: carbon.days.reduce((sum, day) => sum + day.activeCells, 0) / carbon.days.length,
    coverage: carbon.days.length,
  }];
}

export function carbonArchiveLatitudeComparison(date: string, compareDate: string): AnalysisChartSpec | null {
  const first = carbon.days.find(item => item.date === date);
  const second = carbon.days.find(item => item.date === compareDate);
  if (!first || !second) return null;
  return {
    id: "carbon-comparison-latitude", label: "纬度带对比", title: "按纬度带比较排放速率", unit: carbonRateUnit,
    caption: "每 30° 合计同一归档下各格点的电力排放速率。两期使用相同坐标轴，零值保留。",
    kind: "column", labels: latitudeLabels, color: "#b65e36",
    series: [
      { name: "A · " + date, values: first.latitudeRates, color: "#af573e" },
      { name: "B · " + compareDate, values: second.latitudeRates, color: "#276970" },
    ],
    sources: [gracedSource],
  };
}

export function carbonComparisonTrend(periods: readonly CarbonPeriod[], first: string, second: string, grain: CarbonGrain): AnalysisChartSpec | null {
  if (!first || !second || first === second) return null;
  const offsets = [-3, -2, -1, 0, 1, 2, 3];
  const byPeriod = new Map(periods.map(item => [item.period, item.rate]));
  const values = (period: string) => offsets.map(offset => {
    const date = new Date(grain === "day" ? period + "T00:00:00Z" : period + "-01T00:00:00Z");
    if (grain === "day") date.setUTCDate(date.getUTCDate() + offset);
    else date.setUTCMonth(date.getUTCMonth() + offset);
    return byPeriod.get(date.toISOString().slice(0, grain === "day" ? 10 : 7)) ?? null;
  });
  const unit = grain === "day" ? "日" : "月";
  return {
    id: "carbon-comparison-trend", label: "对比趋势", title: "所选时期及邻近变化",
    caption: `按相对所选时点的${unit}历间隔对齐。0 为所选时期，两条系列使用同一坐标轴。缺测保留断线。`,
    kind: "line", labels: offsets.map(offset => offset === 0 ? "所选时期" : `${offset > 0 ? "+" : ""}${offset} ${unit}`),
    focus: "所选时期", unit: carbonRateUnit, color: "#b65e36",
    series: [
      { name: "A · " + first, values: values(first), color: "#af573e" },
      { name: "B · " + second, values: values(second), color: "#276970" },
    ],
    sources: [gracedSource],
  };
}

export function buildCarbonAnalysis(date: string, history: PublishedHistory | null, month?: string): Analysis {
  const selectedArchive = carbon.days.find(item => item.date === date);
  const day = selectedArchive ?? carbon.days[carbon.days.length - 1];
  const daily = history ? carbonPeriods("day", history).find(entry => entry.period === (date || day.date)) : null;
  const summary = history || !month ? null : carbonPeriods("month", null).find(entry => entry.period === month);
  const archiveFocus = selectedArchive?.date || (!date && !month ? day.date : undefined);
  const color = analysisTopics.carbon.color;
  const share = day.rate > 0
    ? day.latitudeRates.slice(3).reduce((sum, value) => sum + value, 0) / day.rate * 100
    : null;
  const facts = history?.facts ?? [];
  const dates = observationMonths(facts, carbonMetrics[0]);
  const axis = monthAxis(dates);
  const byMonth = new Map(facts.filter(item => item.series === carbonMetrics[0]).map(item => [item.month, item]));
  const latestMonth = dates.at(-1);
  const selectedMonth = month || latestMonth;
  const selectedPeriod = selectedMonth ? byMonth.get(selectedMonth) : undefined;
  const charts: AnalysisChartSpec[] = [
    {
      id: "carbon-monthly", label: "多年走势", title: "全球电力部门排放速率的月度变化",
      caption: "对每月已有日帧的全球速率合计取平均。月份可以只有部分日帧，所选月的有值天数列在上方。",
      kind: "area", labels: axis, unit: carbonUnit, color, zoom: true, focus: selectedMonth,
      series: [{ name: "月均排放速率", values: axis.map(month => {
        const value = byMonth.get(month)?.value;
        return value === undefined || value === null ? null : value / carbonScale;
      }) }],
      sources: [gracedSource],
    },
    {
      id: "carbon-seasonal", label: "月度热力图", title: "各年同月的全球排放速率",
      caption: "颜色深浅表示月内有值日帧的平均速率。点击有值的格子更新月度指标。没有有效日帧的月份留空。",
      kind: "heatmap", labels: monthLabels, unit: carbonUnit, color, focus: selectedMonth?.slice(0, 4),
      focusCell: selectedMonth
        ? [Number(selectedMonth.slice(5)) - 1, [...new Set(dates.map(item => item.slice(0, 4)))].indexOf(selectedMonth.slice(0, 4))]
        : undefined,
      series: seasonalSeries(facts, carbonMetrics[0], dates, carbonScale), sources: [gracedSource],
    },
    {
      id: "emission-trend", label: "归档日度", title: "2025 年 8 月全球排放速率逐日变化",
      caption: "逐日合计 GRACED Power 全球格点排放速率，虚线标记所选日期。",
      kind: "area", labels: carbonLabels, unit: carbonUnit, color, focus: archiveFocus?.slice(5),
      series: [{ name: "排放速率合计", values: carbon.days.map(item => item.rate / carbonScale) }], sources: [gracedSource],
    },
    {
      id: "emission-calendar", label: "排放日历", title: "2025 年 8 月全球电力排放日历",
        caption: "每格代表一个归档日，颜色越深表示该日全球排放速率越高。可点日期格或用上方筛选切换所选日纬度图。",
      kind: "calendar", labels: carbonDates, unit: carbonUnit, color, focus: archiveFocus,
      series: [{ name: "排放速率合计", values: carbon.days.map(item => item.rate / carbonScale) }], sources: [gracedSource],
    },
    {
      id: "emission-latitude-heatmap", label: "纬度热力图", title: "一个月内排放的纬度分布",
      caption: "2025 年 8 月日帧。颜色表示各纬度带的格点排放速率合计。",
      kind: "heatmap", labels: carbonLabels, unit: carbonUnit, color,
      series: latitudeLabels.map((name, index) => ({ name, values: carbon.days.map(item => item.latitudeRates[index] / carbonScale) })),
      sources: [gracedSource],
    },
    {
      id: "emission-by-latitude", label: "所选日纬度", title: archiveFocus ? `${archiveFocus} 电力排放的纬度对比` : "所选日的电力排放纬度对比",
      caption: "每 30° 合计电力部门网格排放速率。纬度分布取自 2025 年 8 月归档。",
      kind: "horizontal", labels: latitudeLabels, unit: carbonUnit, color,
      series: [{ name: "排放速率合计", values: archiveFocus ? day.latitudeRates.map(value => value / carbonScale) : [] }], sources: [gracedSource],
    },
    {
      id: "emission-grid-count", label: "非零格点", title: "有排放的网格数量",
      caption: "按日统计速率大于零的格点，虚线标记所选日期。数据来自 2025 年 8 月归档。",
      kind: "line", labels: carbonLabels, unit: "个", color, focus: archiveFocus?.slice(5),
      series: [{ name: "非零格点", values: carbon.days.map(item => item.activeCells) }], sources: [gracedSource],
    },
  ];
  if (latestMonth) {
    const active = new Map(facts.filter(item => item.series === carbonMetrics[1]).map(item => [item.month, item.value]));
    charts.push({
      id: "carbon-grid-history", label: "格点长期变化", title: "长期月均非零格点数",
      caption: "对每月已有 GRACED Power 日帧的非零排放格点数取平均。",
      kind: "line", labels: axis, unit: "个", color, zoom: true,
      series: [{ name: "月均非零格点", values: axis.map(month => active.get(month) ?? null) }], sources: [gracedSource],
    });
  }
  return {
    scope: "GRACED Power · 全球 0.1° 网格 · " +
      (latestMonth ? "已发布日帧汇总 " + monthRange(dates) : "2025 年 8 月日度归档"),
    metrics: month || (latestMonth && !date) ? [
      metric(`${selectedMonth || "所选期"} 月均排放速率`, selectedPeriod?.value != null ? selectedPeriod.value / carbonScale
        : summary?.rate != null ? summary.rate / carbonScale : null, carbonUnit),
      metric("该月参与平均的日帧", selectedPeriod?.coverage ?? summary?.coverage ?? null, "天"),
      metric("有值月份", dates.length || (summary ? 1 : 0), "个月"),
    ] : [
      metric(`${date || day.date} 全球排放速率`,
        history ? daily?.rate == null ? null : daily.rate / carbonScale : selectedArchive || !date ? day.rate / carbonScale : null, carbonUnit),
      metric("非零排放格点", history ? daily?.grids ?? null : selectedArchive || !date ? day.activeCells : null, "个"),
      metric("北半球速率占比（归档）", !history && archiveFocus ? share : null, "%"),
    ],
    charts,
  };
}

const technologies = {
  wind: { name: "风电", color: "#11a998" },
  solar: { name: "光伏", color: "#e8a525" },
} as const;

export function buildRenewableAnalysis(
  data: RenewableScenario,
  regionId: string,
  year: number,
  technology: VreTechnology,
): Analysis {
  const region = data.regions.find(item => item.id === regionId) ?? data.regions[0];
  const observations = data.rows.filter(row => row.region === region.id);
  const years = [...new Set(observations.map(row => row.year))].sort((a, b) => a - b);
  const selectedYear = years.includes(year) ? year : years[years.length - 1];
  const annual = (key: VreTechnology) => new Map(observations.filter(row => row.technology === key).map(row => [row.year, row]));
  const byTechnology = { wind: annual("wind"), solar: annual("solar") };
  const yearObservations = data.rows.filter(row => row.year === selectedYear);
  const rowsByRegion = new Map(yearObservations.map(row => [row.region + "-" + row.technology, row]));
  const provinces = data.regions.flatMap(item => {
    const wind = rowsByRegion.get(item.id + "-wind");
    const solar = rowsByRegion.get(item.id + "-solar");
    if (item.id === "china" || !wind || !solar) return [];
    return [{ ...item, wind: wind.factor * 100, solar: solar.factor * 100, generation: (wind.generation + solar.generation) / 1000 }];
  });
  const percent = (value: number | null | undefined) => value === null || value === undefined ? null : value * 100;
  const color = technologies[technology].color;
  const selectedMonths = monthLabels.map((_, index) => percent(byTechnology[technology].get(selectedYear)?.monthly[index]));
  const monthDistributions = monthLabels.map((_, index) => distribution(years.map(item => percent(byTechnology[technology].get(item)?.monthly[index]))));
  return {
    scope: `${region.label} · ${years[0]}–${years.at(-1)} 年 · ${data.gcm.toUpperCase()} / ${data.scenario.toUpperCase()} 情景`,
    metrics: [
      metric(`${selectedYear} 风电年均容量因子`, percent(byTechnology.wind.get(selectedYear)?.factor), "%"),
      metric(`${selectedYear} 光伏年均容量因子`, percent(byTechnology.solar.get(selectedYear)?.factor), "%"),
      metric("情景覆盖年份", years.length, "年"),
    ],
    charts: [
      {
        id: "renewable-heatmap", label: "季节热力图", title: `${region.label}${technologies[technology].name}容量因子`, focus: String(selectedYear),
        caption: "每格为气候情景下该月的平均容量因子，可沿纵轴浏览多年季节变化。",
        kind: "heatmap", labels: monthLabels, unit: "%", color,
        series: years.map(item => ({
          name: String(item), values: monthLabels.map((_, index) => percent(byTechnology[technology].get(item)?.monthly[index])),
        })),
        sources: [scenarioSource],
      },
      {
        id: "renewable-distribution", label: "月度分布", title: `${region.label}${technologies[technology].name}各月容量因子分布`,
        caption: `按日历月汇总 ${years[0]}–${years.at(-1)} 年的情景月值。箱体为第 25–75 百分位，横线为中位数，须标出最低与最高值，菱形为 ${selectedYear} 年同月。`,
        kind: "boxplot", labels: monthLabels, unit: "%", color,
        series: [
          { name: "最低值", values: monthDistributions.map(item => item.minimum) },
          { name: "第 25 百分位", values: monthDistributions.map(item => item.lower) },
          { name: "中位数", values: monthDistributions.map(item => item.median) },
          { name: "第 75 百分位", values: monthDistributions.map(item => item.upper) },
          { name: "最高值", values: monthDistributions.map(item => item.maximum) },
          { name: `${selectedYear} 年`, values: selectedMonths, color: "#d38a38" },
          { name: "有效样本", values: monthDistributions.map(item => item.count), unit: "年" },
        ],
        sources: [scenarioSource],
      },
      {
        id: "renewable-complementarity", label: "风光互补", title: `${region.label} ${selectedYear} 年风光季节对比`,
        caption: "比较风电和光伏月均容量因子的峰谷月份。",
        kind: "area", labels: monthLabels, unit: "%", color,
        series: (["wind", "solar"] as const).map(key => ({
          ...technologies[key], values: monthLabels.map((_, index) => percent(byTechnology[key].get(selectedYear)?.monthly[index])),
        })),
        sources: [scenarioSource],
      },
      {
        id: "renewable-regions", label: "省际气泡图", title: `${selectedYear} 年各省风光资源对比`,
        caption: "横轴为风电、纵轴为光伏年均容量因子。紫色表示光伏容量因子高于风电。气泡面积随情景发电量增大，发电量采用数据集的装机假设。",
        kind: "bubble", labels: provinces.map(item => item.label), unit: "%", xUnit: "%", color, focus: region.label,
        categoryColors: provinces.map(item => item.solar > item.wind ? "#805ee2" : "#20b8bc"),
        sizes: provinces.map(item => item.generation), sizeName: "风光情景发电量", sizeUnit: "TWh",
        series: [
          { name: "风电年均容量因子", values: provinces.map(item => item.wind) },
          { name: "光伏年均容量因子", values: provinces.map(item => item.solar) },
        ],
        sources: [scenarioSource],
      },
      {
        id: "renewable-history", label: "四十年走势", title: `${region.label}风光容量因子多年走势`,
        caption: "逐年显示年均容量因子。采用同一气候模型与情景，虚线标记所选年份。",
        kind: "line", labels: years.map(String), unit: "%", color, focus: String(selectedYear), zoom: true,
        series: (["wind", "solar"] as const).map(key => ({
          ...technologies[key], values: years.map(item => percent(byTechnology[key].get(item)?.factor)),
        })),
        sources: [scenarioSource],
      },
    ],
  };
}
