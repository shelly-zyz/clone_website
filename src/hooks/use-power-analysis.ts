import { useMemo } from "react";
import { chinaProvinces } from "@/lib/china-provinces";
import { chinaPowerAnnualFrame, chinaPowerMonthlyDemoFrame, type ProvincePowerFrame } from "@/lib/china-power-statistics";
import {
  capacityUnit, cumulativePowerSeries, emberSource, generationUnit, nationalPowerCode, powerAnalysisMapFrame,
  powerHistoricalExtent, powerMeasureLabels, powerProductAmount, powerSeriesKeys, powerSources, previousPowerYear, readEmberSeries,
  readPowerMeasure, yearbookCapacity, yearbookGeneration, type EmberArchive, type PowerGrain, type PowerMeasure,
  type PowerObservation, type PowerPeriod, type PowerSeries,
} from "@/lib/power-analysis";
import { generationSeries, generationYoyMetric, type RegionalGeneration } from "@/lib/topic-analysis/history";
import officialMonthly from "@/lib/topic-analysis/nbs-monthly.json";
import type { WorkspaceContext } from "@/lib/workspace-context";
import { useReportedGeneration } from "./use-reported-generation";
import { useWorkspaceResource } from "./use-workspace-resource";

const emptySeries: PowerSeries = {};
const emptyFrame: PowerPeriod = {};
const yearbook = chinaPowerAnnualFrame("generation");
const capacityBook = chinaPowerAnnualFrame("capacity");

const officialArchive: PowerSeries = Object.fromEntries(officialMonthly.map(row => {
  const value = row.values;
  return [row.date, { [nationalPowerCode]: {
    total: value.electricity, reportedGrowth: row.yoy.electricity,
    mix: { thermal: value["thermal-power"], hydro: value["hydro-power"], nuclear: value["nuclear-power"], wind: value["wind-power"], solar: value["solar-power"] },
  } satisfies PowerObservation }];
}));

