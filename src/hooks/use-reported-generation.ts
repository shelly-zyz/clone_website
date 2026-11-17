import { generationMonths } from "@/lib/topic-analysis/energy";
import { generationSeries, generationYoyMetric, type PublishedHistory, type RegionalGeneration } from "@/lib/topic-analysis/history";
import { useWorkspaceResource } from "./use-workspace-resource";

type GenerationProduct = typeof generationSeries[number]["id"];

export function useReportedGeneration(enabled: boolean, selectedMonth: string | undefined, product: GenerationProduct, version?: string) {
  const resource = useWorkspaceResource<PublishedHistory>(enabled
    ? "/api/topic-analysis?topic=generation" + (version ? "&version=" + version : "")
    : null);
  const published = resource.data?.facts.some(row => row.series === "electricity" && row.value !== null) ? resource.data : null;
  const path = enabled && published
    ? `/api/topic-analysis?topic=generation&month=${selectedMonth ?? "latest"}&version=${published.version}&product=${product}`
    : null;
  const regional = useWorkspaceResource<RegionalGeneration>(path);

  const availableMonths = version && !published ? [] : generationMonths(published, product);
  const pending = resource.pending || regional.pending;
  const fallbackMonth = pending ? "" : availableMonths.at(-1) ?? "";
  const month = selectedMonth ?? (regional.data?.month || fallbackMonth);
  const latestRegionalMonth = regional.data?.latestRegionalMonth ?? null;
  const months = [...new Set([...availableMonths, month, latestRegionalMonth ?? ""].filter(Boolean))].sort();
  const byType = new Map(published?.facts.filter(row => row.month === month).map(row => [row.series, row.value]));

  return {
    month, months, published, regional: regional.data, regionalPending: regional.pending, latestRegionalMonth,
    publishedPending: resource.pending,
    regionalUnavailable: enabled && !pending && !regional.data,
    versionUnavailable: !!version && !resource.pending && !published,
    total: byType.get("electricity"),
    yoy: byType.get(generationYoyMetric),
    composition: generationSeries.slice(1).map(item => ({ ...item, value: byType.get(item.id) ?? null })),
  };
}
