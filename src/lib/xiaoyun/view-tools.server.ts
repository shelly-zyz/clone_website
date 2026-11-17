import "server-only";

import { z } from "zod";
import { chinaProvinces, chineseLabelMatches, findChinaProvince } from "@/lib/china-provinces";
import { layerGroups, regionTargets, technologies } from "@/lib/mock-map-data";
import countries from "@/lib/country-centers.generated.json" with { type: "json" };
import wdi from "../../../public/data/economy/wdi.json" with { type: "json" };
import gep from "../../../public/data/economy/gep.json" with { type: "json" };
import { replayRegionOptions, replayRegions } from "@/lib/weather-replay/regions";
import { replayViews } from "@/lib/weather-replay/views";
import { carbonPeriods } from "@/lib/topic-analysis/climate";
import { generationMonths } from "@/lib/topic-analysis/energy";
import { readPublishedHistory, readRegionalGeneration } from "@/lib/topic-analysis/published.server";
import { readRenewableScenario } from "@/lib/topic-analysis/scenario.server";
import { isMapView, pageLocation, patchViewFilters, type ActivePage, type PageChange, filterPatchSchema, type mapPatchSchema } from "./page-actions";
import { XiaoyunContextError } from "./context.server";

const weatherAreas = [
  ...replayRegionOptions,
  { value: "usa", label: replayRegions.usa.label },
  { value: "bahamas", label: replayRegions.bahamas.label },
];
const match = (name: string, input: string) => chineseLabelMatches(name, input);
const economics = new Set(wdi.countries.map(item => item.code));
const forecast = new Set(Object.keys(gep.values).filter(key => gep.values[key as keyof typeof gep.values].some(value => value !== null)));
const layers = [...layerGroups.map(item => ({ ...item, field: "layers" })), ...technologies.map(item => ({ ...item, field: "tech" }))];

export function mapToolCatalog() {
  return {
    layers: layers.map(layer => ({ id: layer.key, label: layer.label })),
    weatherReplay: weatherAreas.map(({ value: id, label }) => ({ id, label })),
    place: "使用中文地名、ISO3 或站内区域代码。电源统计模式支持中国省份和全国，气象回放使用档案区域。",
  };
}

export function readMapView(page: ActivePage | undefined) {
  if (!page || !isMapView(page.view)) throw new XiaoyunContextError("请先打开地图工作台。");
  const location = pageLocation(page);
  if (!location) throw new XiaoyunContextError("地图视图不可用。");
  const query = location.url.searchParams;
  const visible = layers.filter(layer => (query.get(layer.field) ?? "").split(",").includes(layer.key)).map(layer => layer.label);
  const place = findChinaProvince(query.get("region") ?? undefined)?.name
    ?? regionTargets.find(item => item.id === query.get("region"))?.label
    ?? wdi.countries.find(item => item.code === (query.get("country") ?? query.get("region")))?.label;
  const power = query.get("powerView");
  const mapType = power === "generation" ? "省级发电量" : power === "capacity" ? "省级装机容量" : "电源设施";
  const statistics = power === "generation" || power === "capacity";
  if (page.view === "globe-power") {
    if (statistics) query.set("projection", "map");
    else query.delete("projection");
  }
  const projection = query.get("projection") === "map" ? "二维" : "三维";
  const geography = place ? " · " + place : "";
  const detail = page.view === "globe-power"
    ? `${mapType} · ${statistics ? "三维中国地图" : "三维地球"}${geography} · 已打开图层 ${visible.join("、") || "无"}`
    : page.view === "globe-carbon" ? `${projection}${geography}`
      : page.view === "globe-economy" ? `${place ?? "全球"} · ${query.get("scene") === "outlook" ? "增长展望" : "统计地图"}`
        : [query.get("replay") ? "区域回放" : "地球视图", weatherAreas.find(({ value }) => value === query.get("replayRegion"))?.label].filter(Boolean).join(" · ");
  return { view: page.view, state: Object.fromEntries(query), summary: `${location.label} · ${detail}` };
}

