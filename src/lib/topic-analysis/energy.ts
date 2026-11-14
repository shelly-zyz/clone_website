import { analysisTopics } from "./catalog";
import { fuelSeries, generationSeries, generationYoyMetric, type PublishedFact, type PublishedHistory, type RegionalGeneration } from "./history";
import { metric, relativeIndex, type Analysis, type AnalysisChartSpec, type Source } from "./model";
import annual from "./nbs-annual.json";
import monthly from "./nbs-monthly.json";

const officialAnnual = { label: "国家统计局 · 年度统计公报", href: "https://www.stats.gov.cn/sj/tjgb/ndtjgb/qgndtjgb/index.html" };
const officialMonthly = { label: "国家统计局 · 国家数据月度库", href: "https://data.stats.gov.cn/easyquery.htm?cn=A01" };
const officialProvincial = { label: "国家统计局 · 国家数据分省月度库", href: "https://data.stats.gov.cn/easyquery.htm?cn=E0101" };
const mix = generationSeries.slice(1);
const otherCapacity = { name: "其他及口径差额", color: "#668391" };
const annualLabels = annual.map(row => String(row.year));
export const powerYears = annualLabels.toReversed();
export const monthLabels = Array.from({ length: 12 }, (_, index) => `${index + 1} 月`);
export type GenerationProduct = typeof generationSeries[number]["id"];
export type Fuel = typeof fuelSeries[number]["id"];

const monthKey = (year: string, index: number) => `${year}-${String(index + 1).padStart(2, "0")}`;
const sortedDates = (dates: string[]) => [...new Set(dates)].sort();

export function observationMonths(facts: PublishedFact[], series: string) {
  return sortedDates(facts.filter(item => item.series === series && item.value !== null).map(item => item.month));
}

export function monthAxis(observations: readonly string[]) {
  if (!observations.length) return [];
  const first = observations[0];
  const last = observations[observations.length - 1];
  const years = Array.from({ length: Number(last.slice(0, 4)) - Number(first.slice(0, 4)) + 1 },
    (_, index) => String(Number(first.slice(0, 4)) + index));
  return years.flatMap(year => monthLabels.map((_, index) => monthKey(year, index)))
    .filter(month => month >= first && month <= last);
}

export function monthRange(dates: readonly string[]) {
  return dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : "暂无有效观测";
}

export function seasonalSeries(facts: PublishedFact[], series: string, dates: string[], scale = 1) {
  const byMonth = new Map(facts.filter(row => row.series === series).map(row => [row.month, row.value]));
  return sortedDates(dates.map(month => month.slice(0, 4))).map(year => ({
    name: year,
    values: monthLabels.map((_, index) => {
      const value = byMonth.get(monthKey(year, index));
      return value === undefined || value === null ? null : value / scale;
    }),
  }));
}

function annualSource(row: typeof annual[number]): Source {
  return { label: `国家统计局 · ${row.year} 年统计公报`, href: row.source };
}

function capacityValues(row: typeof annual[number]) {
  const [total, ...parts] = row.capacityGw;
  const residual = total - parts.reduce((sum, value) => sum + value, 0);
  return [...parts, +residual.toFixed(2)];
}

