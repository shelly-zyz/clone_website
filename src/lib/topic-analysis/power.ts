import { generationSeries } from "./history";
import { metric, type Analysis, type AnalysisChartSpec, type Source } from "./model";
import annual from "./nbs-annual.json";
import { researchColors, researchInk, type ResearchColor } from "./research-palette";

const tones = ["ice", "sage", "champagne", "lavender", "mint"] as const;
export const powerSources = generationSeries.slice(1).map(({ id, name }, index) => ({ id, name, tone: tones[index] }));
export const residualSource = { id: "other", name: "其他及口径差额", tone: "rose" } as const;
const composition = [...powerSources, residualSource];
export const powerChartIds = ["capacity-comparison", "capacity-mix", "capacity-waterfall", "renewable-capacity-share", "generation-by-source"] as const;
export type PowerChartId = typeof powerChartIds[number];
export const annualLabels = annual.map(row => String(row.year));
export const powerYears = annualLabels.toReversed();
export const officialAnnual = { label: "国家统计局 · 年度统计公报", href: "https://www.stats.gov.cn/sj/tjgb/ndtjgb/qgndtjgb/index.html" };
export const annualSource = (row: typeof annual[number]): Source => ({ label: `国家统计局 · ${row.year} 年统计公报`, href: row.source });

export function powerTone(name?: string): ResearchColor {
  return composition.find(source => source.name === name)?.tone ?? "ice";
}

const round = (value: number) => +value.toFixed(2);
const capacityParts = ([total, ...parts]: number[]) => [...parts, round(total - parts.reduce((sum, value) => sum + value, 0))];
export const powerRecords = annual.map((row, index) => {
  const prior = annual[index - 1];
  const parts = capacityParts(row.capacityGw);
  const priorParts = prior && capacityParts(prior.capacityGw);
  const capacity = row.capacityGw[0];
  return {
    year: String(row.year), capacity, generation: row.generationTwh[0], source: annualSource(row),
    change: prior ? round(capacity - prior.capacityGw[0]) : null,
    parts: composition.map((item, i) => ({ ...item, capacity: parts[i], generation: row.generationTwh[i + 1] ?? null,
      share: parts[i] / capacity * 100, change: priorParts ? round(parts[i] - priorParts[i]) : null })),
  };
});

export function powerYearRecord(year: string) {
  return powerRecords.find(row => row.year === year) ?? powerRecords[powerRecords.length - 1];
}

const capacitySeries = powerSources.map((part, index) => ({
  name: part.name, color: researchColors[part.tone].base, values: powerRecords.map(row => row.parts[index].capacity),
}));

function increaseChart(record: ReturnType<typeof powerYearRecord>, previous: ReturnType<typeof powerYearRecord> | undefined): AnalysisChartSpec {
  const positive = record.parts.filter(part => part.change !== null && part.change > 0);
  const negative = record.parts.filter(part => part.change !== null && part.change < 0);
  const net = record.change;
  const sources = previous ? [previous.source, record.source] : [record.source];
  const common = {
    id: "capacity-waterfall", label: "装机增量", title: "全国电源装机增量", color: researchColors.lavender.ink,
    unit: "GW", labels: [...record.parts.map(item => item.name), "净增量"],
    categoryColors: record.parts.map(part => researchColors[part.tone].base),
    series: [{ name: "较上年净变化", values: [...record.parts.map(item => item.change), net] }], sources,
  };
  if (net === null || net < 0) return {
    ...common, kind: "waterfall", caption: net === null ? "该年是序列起点，缺少上一年度的同口径数据。" : "有净减少的年份使用可表示负值的分项图。",
  };
  const junction = negative.length ? "增加小计" : "净增量";
  return {
    ...common, kind: "sankey",
    caption: `${previous?.year} → ${record.year} 年末。流带宽度对应实际变化量。${negative.length ? "减少项从增加小计中扣除，其余为净增量。" : "各类增加量汇入年度净增量。"}`,
    nodes: [
      ...positive.map(part => ({ name: part.name, value: part.change ?? 0, color: researchColors[part.tone].base })),
      { name: junction, value: round(positive.reduce((sum, part) => sum + (part.change ?? 0), 0)), color: researchColors.lavender.base },
      ...negative.map(part => ({ name: `${part.name}减少`, value: -(part.change ?? 0), color: researchColors[part.tone].base })),
      ...(negative.length && net > 0 ? [{ name: "净增量", value: net, color: researchColors.lavender.base }] : []),
    ],
    links: [
      ...positive.map(part => ({ source: part.name, target: junction, value: part.change ?? 0 })),
      ...negative.map(part => ({ source: junction, target: `${part.name}减少`, value: -(part.change ?? 0) })),
      ...(negative.length && net > 0 ? [{ source: junction, target: "净增量", value: net }] : []),
    ],
  };
}