export function setMapView(page: ActivePage | undefined, patch: z.infer<typeof mapPatchSchema>): PageChange {
  const view = patch.view ?? page?.view;
  if (!isMapView(view) || !Object.keys(patch).length) throw new XiaoyunContextError("请选择要操作的地球和地图设置。");
  if ((patch.powerView || patch.layers) && view !== "globe-power" || patch.replay && view !== "globe-weather" ||
    patch.projection && view !== "globe-power" && view !== "globe-carbon") throw new XiaoyunContextError("该地球不支持所选模式或图层。");
  const snapshot = pageLocation(page?.view === view ? page : { view, search: "" });
  if (!snapshot) throw new XiaoyunContextError("地图视图不可用。");
  const { url } = snapshot;
  const query = url.searchParams;
  const changed: string[] = [];
  if (patch.powerView) {
    if (patch.powerView !== query.get("powerView")) {
      query.delete("camera");
      if (!findChinaProvince(query.get("region") ?? undefined)) query.delete("region");
    }
    query.set("powerView", patch.powerView);
    if (patch.powerView === "facilities") query.delete("projection");
    else query.set("projection", "map");
  }
  const statistics = ["generation", "capacity"].includes(query.get("powerView") ?? "");
  if (patch.projection) {
    if (view === "globe-power" && (!statistics || patch.projection === "globe")) {
      throw new XiaoyunContextError("电源设施使用三维地球，省级发电量与装机容量使用三维中国地图。请选择对应的电力视图。");
    }
    query.set("projection", patch.projection);
    changed.push(view === "globe-power" ? "三维中国地图" : patch.projection === "map" ? "二维地图" : "三维地球");
  }
  if (patch.powerView) changed.push({ facilities: "电源设施", generation: "省级发电量", capacity: "省级装机容量" }[patch.powerView]);
  if (patch.replay) {
    if (patch.replay === "globe") query.delete("replay");
    else query.set("replay", patch.replay);
    changed.push(patch.replay === "globe" ? "气象地球" : replayViews[patch.replay].title);
  }
  if (patch.place) {
    const place = patch.place;
    if (view === "globe-weather") {
      const region = weatherAreas.find(({ value, label }) => match(value, place) ||
        label.split(" · ").some(name => match(name, place)) || (value === "china" && place === "中国"));
      const replayView = query.get("replay");
      if (!region || !replayView || !Object.hasOwn(replayViews, replayView)) {
        throw new XiaoyunContextError("气象定位支持区域回放中的档案地区，请先选对应回放。");
      }
      if (region.value !== (query.get("replayRegion") ?? "archive")) {
        query.set("replayRegion", region.value);
        query.delete("replayFrame");
        query.delete("replayPoint");
      }
      changed.push(region.label);
    } else {
      const province = findChinaProvince(place) ?? chinaProvinces.find(item => match(item.name, place));
      const target = regionTargets.find(item => item.enabled && [item.id, item.code, item.label].some(name => match(name, place)));
      const country = wdi.countries.find(item => match(item.code, place) || match(item.label, place));
      const geography = countries.find(item => item.code === country?.code || match(item.code, place) || match(item.name, place));
      const world = target?.id === "global";
      if (view === "globe-economy") {
        if (!country && !world) throw new XiaoyunContextError("经济体目录中没有找到这个地区。");
        if (country) query.set("country", country.code);
        else query.delete("country");
        query.delete("camera");
        changed.push(country?.label ?? "全球");
      } else {
        if (statistics && !province && !world && target?.id !== "china") throw new XiaoyunContextError("省级统计地图支持中国及各省。");
        const center = province?.center ?? target?.center ?? geography?.center;
        if (!center) throw new XiaoyunContextError("区域目录中没有找到这个地区。");
        if (statistics && !province) {
          query.delete("region");
          query.delete("camera");
        } else {
          query.set("region", province?.code ?? target?.id ?? geography!.code);
          query.set("camera", [...center, province ? 5.25 : target?.zoom ?? 4, 0, 0].join(","));
        }
        changed.push(province?.name ?? target?.label ?? country?.label ?? geography!.name);
      }
    }
  }
  for (const toggle of patch.layers ?? []) {
    const layer = layers.find(item => match(item.key, toggle.id));
    if (!layer || statistics) throw new XiaoyunContextError("所选图层需要电源设施视图，且必须使用图层目录中的编号。");
    const visible = new Set((query.get(layer.field) ?? "").split(",").filter(Boolean));
    if (toggle.visible) visible.add(layer.key);
    else visible.delete(layer.key);
    query.set(layer.field, [...visible].join(","));
    changed.push(`${toggle.visible ? "显示" : "隐藏"}${layer.label}`);
  }
  return { page: { view, search: url.search }, status: changed.join("、") || snapshot.label, expected: page };
}

