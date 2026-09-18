import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { queryDatabase } from "@/lib/db";
import { WEATHER_METRICS, decodeWeatherValue, type WeatherField, type WeatherMetricKey } from "@/lib/weather-earth";
import { evaluateWeatherFreshness } from "@/lib/weather-freshness";
import type { RegionSummary, RegionTheme } from "./contracts";
import { geometryBounds, normalizeRegionName, pointInGeometry, type RegionGeometry } from "./geometry";

type ProvinceFeature = { properties?: { name?: string; adcode?: number }; geometry: RegionGeometry };
type ProvinceCollection = { features?: ProvinceFeature[] };
type ResolvedRegion = { id: string; name: string; geometries: RegionGeometry[] };
type AssetRow = {
  id: string; name: string; technology: string; capacity_mw: number; status: string;
  source: string; latitude: number; longitude: number;
};
type CarbonRow = {
  observed_on: string; sector: string; unit: string; width: number; height: number;
  longitude_min: number; latitude_max: number; dx: number; dy: number; frame_data: Buffer;
};
type CarbonChunkRow = { chunk_data: Buffer };

const cache = new Map<string, { expiresAt: number; value: RegionSummary }>();
const technologyLabels: Record<string, string> = {
  solar: "光伏", wind: "陆上风电", offshore: "海上风电", hydro: "水电", nuclear: "核电",
  coal: "煤电", gas: "燃气", oil: "燃油", geothermal: "地热", biomass: "生物质", other: "其他",
};

export async function loadRegionSummary(input: { regionId: string; theme: RegionTheme; metric?: string | null; time?: string | null }) {
  const key = JSON.stringify(input);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const region = await resolveRegion(input.regionId);
  if (!region) return unavailable(input, input.regionId, "未找到已审核的省级边界。", "mapped-asset-sample");
  const value = input.theme === "power"
    ? await loadPowerSummary(region, input)
    : input.theme === "weather"
      ? await loadWeatherSummary(region, input)
      : await loadCarbonSummary(region, input);
  cache.set(key, { expiresAt: Date.now() + 5 * 60_000, value });
  return value;
}

async function resolveRegion(regionId: string): Promise<ResolvedRegion | null> {
  const collection = JSON.parse(await fs.readFile(path.join(process.cwd(), "public/data/china-dashboard/provinces.geojson"), "utf8")) as ProvinceCollection;
  const features = (collection.features ?? []).filter((feature) => feature.properties?.name);
  if (regionId === "CN" || normalizeRegionName(regionId) === "全国") {
    return { id: "CN", name: "全国", geometries: features.map((feature) => feature.geometry) };
  }
  const normalized = normalizeRegionName(regionId);
  const feature = features.find((candidate) => (
    String(candidate.properties?.adcode ?? "") === regionId
    || normalizeRegionName(candidate.properties?.name ?? "") === normalized
  ));
  return feature ? {
    id: String(feature.properties?.adcode ?? normalized),
    name: normalizeRegionName(feature.properties?.name ?? normalized),
    geometries: [feature.geometry],
  } : null;
}

function contains(region: { geometries: RegionGeometry[] }, lng: number, lat: number) {
  return region.geometries.some((geometry) => {
    const bounds = geometryBounds(geometry);
    return lng >= bounds.minLng && lng <= bounds.maxLng && lat >= bounds.minLat && lat <= bounds.maxLat
      && pointInGeometry([lng, lat], geometry);
  });
}