export function buildPowerAnalysis(year: string): Analysis {
  const record = powerYearRecord(year);
  const previous = powerRecords.find(row => +row.year === +record.year - 1);
  const generation = record.parts.slice(0, 5).toSorted((a, b) => (b.generation ?? -Infinity) - (a.generation ?? -Infinity));
  const windSolarShare = record.parts[3].share + record.parts[4].share;
  const base = { color: researchInk, focus: record.year };
  return {
    scope: `中国全国 · ${annualLabels[0]}—${annualLabels.at(-1)} 年 · 国家统计局年度公报`,
    metrics: [
      metric(`${record.year} 年末发电装机`, record.capacity, "GW"),
      metric("较上年末净增", record.change, "GW"),
      metric("风电与太阳能装机占比", windSolarShare, "%"),
    ],
    charts: [
      {
        ...base, id: "capacity-comparison", label: "装机演变", title: "各类电源的装机扩张",
        caption: "曲带高度使用同一容量刻度，深度仅区分电源。圆点为年度公报观测，带面连接相邻年份。",
        kind: "area", labels: annualLabels, unit: "GW",
        series: capacitySeries, sources: powerRecords.map(row => row.source),
      },
      {
        ...base, id: "capacity-mix", label: "装机组成", title: "全国电源装机组成",
        caption: "扇区以全国年末装机总量为分母。其他项含未单列电源及统计口径和舍入差额。",
        kind: "donut", labels: record.parts.map(part => part.name), unit: "GW",
        categoryColors: record.parts.map(part => researchColors[part.tone].base),
        center: { label: "年末总装机", value: record.capacity, unit: "GW" },
        series: [{ name: "年末装机", values: record.parts.map(part => part.capacity) }], sources: [record.source, ...(previous ? [previous.source] : [])],
      },
      increaseChart(record, previous),
      {
        ...base, id: "renewable-capacity-share", label: "风光占比", title: "风电与太阳能的装机占比",
        caption: "分母为同年全国年末发电装机。点击任一年份的标记，可联动本页其他图。",
        kind: "area", labels: annualLabels, unit: "%",
        series: [3, 4].map(index => ({ name: record.parts[index].name, color: researchColors[record.parts[index].tone].base,
          values: powerRecords.map(row => row.parts[index].share) })), sources: powerRecords.map(row => row.source),
      },
      {
        ...base, id: "generation-by-source", label: "发电排行", title: "规上工业分电源发电量",
        caption: "按公报已单列的发电量排序，圆点位置与颜色同时编码发电量。未单列的记录保留为空。",
        kind: "horizontal", labels: generation.map(part => part.name), unit: "TWh",
        series: [{ name: "规上工业发电量", values: generation.map(part => part.generation) }],
        sources: [record.source, ...(previous ? [previous.source] : [])],
      },
    ],
  };
}

export const explorerMeasures = { capacity: ["年末装机", "GW"], change: ["年度净变化", "GW"], generation: ["规上工业发电量", "TWh"] } as const;
export function powerExplorer(measure: keyof typeof explorerMeasures, year: string, focus?: string): AnalysisChartSpec {
  const [label, unit] = explorerMeasures[measure];
  const series = powerSources.map((part, index) => ({
    name: part.name, values: powerRecords.map(row => row.parts[index][measure]),
  }));
  const row = series.findIndex(part => part.name === focus);
  return {
    id: "power-explorer", label, title: label, unit, caption: "空白表示无可比公报数据。", kind: "heatmap", labels: annualLabels,
    color: researchColors.lavender.base, series, sources: powerRecords.map(item => item.source),
    focusCell: row >= 0 ? [annualLabels.indexOf(year), row] : undefined,
  };
}