export async function setViewFilters(page: ActivePage | undefined, patch: z.infer<typeof filterPatchSchema>): Promise<PageChange> {
  if (!page) throw new XiaoyunContextError("请先打开要设置筛选的专题。");
  const target = patchViewFilters(page, patch);
  if (!target) throw new XiaoyunContextError("当前页面不支持这些筛选，或选项之间不匹配。");
  const query = new URLSearchParams(target.page.search);
  let dataVersion: string | undefined;
  const countryKeys = ["country", "compareCountry", "compareThird"];
  for (const key of countryKeys) {
    const value = query.get(key);
    if (value && !(page.view === "outlook" ? forecast : economics).has(value)) {
      throw new XiaoyunContextError("所选经济体在当前数据口径暂无记录。");
    }
  }
  const selectedCountries = countryKeys.flatMap(key => query.has(key) ? [query.get(key)] : []);
  if (selectedCountries.length !== new Set(selectedCountries).size) throw new XiaoyunContextError("主经济体与对照经济体需要不同。");
  if (page.view === "generation" || page.view === "carbon" || page.view === "fuels") {
    const version = query.get("version");
    const history = await readPublishedHistory(page.view, version ?? undefined).catch(() => null);
    if (version && !history) throw new XiaoyunContextError("无法核验所选发布版本，筛选尚未应用。");
    if (page.view === "generation") {
      const product = filterPatchSchema.shape.product.safeParse(query.get("product") ?? "electricity").data ?? "electricity";
      const year = Number(query.get("year")) || undefined;
      const months = generationMonths(history, product, year);
      const month = query.get("month") ?? months.at(-1);
      if (!month || !months.includes(month)) throw new XiaoyunContextError("当前发布版本或公开月报没有该月份和指标。");
      if (page.section?.startsWith("province-")) {
        if (!history) throw new XiaoyunContextError("暂时无法核验该发布版本的省级覆盖，筛选尚未应用。");
        const regional = await readRegionalGeneration(month, history.version, product);
        const provinces = [query.get("region"), query.get("compareRegion")].filter(Boolean).map(item => findChinaProvince(item!)?.code);
        if (!regional.regions.some(item => item.value !== null) ||
          provinces.some(code => !regional.regions.some(item => item.code === code && item.value !== null))) {
          throw new XiaoyunContextError("这一发布版本在所选月份缺少要求的省级数据。");
        }
      }
      if (patch.product && !query.has("month")) query.set("month", month);
    }
    if (page.view === "carbon") {
      const monthly = query.get("grain") === "month" || query.has("month") && !query.has("date");
      const periods = carbonPeriods(monthly ? "month" : "day", history);
      const values = [query.get(monthly ? "month" : "date"), query.get(monthly ? "compareMonth" : "compareDate")];
      if (values.some(value => value && !periods.some(item => item.period === value && item.rate !== null))) {
        throw new XiaoyunContextError("现有发布数据或归档没有这一日期的排放速率。");
      }
    }
    if (page.view === "fuels" && page.section === "fuel-monthly" && !history?.facts.some(item =>
      item.value !== null && item.series === (query.get("fuel") ?? "raw-coal"))) {
      throw new XiaoyunContextError("该发布版本没有所选品种的月度观测。");
    }
    dataVersion = history?.version;
  }
  if (page.view === "renewables") {
    const scenario = await readRenewableScenario();
    const region = query.get("region") ?? "china";
    const key = findChinaProvince(region)?.iso.toLowerCase() ?? region;
    const year = Number(query.get("year") ?? "2050");
    const technology = query.get("technology") ?? "wind";
    if (!scenario.rows.some(item => item.region === key && item.year === year && item.technology === technology)) {
      throw new XiaoyunContextError("风光情景中没有所选地区、年份和技术的组合。");
    }
  }
  if (page.view === "weather-replay" && query.get("region") === "china") {
    throw new XiaoyunContextError("档案暂无中国区域回放。");
  }
  return { page: { ...target.page, search: query.size ? "?" + query : "", dataVersion }, status: "当前专题筛选", expected: page };
}