export function usePowerAnalysis(enabled: boolean, context: WorkspaceContext) {
  const capacity = context.powerView === "capacity";
  const product = capacity ? generationSeries[0] : generationSeries.find(item => item.id === context.product) ?? generationSeries[0];
  const grain: PowerGrain = capacity ? "annual" : context.powerPeriod ?? (context.month || context.version || context.powerDemo ? "monthly" : "annual");
  const demo = !capacity && grain === "monthly" && context.powerDemo === "monthly";
  const source: NonNullable<WorkspaceContext["powerSource"]> = capacity ? "yearbook" : grain === "annual"
    ? context.powerSource === "yearbook" ? "yearbook" : "ember"
    : grain === "monthly" && (context.powerSource === "nbs" || (!context.powerSource && (context.month || context.version))) ? "nbs" : "ember";
  const archive = useWorkspaceResource<EmberArchive>(enabled && !demo && source === "ember"
    ? "/data/china-power/ember-" + (grain === "annual" ? "annual" : "monthly") + ".json" : null);
  const official = useReportedGeneration(enabled && !demo && source === "nbs", context.month, product.id, context.version);
  const emberSeries = useMemo(() => {
    if (!archive.data) return emptySeries;
    const input = readEmberSeries(archive.data);
    return grain === "ytd" ? cumulativePowerSeries(input) : input;
  }, [archive.data, grain]);

  const officialSeries = useMemo<PowerSeries>(() => {
    if (context.version && !official.published) return emptySeries;
    if (!official.published) return officialArchive;
    const periods: Record<string, PowerPeriod> = {};
    const byMonth = Map.groupBy(official.published.facts, row => row.month);
    for (const [period, rows] of byMonth) {
      const facts = new Map(rows.map(row => [row.series, row.value]));
      periods[period] = { [nationalPowerCode]: {
        total: facts.get("electricity") ?? null, reportedGrowth: facts.get(generationYoyMetric),
        mix: {
          thermal: facts.get("thermal-power"), hydro: facts.get("hydro-power"), nuclear: facts.get("nuclear-power"),
          wind: facts.get("wind-power"), solar: facts.get("solar-power"),
        },
      } };
    }
    return periods;
  }, [context.version, official.published]);

  const history = demo ? emptySeries : source === "yearbook" ? capacity ? yearbookCapacity : yearbookGeneration
    : source === "ember" ? emberSeries : officialSeries;
  const periods = useMemo(() => {
    const keys = powerSeriesKeys(history).filter(key =>
      Object.values(history[key]).some(row => powerProductAmount(row, product.id) !== null));
    const extra = source === "nbs" && !demo
      ? [context.month, official.latestRegionalMonth].filter((value): value is string => Boolean(value))
      : [];
    return [...new Set([...keys, ...extra])].sort();
  }, [context.month, demo, history, official.latestRegionalMonth, product.id, source]);

  const wanted = grain === "annual" ? String(context.year ?? "") : context.month;
  const period = demo ? context.month ?? "2025-12"
    : source === "nbs" ? official.month || periods.at(-1) || "" : wanted || periods.at(-1) || "";
  const previous = previousPowerYear(period);
  const referenceOptions = periods.filter(key => key !== period &&
    (!(grain === "ytd" || source === "nbs") || key.slice(4) === period.slice(4)));
  const reference = context.powerReference && referenceOptions.includes(context.powerReference) ? context.powerReference
    : referenceOptions.includes(previous) ? previous : referenceOptions.filter(key => key < period).at(-1) ?? referenceOptions[0] ?? "";
  const version = official.published?.version;
  const regionPath = (date: string) => enabled && source === "nbs" && !demo && version && date
    ? "/api/topic-analysis?topic=generation&month=" + date + "&version=" + version + "&product=" + product.id : null;
  const comparison = useWorkspaceResource<RegionalGeneration>(regionPath(reference));
  const prior = useWorkspaceResource<RegionalGeneration>(regionPath(previous !== reference ? previous : ""));
  const { current, previousFrame, referenceFrame, analysisHistory } = useMemo(() => {
    if (source !== "nbs" || demo) return {
      current: history[period] ?? emptyFrame, previousFrame: history[previous], referenceFrame: history[reference], analysisHistory: history,
    };
    const map = { ...history };
    for (const entry of [official.regional, comparison.data, prior.data]) {
      if (!entry?.month) continue;
      map[entry.month] = {
        ...map[entry.month],
        ...Object.fromEntries(entry.regions.map(({ code, value }) => [code, product.id === "electricity" ? { total: value }
          : { total: null, mix: { [{
            "wind-power": "wind", "solar-power": "solar", "thermal-power": "thermal", "hydro-power": "hydro", "nuclear-power": "nuclear",
          }[product.id]]: value } }])),
      };
    }
    return {
      current: map[period] ?? emptyFrame, previousFrame: map[previous], referenceFrame: map[reference], analysisHistory: map,
    };
  }, [comparison.data, demo, history, official.regional, period, previous, prior.data, product.id, reference, source]);

  const available: PowerMeasure[] = ["total"];
  if (!demo) {
    const observations = Object.entries(current);
    if (observations.some(([code, row]) => readPowerMeasure("growth", row, previousFrame?.[code], undefined, product.id) != null)) available.push("growth");
    if (observations.some(([code, row]) => readPowerMeasure("change", row, undefined, referenceFrame?.[code], product.id) != null)) available.push("change");
    if (source === "ember" && !capacity && product.id === "electricity") {
      for (const key of ["clean", "windsolar"] as const) {
        if (observations.some(([, row]) => readPowerMeasure(key, row) != null)) available.push(key);
      }
    }
  }
  const measure = context.powerMeasure && available.includes(context.powerMeasure) ? context.powerMeasure : "total";
  const valueUnit = capacity ? capacityUnit : generationUnit;
  const label = measure === "total" ? capacity ? "年末装机容量" : product.name : powerMeasureLabels[measure];
  const peak = useMemo(() => Math.max(0, ...Object.values(history).flatMap(frame =>
    chinaProvinces.map(({ code }) => powerProductAmount(frame[code], product.id) ?? 0))), [history, product.id]);
  const regionalScale = source === "nbs" ? official.regional?.scaleMax ?? 0 : peak;
  const sharedScale = Math.max(regionalScale, ...chinaProvinces.flatMap(({ code }) =>
    [powerProductAmount(current[code], product.id) ?? 0, powerProductAmount(referenceFrame?.[code], product.id) ?? 0]));

  const historicalExtent = useMemo(() => powerHistoricalExtent(history, product.id, grain === "ytd"), [history, product.id, grain]);
  const growthScale = source === "nbs" ? 100 : historicalExtent.growthLimit;
  const changeScale = source === "nbs" ? sharedScale : historicalExtent.changeLimit;
  const scaleMax = measure === "total" ? sharedScale : measure === "growth" ? growthScale : measure === "change" ? changeScale : undefined;

  const frame = useMemo(() => demo ? {
    ...chinaPowerMonthlyDemoFrame(period, product.id), encoding: "sequential" as const,
  } : powerAnalysisMapFrame({
    current, previous: previousFrame, reference: referenceFrame, period, grain, measure, product: product.id,
    valueUnit, scaleMax, label,
  }), [current, demo, grain, label, measure, period, previousFrame, product.id, referenceFrame, scaleMax, valueUnit]);

  const view = measure === "change" ? "total" : measure;
  const hasComparison = Boolean(referenceFrame && chinaProvinces.some(({ code }) => powerProductAmount(referenceFrame[code], product.id) != null)
    && chinaProvinces.some(({ code }) => powerProductAmount(current[code], product.id) != null));
  const split = useMemo<{ a: ProvincePowerFrame; b: ProvincePowerFrame } | undefined>(() => {
    if (context.powerPresentation !== "split" || !reference || !referenceFrame || !hasComparison || demo) return;
    const common = { grain, measure: view, product: product.id, valueUnit, label: view === "total" ? capacity ? capacityBook.label : product.name : powerMeasureLabels[view] };
    const b = powerAnalysisMapFrame({ ...common, current, previous: previousFrame, period, scaleMax: view === "total" ? sharedScale : view === "growth" ? growthScale : undefined });
    const a = powerAnalysisMapFrame({
      ...common, current: referenceFrame, previous: analysisHistory[previousPowerYear(reference)], period: reference, scaleMax: b.scaleMax,
    });
    const max = Math.max(a.scaleMax, b.scaleMax);
    return { a: { ...a, scaleMax: max }, b: { ...b, scaleMax: max } };
  }, [analysisHistory, capacity, context.powerPresentation, current, demo, grain, growthScale, hasComparison, period, previousFrame, product, reference, referenceFrame, sharedScale, valueUnit, view]);

  const note = demo ? "人工合成，禁止用于分析。"
    : source === "ember" ? "第三方结合多源统计与模型估算；光伏及月度拆分的估算成分较高。"
    : source === "yearbook" ? capacity ? "年末存量。双期差值是装机净变化，不等于当期投产量。" : "年鉴年度统计；与规上工业月报分开比较。"
    : "规模以上工业。全国优先使用已发布同比，分省按两期发布值计算，调查范围变化可能影响结果。1–2 月通常合并，双期仅比较相同月份。";
  const sourceHref = source === "ember" ? emberSource : source === "yearbook" ? yearbook.source
    : (!official.published && !context.version ? officialMonthly.find(item => item.date === period)?.source : undefined)
      ?? "https://data.stats.gov.cn/easyquery.htm?cn=E0101";
  const sourceDetail = source === "ember" ? archive.data?.release : source === "yearbook" ? (capacity ? capacityBook.table : yearbook.table)
    : official.published?.publishedAt?.slice(0, 10);

  const pending = enabled && (source === "ember" ? archive.pending : source === "nbs" && !demo && (official.publishedPending || official.regionalPending));
  return {
    capacity, product, grain, demo, source, frame, split, period, periods, reference, referenceOptions, available, measure,
    valueUnit, history: analysisHistory, current, previousFrame, referenceFrame, note, sourceHref, sourceDetail,
    sourceLabel: powerSources[source], version, pending, referencePending: comparison.pending,
    missingArchive: enabled && source === "ember" && !archive.pending && !archive.data,
    missingVersion: official.versionUnavailable, latestRegionalMonth: official.latestRegionalMonth,
    coverage: frame.regions.filter(row => row.value != null).length,
    referenceCoverage: chinaProvinces.filter(({ code }) => referenceFrame?.[code] && powerProductAmount(referenceFrame[code], product.id) != null).length,
    national: readPowerMeasure(measure, current[nationalPowerCode], previousFrame?.[nationalPowerCode], referenceFrame?.[nationalPowerCode], product.id),
  };
}

export type PowerAnalysis = ReturnType<typeof usePowerAnalysis>;