async function loadPowerSummary(region: ResolvedRegion, input: { regionId: string; theme: RegionTheme; metric?: string | null; time?: string | null }): Promise<RegionSummary> {
  const rows = (await queryDatabase<AssetRow>(`SELECT id,name,technology,capacity_mw,status,source,latitude,longitude
    FROM website_data.energy_assets WHERE country_code IN ('CN','CHN') ORDER BY capacity_mw DESC`)).rows;
  const assets = rows.filter((row) => contains(region, row.longitude, row.latitude));
  const capacityMw = assets.reduce((sum, row) => sum + Number(row.capacity_mw || 0), 0);
  const sources = new Set(assets.map((row) => row.source).filter(Boolean));
  const byTechnology = new Map<string, { count: number; capacity: number }>();
  for (const asset of assets) {
    const current = byTechnology.get(asset.technology) ?? { count: 0, capacity: 0 };
    current.count += 1;
    current.capacity += Number(asset.capacity_mw || 0);
    byTechnology.set(asset.technology, current);
  }
  return {
    schemaVersion: 1,
    request: request(region, input), status: "available", identity: "mapped-asset-sample",
    title: `${region.name}电力设施样本`, updatedAt: new Date().toISOString(),
    metrics: [
      metric("asset-count", "映射设施", assets.length, "个"),
      metric("sample-capacity", "样本容量字段合计", Number(capacityMw.toFixed(1)), "MW"),
      metric("source-count", "数据来源", sources.size, "个"),
    ],
    breakdown: [...byTechnology.entries()].map(([id, value]) => ({
      id, label: technologyLabels[id] ?? id, value: value.count, unit: "个",
      share: assets.length ? Number((value.count / assets.length).toFixed(4)) : null,
    })).sort((left, right) => right.value - left.value),
    details: assets.slice(0, 5).map((asset) => ({ label: asset.name, value: `${technologyLabels[asset.technology] ?? asset.technology} · ${Number(asset.capacity_mw).toFixed(1)} MW` })),
    coverage: { value: null, label: "公开坐标样本，覆盖率未知" },
    source: { name: "PostgreSQL · website_data.energy_assets", timeRange: "当前数据库记录", freshness: "查询时读取", limitation: "多源公开坐标样本；不是官方设施普查，容量字段可能存在跨源重复。" },
    missingReason: assets.length ? null : "当前映射样本未命中该地区；这不代表官方数量为零。",
  };
}

async function loadWeatherSummary(region: ResolvedRegion, input: { regionId: string; theme: RegionTheme; metric?: string | null; time?: string | null }): Promise<RegionSummary> {
  const metricKey = WEATHER_METRICS.some((item) => item.key === input.metric) ? input.metric as WeatherMetricKey : "wind";
  let field: WeatherField;
  try {
    field = JSON.parse(await fs.readFile(path.join(process.cwd(), ".weather-cache", `${metricKey}.json`), "utf8")) as WeatherField;
  } catch {
    return unavailable(input, region.name, "真实 GFS 网格当前不可用。", "forecast");
  }
  const freshness = evaluateWeatherFreshness(field.generatedAt, field.header.refTime);
  if (freshness.stale) {
    return unavailable(input, region.name, `GFS 数据已过期（起报距今 ${freshness.runAgeHours ?? "未知"} 小时），正在等待刷新。`, "forecast");
  }
  let weightedSum = 0; let weightSum = 0; let valid = 0; let candidates = 0; let minimum = Infinity; let maximum = -Infinity;
  const { header } = field;
  for (let row = 0; row < header.ny; row += 1) {
    const lat = header.la1 - row * header.dy;
    if (lat < 3 || lat > 54.5) continue;
    for (let column = 0; column < header.nx; column += 1) {
      const lng = header.lo1 + column * header.dx;
      if (lng < 73 || lng > 136 || !contains(region, lng, lat)) continue;
      candidates += 1;
      const index = row * header.nx + column;
      const value = field.kind === "vector"
        ? vectorValue(field.u[index], field.v[index], field.encoding)
        : decodeWeatherValue(field.values[index], field.encoding);
      if (value === null || !Number.isFinite(value)) continue;
      const weight = Math.max(0.01, Math.cos(lat * Math.PI / 180));
      weightedSum += value * weight; weightSum += weight; valid += 1;
      minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    }
  }
  const meta = WEATHER_METRICS.find((item) => item.key === metricKey)!;
  const mean = weightSum ? weightedSum / weightSum : null;
  return {
    schemaVersion: 1, request: request(region, input), status: mean === null ? "unavailable" : "available", identity: "forecast",
    title: `${region.name}${meta.label}空间摘要`, updatedAt: field.generatedAt,
    metrics: [metric("mean", "区域面积加权平均", round(mean, meta.precision), meta.unit), metric("min", "网格最小值", valid ? round(minimum, meta.precision) : null, meta.unit), metric("max", "网格最大值", valid ? round(maximum, meta.precision) : null, meta.unit)],
    breakdown: [], details: [{ label: "有效时间", value: field.validTimeUtc }, { label: "网格", value: `${header.dx}° × ${header.dy}°` }],
    coverage: { value: candidates ? valid / candidates : null, label: `${valid.toLocaleString("zh-CN")} / ${candidates.toLocaleString("zh-CN")} 个省域网格点有效` },
    source: { name: field.source, timeRange: field.validTimeUtc, freshness: field.generatedAt, limitation: "正式数值天气预报的省域网格摘要，不是地面站实测。" },
    missingReason: mean === null ? "所选地区没有有效网格值。" : null,
  };
}