export function buildPowerAnalysis(year: string): Analysis {
  const data = annual.find(row => String(row.year) === year) ?? annual[annual.length - 1];
  const previous = annual.find(row => row.year === data.year - 1);
  const color = analysisTopics.power.color;
  const windSolarShare = (data.capacityGw[4] + data.capacityGw[5]) / data.capacityGw[0] * 100;
  const composition = [...mix, otherCapacity];
  const capacity = capacityValues(data);
  const priorCapacity = previous ? capacityValues(previous) : [];
  const generation = mix.map(({ name, color }, index) => ({ name, color, value: data.generationTwh[index + 1] }))
    .toSorted((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return {
    scope: `中国全国 · 国家统计局年度公报 · ${annualLabels[0]}–${annualLabels.at(-1)} 年`,
    metrics: [
      metric(`${data.year} 年末发电装机`, data.capacityGw[0], "GW"),
      metric(`${data.year} 年规上工业发电量`, data.generationTwh[0], "TWh"),
      metric("风电与太阳能装机占比", windSolarShare, "%"),
    ],
    charts: [
      {
        id: "capacity-share", label: "装机占比环图", title: `${data.year} 年风光装机占比`,
        caption: "环心显示风电与太阳能占全国年末装机的比重。环段按各电源容量划分，末项为公报总量与已列分项之差。",
        kind: "donut", labels: composition.map(item => item.name), categoryColors: composition.map(item => item.color),
        unit: "GW", color, center: { label: "风光装机占比", value: windSolarShare, unit: "%" },
        series: [{ name: "年末装机", values: capacity }], sources: [annualSource(data)],
      },
      {
        id: "capacity-waterfall", label: "装机增量", title: `${data.year} 年全国电源装机增量`,
        caption: previous
          ? `与 ${previous.year} 年末相比，柱段显示各电源净变化，最后一柱为全国装机净增量。其他项含公报口径与四舍五入差额。`
          : "年度增量需要连续两年公报。请选择 2021 年及以后的统计年份。",
        kind: "waterfall", labels: [...mix.map(item => item.name), "其他", "净增量"], unit: "GW", color,
        categoryColors: composition.map(item => item.color),
        series: [{ name: "较上年变化", values: previous
          ? [...capacity.map((value, index) => +(value - priorCapacity[index]).toFixed(2)), +(data.capacityGw[0] - previous.capacityGw[0]).toFixed(2)]
          : Array.from({ length: composition.length + 1 }, () => null) }],
        sources: previous ? [annualSource(previous), annualSource(data)] : [annualSource(data)],
      },
      {
        id: "capacity-mix", label: "装机组成", title: `${data.year} 年全国电源装机组成`,
        caption: "面积表示公报列出的五类电源装机。风电、太阳能按各年度公报的统计口径展示。",
        kind: "treemap", labels: mix.map(item => item.name), categoryColors: mix.map(item => item.color), unit: "GW", color,
        series: [{ name: "年末装机", values: data.capacityGw.slice(1) }], sources: [annualSource(data)],
      },
      {
        id: "capacity-comparison", label: "多年变化", title: "各类电源的装机扩张",
        caption: "各色面积的厚度表示该类电源当年的年末装机，虚线标记所选年份。",
        kind: "stacked-area", labels: annualLabels, unit: "GW", color, focus: String(data.year),
        series: mix.map((item, index) => ({
          name: item.name, color: item.color, values: annual.map(row => row.capacityGw[index + 1]),
        })),
        sources: [officialAnnual, annualSource(data)],
      },
      {
        id: "generation-by-source", label: "发电排行", title: `${data.year} 年规上工业分电源发电量`,
        caption: "按统计公报列出的发电量排序。公报未单列的电源在数据表中留空。",
        kind: "horizontal", labels: generation.map(({ name }) => name),
        categoryColors: generation.map(item => item.color), unit: "TWh", color,
        series: [{ name: "规上工业发电量", values: generation.map(item => item.value) }], sources: [annualSource(data)],
      },
      {
        id: "renewable-capacity-share", label: "风光占比", title: "风电与太阳能的装机占比",
        caption: "用各类电源的年末容量除以同年全国发电装机容量。",
        kind: "area", labels: annualLabels, unit: "%", color, focus: String(data.year),
        series: [
          { name: "风电", color: mix[3].color, values: annual.map(row => row.capacityGw[4] / row.capacityGw[0] * 100) },
          { name: "太阳能", color: mix[4].color, values: annual.map(row => row.capacityGw[5] / row.capacityGw[0] * 100) },
        ],
        sources: [officialAnnual, annualSource(data)],
      },
    ],
  };
}

const monthlyFacts: PublishedFact[] = monthly.flatMap(row => Object.entries(row.values).map(([series, value]) => ({
  month: row.date, series, value, coverage: 1,
})));

export function generationMonths(history: PublishedHistory | null, product: GenerationProduct) {
  return observationMonths(history?.facts ?? monthlyFacts, product);
}

export function buildGenerationAnalysis(
  product: GenerationProduct,
  selectedMonth: string,
  history: PublishedHistory | null,
  regional: RegionalGeneration | null,
): Analysis {
  const selected = generationSeries.find(item => item.id === product) ?? generationSeries[0];
  const facts = history?.facts ?? monthlyFacts;
  const dates = generationMonths(history, product);
  const date = dates.includes(selectedMonth) ? selectedMonth : dates.at(-1) ?? "";
  const axis = monthAxis(dates);
  const monthData = new Map(facts.filter(row => row.month === date).map(row => [row.series, row.value]));
  const current = monthData.get(product) ?? null;
  const publicReport = monthly.find(row => row.date === date);
  const yoy = history
    ? product === "electricity" ? monthData.get(generationYoyMetric) ?? null : null
    : publicReport?.yoy[product] ?? null;
  const byMonth = new Map(facts.filter(row => row.series === product).map(row => [row.month, row.value]));
  const source = publicReport?.source;
  const sources: Source[] = history || !source ? [officialMonthly] : [
    { label: `国家统计局 · ${date} 工业生产月报`, href: source },
    { label: "国家统计局 · 工业生产月报索引", href: "https://www.stats.gov.cn/sj/zxfb/" },
  ];
  const unit = "亿千瓦时";
  const regions = regional?.month === date ? regional.regions.slice(0, 12) : [];
  const breakdown = mix.map(item => ({
    name: item.name, color: item.color, value: monthData.get(item.id) ?? null,
    renewable: item.id === "hydro-power" || item.id === "wind-power" || item.id === "solar-power",
  }));
  const available = breakdown.flatMap(item => item.value !== null && item.value > 0 ? [{ ...item, value: item.value }] : []);
  const total = available.reduce((sum, item) => sum + item.value, 0);
  const renewable = available.reduce((sum, item) => sum + (item.renewable ? item.value : 0), 0);
  const reported = "已公布分项";
  const renewableName = "可再生电源";
  return {
    scope: `中国全国 · ${history ? "数据库已发布月度统计" : "国家统计局公开月报选录"} · ${monthRange(dates)}`,
    metrics: [
      metric(`${date || "所选月"} ${selected.name}`, current, unit),
      metric("官方发布同比增速", yoy, "%"),
      metric("有值月份", dates.length, "个月"),
    ],
    charts: [
      {
        id: "generation-flow", label: "电源流向", title: `${date || "所选月"} 发电量来源分解`,
        caption: "线宽表示各电源已公布的单月发电量。水电、风电与太阳能归入可再生电源。起点为图中分项之和，分项缺测在表中留空。",
        kind: "sankey", labels: breakdown.map(item => item.name), unit, color: generationSeries[0].color,
        series: [{ name: "当月发电量", values: breakdown.map(item => item.value) }],
        nodes: [
          ...(total > 0 ? [{ name: reported, value: total, color: generationSeries[0].color }] : []),
          ...(renewable > 0 ? [{ name: renewableName, value: renewable, color: "#25ada0" }] : []),
          ...available.map(({ name, value, color }) => ({ name, value, color })),
        ],
        links: [
          ...(renewable > 0 ? [{ source: reported, target: renewableName, value: renewable }] : []),
          ...available.map(item => ({
            source: item.renewable ? renewableName : reported, target: item.name, value: item.value,
          })),
        ],
        sources,
      },
      {
        id: "generation-seasonal", label: "月度热力图", title: `${selected.name}的季节分布`, focus: date.slice(0, 4),
        caption: "每格对应一个月份。留空表示没有可用的单月数据，1–2 月合报不拆分。",
        kind: "heatmap", labels: monthLabels, unit, color: selected.color,
        series: seasonalSeries(facts, product, dates), sources,
      },
      {
        id: "generation-history", label: "长期走势", title: `${selected.name}月度走势`,
        caption: "横轴保留实际日历月份。可用图下时间滑块查看不同区间。",
        kind: "area", labels: axis, unit, color: selected.color, focus: date, zoom: true,
        series: [{ name: selected.name, values: axis.map(month => byMonth.get(month) ?? null) }], sources,
      },
      {
        id: "monthly-mix", label: "当月电源", title: `${date || "所选月"} 分电源发电量`,
        caption: "比较同月已发布的五类电源本期发电量。",
        kind: "treemap", labels: mix.map(item => item.name), categoryColors: mix.map(item => item.color), unit, color: selected.color,
        series: [{ name: "当月发电量", values: mix.map(item => monthData.get(item.id) ?? null) }], sources,
      },
      {
        id: "province-ranking", label: "省际比较", title: `${date || "所选月"} 各省发电量`,
        caption: "按同一发布版本、同一月的各省发电量合计排序。最多显示前 12 个省级地区，来源缺测保留为空。",
        kind: "horizontal", labels: regions.map(row => row.name),
        unit, color: selected.color,
        series: [{ name: "发电量合计", values: regions.map(row => row.value) }],
        sources: [officialProvincial],
      },
    ],
  };
}

export function buildFuelAnalysis(fuel: Fuel, history: PublishedHistory | null): Analysis {
  const selected = fuelSeries.find(item => item.id === fuel) ?? fuelSeries[0];
  const values = annual.map(row => row.fuels[fuel].value);
  const latest = annual[annual.length - 1];
  const observations = history?.facts ?? monthlyFacts;
  const dates = observationMonths(observations, fuel);
  const axis = monthAxis(dates);
  const byMonth = new Map(observations.filter(row => row.series === fuel).map(row => [row.month, row.value]));
  const charts: AnalysisChartSpec[] = [
    {
      id: "fuel-index", label: "相对变化", title: "三类能源产量相对变化",
      caption: `各自以 ${annualLabels[0]} 年为 100。比较相对变化幅度时消除了产量单位差异。`,
      kind: "line", labels: annualLabels, unit: "指数", color: selected.color,
      series: fuelSeries.map(item => ({
        name: item.name, color: item.color,
        values: annual.map(row => relativeIndex(row.fuels[item.id].value, annual[0].fuels[item.id].value)),
      })),
      sources: [officialAnnual],
    },
    {
      id: "fuel-production", label: "年度产量", title: `${selected.name}年度产量`,
      caption: "采用各年统计公报的年度发布值。",
      kind: "area", labels: annualLabels, unit: selected.annualUnit, color: selected.color,
      series: [{ name: selected.name, values }], sources: [officialAnnual, annualSource(latest)],
    },
    {
      id: "fuel-yoy", label: "年度增速", title: `${selected.name}产量同比增速`,
      caption: "图中为各年度公报公布的同比增速，公报可能使用可比口径调整上年基数。",
      kind: "column", labels: annualLabels, unit: "%", color: selected.color,
      series: [{ name: "同比增速", values: annual.map(row => row.fuels[fuel].yoy) }],
      sources: [officialAnnual, annualSource(latest)],
    },
    {
      id: "fuel-monthly", label: "月度历史", title: `${selected.name}月度产量`,
      caption: (history ? "按数据库已发布的月度本期值绘制。" : "按国家统计局工业生产月报选录绘制。") + "留空的月份无有效单月数据。",
      kind: "area", labels: axis, unit: selected.monthlyUnit, color: selected.color, zoom: true,
      series: [{ name: selected.name, values: axis.map(month => byMonth.get(month) ?? null) }],
      sources: history ? [officialMonthly] : [
        { label: "国家统计局 · 工业生产月报索引", href: "https://www.stats.gov.cn/sj/zxfb/" },
        { label: "国家统计局 · 末期报告 " + dates.at(-1), href: monthly[monthly.length - 1].source },
      ],
    },
    {
      id: "fuel-change", label: "产量增量", title: `${selected.name}历年产量净变化`,
      caption: "逐年用本年公报产量减去上年公报产量。正负柱分别表示增减，最后一柱为全期净变化量。",
      kind: "waterfall", labels: [...annualLabels.slice(1), "净变化"], unit: selected.annualUnit, color: selected.color,
      series: [{ name: "产量变化", values: [
        ...values.slice(1).map((value, index) => +(value - values[index]).toFixed(2)),
        +(values[values.length - 1] - values[0]).toFixed(2),
      ] }],
      sources: [officialAnnual, annualSource(latest)],
    },
  ];
  return {
    scope: `中国全国 · ${annualLabels[0]}–${annualLabels.at(-1)} 年官方统计公报` +
      (dates.length ? " · " + (history ? "发布库月度 " : "公开月报选录 ") + monthRange(dates) : ""),
    metrics: [
      metric(`${latest.year} 年${selected.name}产量`, latest.fuels[fuel].value, selected.annualUnit),
      metric("公报同比增速", latest.fuels[fuel].yoy, "%"),
      metric("有值月份", dates.length ? dates.length : null, "个月"),
    ],
    charts,
  };
}
