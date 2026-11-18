import { z } from "zod";
import { findChinaProvince } from "@/lib/china-provinces";
import { readWorkspaceContext } from "@/lib/workspace-context";
import { detectSiteView, resolveSiteNavigation, siteNavigationSchema, siteViewCatalog, siteViewIdSchema, type SiteViewId } from "./site-views";

const section = z.string().regex(/^[a-z][a-z0-9-]{1,55}$/);
const version = z.string().regex(/^[0-9a-f]{64}$/);
const iso = z.string().regex(/^[A-Z]{3}$/);
const province = siteNavigationSchema.shape.filters.unwrap().shape.region.unwrap();
const month = siteNavigationSchema.shape.filters.unwrap().shape.month.unwrap();
const date = z.iso.date();

export const activePageSchema = z.strictObject({
  view: siteViewIdSchema,
  search: z.string().max(1200).regex(/^(?:\?[^#]*)?$/),
  section: section.optional(),
  dataVersion: version.optional(),
});
export type ActivePage = z.infer<typeof activePageSchema>;

export const mapViews = ["globe-power", "globe-carbon", "globe-weather", "globe-economy"] as const;
const layerChange = z.strictObject({ id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,24}$/), visible: z.boolean() });
export const mapPatchSchema = z.strictObject({
  read: z.literal(true).optional(),
  view: z.enum(mapViews).optional(),
  place: z.string().trim().min(1).max(32).optional(),
  projection: z.enum(["map", "globe"]).optional(),
  powerView: z.enum(["facilities", "generation", "capacity"]).optional(),
  replay: z.enum(["globe", "weather", "time", "rain", "accumulation"]).optional(),
  layers: z.array(layerChange).min(1).max(32).optional(),
});

export const filterPatchSchema = z.strictObject({
  ...siteNavigationSchema.shape.filters.unwrap().partial().shape,
  source: siteNavigationSchema.shape.filters.unwrap().shape.source.nullable(),
  version: version.optional(),
  grain: z.enum(["day", "month"]).optional(),
  compareRegion: province.nullable().optional(),
  compareDate: date.nullable().optional(),
  compareMonth: month.nullable().optional(),
  compareCountry: iso.nullable().optional(),
  compareThird: iso.nullable().optional(),
  comparisonMode: z.enum(["value", "growth", "index"]).optional(),
});

const extraFilters: Partial<Record<SiteViewId, readonly string[]>> = {
  generation: ["version", "compareRegion"],
  fuels: ["version"],
  carbon: ["version", "grain", "compareDate", "compareMonth"],
  economy: ["compareCountry", "compareThird", "comparisonMode", "indicator"],
  trade: ["compareCountry", "compareThird", "comparisonMode"],
  outlook: ["compareCountry", "compareThird"],
  "weather-replay": ["id", "version"],
};

const mapKeys: Record<(typeof mapViews)[number], readonly (keyof ReturnType<typeof readWorkspaceContext>)[]> = {
  "globe-power": ["region", "year", "month", "product", "camera", "version", "projection", "powerView", "powerPeriod", "powerDemo", "powerPresentation", "powerPalette", "powerSource", "powerReference", "powerMeasure", "powerPeers", "basemap", "layers", "tech", "labels", "minMw"],
  "globe-weather": ["camera", "year", "region", "scene", "technology", "weather", "replay", "replayFrame", "replayPoint", "replayRegion"],
  "globe-carbon": ["region", "country", "year", "tradeDirection", "date", "compareDate", "grid", "camera", "sector", "projection", "basemap"],
  "globe-economy": ["country", "year", "targetYear", "scene", "metric", "camera", "basemap"],
};

export function isMapView(view?: SiteViewId): view is (typeof mapViews)[number] {
  return mapViews.some(item => item === view);
}

export function readActivePage(pathname: string, search: string, hash: string) {
  const active = activePageSchema.safeParse({
    view: detectSiteView(pathname, search), search,
    section: section.safeParse(hash.slice(1)).data,
  });
  return active.data;
}

export function registeredFilterKeys(view: SiteViewId) {
  const entry = siteViewCatalog().find(item => item.view === view);
  return [...Object.keys(entry?.filters ?? {}), ...extraFilters[view] ?? []];
}

export function pageLocation(page: ActivePage) {
  const target = resolveSiteNavigation({ view: page.view });
  if (!target) return;
  const url = new URL(target.href, "https://site.invalid");
  const source = new URLSearchParams(page.search);
  if (isMapView(page.view)) {
    const context = readWorkspaceContext(source);
    for (const key of mapKeys[page.view]) {
      if (context[key] !== undefined) url.searchParams.set(key, String(context[key]));
    }
  } else {
    const view = siteViewIdSchema.safeParse(page.view.replace(/^custom-/, "")).data ?? page.view;
    for (const key of registeredFilterKeys(view)) {
      const value = source.get(key);
      if (value === null) continue;
      if (key === "id" || key === "indicator") {
        if (/^[a-zA-Z0-9_-]{1,48}$/.test(value)) url.searchParams.set(key, value);
        continue;
      }
      const parser = filterPatchSchema.shape[key as keyof typeof filterPatchSchema.shape];
      const parsed = parser?.safeParse(["year", "startYear", "targetYear"].includes(key) ? Number(value) : value).data;
      if (parsed !== undefined) url.searchParams.set(key, String(parsed));
    }
  }
  if (page.section && resolveSiteNavigation({ view: page.view, section: page.section })) {
    url.hash = page.view === "power" && page.section === "capacity-share" ? "capacity-mix" : page.section;
  }
  return { href: url.pathname + url.search + url.hash, label: target.label, url };
}

export function patchViewFilters(page: ActivePage, patch: z.infer<typeof filterPatchSchema>) {
  const current = pageLocation(page);
  const keys = registeredFilterKeys(page.view);
  if (!current || isMapView(page.view) || page.view.startsWith("custom-") || !Object.keys(patch).length ||
    Object.keys(patch).some(key => !keys.includes(key) || key === "version" && page.view === "weather-replay")) return;
  if ((patch.compareRegion !== undefined && page.section !== "province-comparison")
    || ((patch.compareDate !== undefined || patch.compareMonth !== undefined) && page.section !== "carbon-comparison")
    || ((patch.compareCountry !== undefined || patch.compareThird !== undefined || patch.comparisonMode !== undefined)
      && page.section !== "economic-comparison" && page.section !== "growth-comparison")) return;
  const { url } = current;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  if (page.view === "generation" && patch.year && !patch.month && !url.searchParams.get("month")?.startsWith(`${patch.year}-`)) {
    url.searchParams.delete("month");
  }
  if (page.view === "carbon") {
    if (patch.month && patch.date || patch.month && patch.grain === "day" || patch.date && patch.grain === "month") return;
    if (patch.month || patch.grain === "month") url.searchParams.delete("date");
    if (patch.date || patch.grain === "day") url.searchParams.delete("month");
    if (patch.month) url.searchParams.set("grain", "month");
    if (patch.date) url.searchParams.set("grain", "day");
    const monthly = url.searchParams.get("grain") === "month" ||
      url.searchParams.has("month") && url.searchParams.get("grain") !== "day" && !url.searchParams.has("date");
    if (patch.compareMonth && !monthly || patch.compareDate && monthly) return;
  }
  if (patch.metric) url.searchParams.delete("indicator");
  const base = Object.fromEntries([...url.searchParams].filter(([key]) => key in siteNavigationSchema.shape.filters.unwrap().shape)
    .map(([key, value]) => [key, ["year", "startYear", "targetYear"].includes(key) ? Number(value) : value]));
  const checked = siteNavigationSchema.safeParse({ view: page.view, section: page.section, filters: base }).data;
  // A manually selected province can stay in the URL while a national chart is selected.
  const forValidation = checked && page.view === "generation" && !patch.region && !page.section?.startsWith("province-")
    ? { ...checked, filters: { ...checked.filters, region: undefined } } : checked;
  if (!forValidation || !resolveSiteNavigation(forValidation)) return;
  const compare = url.searchParams.get("compareRegion");
  if (compare && (!page.section?.startsWith("province-") && patch.compareRegion || !findChinaProvince(compare))) return;
  const updated = { view: page.view, section: page.section, search: url.search };
  return { page: updated, href: current.url.pathname + url.search + url.hash };
}

export const pageChangeSchema = z.strictObject({
  page: activePageSchema,
  status: z.string().max(180),
  expected: activePageSchema.optional(),
});

export type PageChange = z.infer<typeof pageChangeSchema>;