async function loadCarbonSummary(region: ResolvedRegion, input: { regionId: string; theme: RegionTheme; metric?: string | null; time?: string | null }): Promise<RegionSummary> {
  const sector = input.metric && /^[A-Za-z]+$/.test(input.metric) ? input.metric : "Power";
  const result = await queryDatabase<CarbonRow>(`SELECT observed_on::text,sector,unit,width,height,longitude_min,latitude_max,dx,dy,frame_data
    FROM website_data.carbon_emission_frames
    WHERE sector=$1 AND ($2::date IS NULL OR observed_on=$2::date)
    ORDER BY observed_on DESC LIMIT 1`, [sector, input.time ?? null]);
  const frame = result.rows[0];
  if (!frame) return unavailable(input, region.name, `没有 ${sector} 部门对应日期的碳排放网格。`, "research-estimate");
  const storedFrame = frame.frame_data.length ? frame.frame_data : Buffer.concat((await queryDatabase<CarbonChunkRow>(`SELECT chunk_data
    FROM website_data.carbon_emission_frame_chunks WHERE observed_on=$1::date AND sector=$2 ORDER BY chunk_index`, [frame.observed_on, frame.sector])).rows.map((row) => row.chunk_data));
  if (!storedFrame.length) return unavailable(input, region.name, `${sector} 部门对应日期的碳排放载荷缺失。`, "research-estimate");
  const payload = gunzipSync(storedFrame);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let sum = 0; let valid = 0; let candidates = 0; let maximum = -Infinity;
  for (let row = 0; row < frame.height; row += 1) {
    const lat = frame.latitude_max - row * frame.dy;
    if (lat < 3 || lat > 54.5) continue;
    for (let column = 0; column < frame.width; column += 1) {
      const lng = frame.longitude_min + column * frame.dx;
      if (lng < 73 || lng > 136 || !contains(region, lng, lat)) continue;
      candidates += 1;
      const value = view.getFloat32((row * frame.width + column) * 4, true);
      if (!Number.isFinite(value) || value < 0) continue;
      sum += value; maximum = Math.max(maximum, value); valid += 1;
    }
  }
  return {
    schemaVersion: 1, request: request(region, input), status: valid ? "available" : "unavailable", identity: "research-estimate",
    title: `${region.name}${sector}部门碳排放`, updatedAt: frame.observed_on,
    metrics: [metric("grid-sum", "省域网格值合计", valid ? Number(sum.toFixed(1)) : null, frame.unit), metric("max-cell", "单网格最大值", valid ? Number(maximum.toFixed(1)) : null, frame.unit), metric("valid-cells", "有效网格", valid, "个")],
    breakdown: [], details: [{ label: "日期", value: frame.observed_on }, { label: "部门", value: sector }, { label: "分辨率", value: `${frame.dx}° × ${frame.dy}°` }],
    coverage: { value: candidates ? valid / candidates : null, label: `${valid.toLocaleString("zh-CN")} / ${candidates.toLocaleString("zh-CN")} 个省域网格有效` },
    source: { name: "GRACED / Carbon Monitor", timeRange: frame.observed_on, freshness: "数据库最新可用帧", limitation: "研究估算的网格排放量，不是实时电力碳强度；单位保持源数据 kgC/h。" },
    missingReason: valid ? null : "所选地区没有有效碳排放网格值。",
  };
}

function vectorValue(u: number, v: number, encoding: WeatherField["encoding"]) {
  const decodedU = decodeWeatherValue(u, encoding); const decodedV = decodeWeatherValue(v, encoding);
  return decodedU === null || decodedV === null ? null : Math.hypot(decodedU, decodedV);
}
function round(value: number | null, precision: number) { return value === null ? null : Number(value.toFixed(precision)); }
function metric(id: string, label: string, value: number | null, unit: string) { return { id, label, value, unit, status: value === null ? "unknown" as const : "available" as const }; }
function request(region: { id: string; name: string }, input: { theme: RegionTheme; metric?: string | null; time?: string | null }) { return { regionId: region.id, regionName: region.name, theme: input.theme, metric: input.metric ?? null, time: input.time ?? null }; }
function unavailable(input: { regionId: string; theme: RegionTheme; metric?: string | null; time?: string | null }, name: string, reason: string, identity: RegionSummary["identity"]): RegionSummary {
  return { schemaVersion: 1, request: { regionId: input.regionId, regionName: name, theme: input.theme, metric: input.metric ?? null, time: input.time ?? null }, status: "unavailable", identity, title: `${name}数据不可用`, updatedAt: new Date().toISOString(), metrics: [], breakdown: [], details: [], coverage: { value: null, label: "未知" }, source: { name: "地区分析服务", timeRange: "不可用", freshness: "查询时", limitation: reason }, missingReason: reason };
}
