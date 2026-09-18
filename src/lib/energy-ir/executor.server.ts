import { promises as fs } from "node:fs";
import path from "node:path";
import type { EnergyDataset, EnergyExecutionPlan, EnergyProvenance, EnergyResult, EnergyTechnology } from "./schema";
// @ts-expect-error Node's direct type-stripping tests require the explicit TypeScript extension.
import { normalizeRegionName, pointInGeometry, type RegionGeometry } from "../regions/geometry.ts";

type ProvinceFeature = { properties?: { name?: string }; geometry: RegionGeometry };
type ProvinceCollection = { features?: ProvinceFeature[] };
type Asset = { name: string; technology: EnergyTechnology; capacityMw: number; source: string; lat: number; lng: number };
type GeneratedAssets = { meta?: { sources?: Array<{ name?: string }> }; energyAssets?: Asset[] };
type WeatherManifest = { generatedAt?: string; runTimeUtc?: string; validTimeUtc?: string; stale?: boolean; refreshStatus?: string; metrics?: unknown[] };
type OsmSummary = { generatedAt?: string; counts?: { lines?: number; substations?: number; plants?: number; generators?: number; tiles?: number } };
type VreManifest = { generatedAt?: string; timeRange?: { start?: string; end?: string }; gcm?: string; scenario?: string; years?: number[] };
type PvSummary = { sources?: Array<{ year?: number; rowsRead?: number; rowsUsed?: number }> };

const technologyLabels: Record<EnergyTechnology, string> = {
  solar: "光伏", wind: "陆上风电", offshore: "海上风电", hydro: "水电", nuclear: "核电",
  coal: "煤电", gas: "燃气", oil: "燃油", geothermal: "地热",
};

export async function executeEnergyPlan(plan: EnergyExecutionPlan, projectRoot = process.cwd(), readAssets: (technology?: string) => Promise<Asset[]> = readDatabaseAssets): Promise<EnergyResult> {
  if (!plan.readOnly || plan.sql !== null) throw new Error("Only deterministic read-only plans may execute.");
  if (plan.tool === "mapped-assets") return executeMappedAssets(plan, projectRoot, readAssets);
  if (plan.tool === "weather-manifest") return executeWeatherManifest(projectRoot);
  if (plan.tool === "dataset-catalog") return executeDatasetQuality(plan.parameters.dataset as EnergyDataset | undefined, projectRoot);
  if (plan.tool === "layer-catalog") return executeLayerAvailability(plan.parameters.dataset as EnergyDataset | undefined, plan.parameters.province, projectRoot);
  return unavailablePrediction();
}

async function readDatabaseAssets(technology?: string): Promise<Asset[]> {
  const { queryDatabase } = await import("@/lib/db");
  const result = await queryDatabase<Asset>(
    `SELECT name, technology, capacity_mw AS "capacityMw", source, latitude AS lat, longitude AS lng
     FROM website_data.energy_assets WHERE country_code IN ('CN', 'CHN') AND ($1::text IS NULL OR technology = $1)`,
    [technology ?? null],
  );
  return result.rows;
}

async function executeMappedAssets(plan: EnergyExecutionPlan, projectRoot: string, readAssets: (technology?: string) => Promise<Asset[]>): Promise<EnergyResult> {
  const [databaseAssets, provinces] = await Promise.all([
    readAssets(stringParameter(plan.parameters.technology)),
    readJson<ProvinceCollection>(path.join(projectRoot, "public", "data", "china-dashboard", "provinces.geojson")),
  ]);
  const province = stringParameter(plan.parameters.province);
  const technology = plan.parameters.technology as EnergyTechnology | undefined;
  const boundary = province ? provinces?.features?.find((feature) => normalizeRegionName(feature.properties?.name ?? "") === normalizeRegionName(province)) : undefined;
  if (province && !boundary) return unavailable(`未找到“${province}”的已审核省级边界，未执行空间筛选。`, mappedAssetProvenance());

  const assets = databaseAssets.filter((asset) => (
    (!technology || asset.technology === technology)
    && (!boundary || pointInGeometry([asset.lng, asset.lat], boundary.geometry))
  ));
  const scope = province ?? "全国";
  const technologyLabel = technology ? technologyLabels[technology] : "能源";
  const sources = [...new Set(assets.map((asset) => asset.source).filter(Boolean))].sort();
  const limitation = "结果来自项目 PostgreSQL 的公开设施记录和确定性省界空间筛选；不是官方设施普查，空结果不代表官方为零。";
  const provenance: EnergyProvenance[] = [{ source: "PostgreSQL · website_data.energy_assets", identity: "mapped-asset-sample", timeRange: "当前数据库记录", unit: "个 / MW", freshness: "查询时读取", limitation }];

  if (plan.action === "mapped_asset_sources") {
    return {
      status: "answered",
      summary: `${scope}${technologyLabel}映射样本命中 ${assets.length.toLocaleString("zh-CN")} 个，涉及 ${sources.length} 个数据源。`,
      facts: [
        { label: "映射设施数", value: assets.length, unit: "个" },
        { label: "数据源数", value: sources.length, unit: "个" },
        ...sources.slice(0, plan.resultLimit).map((source, index) => ({ label: `来源 ${index + 1}`, value: source, unit: "数据源" })),
      ],
      provenance,
      limitations: [limitation],
      visualization: { kind: "table", title: `${scope}${technologyLabel}样本来源` },
    };
  }

  const capacityMw = assets.reduce((sum, asset) => sum + (Number.isFinite(asset.capacityMw) ? asset.capacityMw : 0), 0);
  return {
    status: "answered",
    summary: `${scope}当前项目数据库中有 ${assets.length.toLocaleString("zh-CN")} 个${technologyLabel}设施样本；这是样本数，不是官方统计。`,
    facts: [
      { label: "映射设施数", value: assets.length, unit: "个" },
      { label: "样本容量字段合计", value: Number(capacityMw.toFixed(1)), unit: "MW" },
    ],
    provenance,
    limitations: [limitation, "样本容量可能因项目边界、阶段和多源重叠而高于官方口径，不能直接相加为官方装机。"],
    visualization: { kind: "number", title: `${scope}${technologyLabel}映射样本` },
  };
}

async function executeWeatherManifest(projectRoot: string): Promise<EnergyResult> {
  const manifest = await readJson<WeatherManifest>(path.join(projectRoot, ".weather-cache", "manifest.json"));
  const provenance = gfsProvenance(manifest);
  if (!manifest?.runTimeUtc || !manifest.validTimeUtc) return unavailable("GFS运行时清单当前不可用，未生成替代时间。", provenance);
  return {
    status: "answered",
    summary: `当前缓存GFS起报时间为 ${manifest.runTimeUtc}，有效时间为 ${manifest.validTimeUtc}。`,
    facts: [
      { label: "起报时间", value: manifest.runTimeUtc, unit: "UTC" },
      { label: "有效时间", value: manifest.validTimeUtc, unit: "UTC" },
      { label: "刷新状态", value: manifest.refreshStatus ?? "unknown", unit: "状态" },
    ],
    provenance,
    limitations: [provenance[0].limitation],
    visualization: { kind: "table", title: "GFS运行时刻" },
  };
}

async function executeDatasetQuality(dataset: EnergyDataset | undefined, projectRoot: string): Promise<EnergyResult> {
  if (!dataset) return unavailable("请明确要查询的数据集。", genericProvenance("未指定数据集"));
  const record = await inspectDataset(dataset, projectRoot);
  return {
    status: record.available ? "answered" : "unavailable",
    summary: record.summary,
    facts: [
      { label: "可用状态", value: record.available ? "可用" : "不可用", unit: "状态" },
      { label: "时间范围", value: record.provenance.timeRange, unit: "时间范围" },
      { label: "更新时间", value: record.provenance.freshness, unit: "时间" },
      { label: "缺失状态", value: record.missingness, unit: "状态" },
    ],
    provenance: [record.provenance],
    limitations: [record.provenance.limitation],
    visualization: { kind: "table", title: "数据集质量状态" },
  };
}

async function executeLayerAvailability(dataset: EnergyDataset | undefined, provinceValue: string | boolean | undefined, projectRoot: string): Promise<EnergyResult> {
  if (!dataset || dataset === "mapped-assets") return unavailable("请明确 GFS、GRACED、VRE、OSM 或 PV 足迹图层。", genericProvenance("未指定图层"));
  const record = await inspectDataset(dataset, projectRoot);
  const province = stringParameter(provinceValue);
  const scope = province ? `${province}（位于中国图层范围内）` : "中国大屏";
  const coverage = dataset === "osm" ? `${scope} · z3–5有界瓦片` : dataset === "vre" ? `${scope} · 长期情景摘要` : scope;
  return {
    status: record.available ? "answered" : "unavailable",
    summary: `${record.label}图层当前${record.available ? "可用" : "不可用"}；覆盖描述为${coverage}。`,
    facts: [
      { label: "图层状态", value: record.available ? "可用" : "不可用", unit: "状态" },
      { label: "覆盖", value: coverage, unit: "范围" },
      { label: "缺失状态", value: record.missingness, unit: "状态" },
    ],
    provenance: [record.provenance],
    limitations: [record.provenance.limitation, "图层可用只表示当前数据产物可读取，不证明业务变量完整。"],
    visualization: { kind: "status", title: `${record.label}图层状态` },
  };
}

async function inspectDataset(dataset: EnergyDataset, projectRoot: string) {
  if (dataset === "gfs") {
    const manifest = await readJson<WeatherManifest>(path.join(projectRoot, ".weather-cache", "manifest.json"));
    const provenance = gfsProvenance(manifest)[0];
    return { label: "GFS", available: Boolean(manifest), summary: manifest ? `GFS清单可用，刷新状态为${manifest.refreshStatus ?? "unknown"}。` : "GFS清单不可用。", missingness: manifest?.stale ? "清单标记为过期" : manifest ? "清单存在；单格点缺失需查询字段" : "清单缺失", provenance };
  }
  if (dataset === "osm") {
    const summary = await readJson<OsmSummary>(path.join(projectRoot, "public", "data", "osm-power", "summary.json"));
    const count = summary?.counts;
    const available = Boolean(count?.tiles);
    const limitation = "OpenStreetMap众包几何不是调度拓扑，不含可信线路容量、损耗或实时潮流；覆盖率不能解释为完整普查。";
    return { label: "OSM电力设施", available, summary: available ? `OSM中国快照可用，共${count?.tiles}个z3–5瓦片。` : "OSM中国瓦片摘要不可用。", missingness: available ? `众包缺失未知；线路${count?.lines ?? 0}、变电站${count?.substations ?? 0}` : "瓦片摘要缺失", provenance: { source: "OpenStreetMap China power extract", identity: "crowdsourced-map" as const, timeRange: "2026-05-17 snapshot", unit: "要素/瓦片", freshness: summary?.generatedAt ?? "未记录生成时刻", limitation } };
  }
  if (dataset === "vre") {
    const manifest = await readJson<VreManifest>(path.join(projectRoot, "public", "data", "climate-vre", "manifest.json"));
    const available = Boolean(manifest);
    const range = manifest?.timeRange ? `${manifest.timeRange.start ?? "?"} 至 ${manifest.timeRange.end ?? "?"}` : "2021-2060";
    const limitation = "GFDL-ESM4 SSP1-2.6长期模型情景，不是实际发电、正式短期预报或概率预测。";
    return { label: "VRE长期情景", available, summary: available ? `VRE ${manifest?.gcm} ${manifest?.scenario} 情景摘要可用。` : "VRE情景清单不可用。", missingness: available ? "清单可用；单区域小时序列需按参数查询" : "清单缺失", provenance: { source: "GFDL-ESM4 SSP1-2.6 VRE manifest", identity: "model-scenario" as const, timeRange: range, unit: "capacity_factor", freshness: manifest?.generatedAt ?? "未记录生成时刻", limitation } };
  }
  if (dataset === "pv-footprint") {
    const summary = await readJson<PvSummary>(path.join(projectRoot, "public", "data", "china-pv", "solar-footprints-summary.json"));
    const available = Boolean(summary?.sources?.length);
    const limitation = "遥感识别足迹只提供覆盖与面积证据，不能直接换算为官方装机容量；精细多边形尚未进入首版问数。";
    return { label: "PV遥感足迹", available, summary: available ? `PV足迹摘要可用，包含${summary?.sources?.length}个来源批次。` : "PV足迹摘要不可用。", missingness: available ? "摘要可用；精细多边形待结构化" : "摘要缺失", provenance: { source: "CPVPD-2024 / ChinaPV", identity: "research-estimate" as const, timeRange: "2015/2020/2024", unit: "平方米/足迹", freshness: "构建快照未记录生成时刻", limitation } };
  }
  if (dataset === "mapped-assets") {
    const generated = await readJson<GeneratedAssets>(path.join(projectRoot, "src", "lib", "china-map-data.generated.json"));
    const available = Boolean(generated?.energyAssets);
    const limitation = "多源公开坐标样本，不是官方设施普查；容量字段存在项目边界和重复口径风险。";
    return { label: "能源设施映射样本", available, summary: available ? `映射设施构建快照可用，共${generated?.energyAssets?.length ?? 0}条。` : "映射设施构建快照不可用。", missingness: available ? "省级字段未原生入库；首版使用省界空间筛选" : "构建快照缺失", provenance: { source: "china-map-data.generated.json", identity: "mapped-asset-sample" as const, timeRange: "当前构建快照", unit: "设施", freshness: "未记录生成时刻", limitation } };
  }
  const manifest = await readJson<unknown>(path.join(projectRoot, "public", "data", "carbon-earth", "manifest.json"));
  const limitation = "GRACED Power是逐日研究估算，不是实时碳监测；当前图层契约要求本地运行时清单。";
  return { label: "GRACED Power", available: Boolean(manifest), summary: manifest ? "GRACED Power本地运行时清单可用。" : "GRACED Power本地运行时清单不可用；未生成替代帧。", missingness: manifest ? "需按帧查询覆盖" : "本地运行时清单缺失", provenance: { source: "GRACED Power runtime manifest", identity: "research-estimate" as const, timeRange: "以运行时清单为准", unit: "kgC/hour", freshness: "以运行时清单为准", limitation } };
}

function unavailablePrediction(): EnergyResult {
  const limitation = "生产预测的数据质量门禁尚未通过；首版不输出预测、调度或实时省级碳强度。";
  return { status: "unavailable", summary: limitation, facts: [{ label: "生产预测", value: "锁定", unit: "状态" }], provenance: [{ source: "/api/prediction/status", identity: "research-estimate", timeRange: "历史回测证据", unit: "状态", freshness: "运行时", limitation }], limitations: [limitation], visualization: { kind: "status", title: "预测门禁" } };
}

function unavailable(summary: string, provenance: EnergyProvenance[]): EnergyResult {
  return { status: "unavailable", summary, facts: [{ label: "可用状态", value: "不可用", unit: "状态" }], provenance, limitations: provenance.map((item) => item.limitation), visualization: { kind: "status", title: "数据不可用" } };
}

function mappedAssetProvenance(limitation = "多源公开坐标样本；不是官方设施普查，空结果不代表官方为零。"): EnergyProvenance[] {
  return [{ source: "src/lib/china-map-data.generated.json + 已审核省级GeoJSON", identity: "mapped-asset-sample", timeRange: "当前构建快照", unit: "个/MW", freshness: "构建产物未记录生成时刻", limitation }];
}

function gfsProvenance(manifest: WeatherManifest | null): EnergyProvenance[] {
  return [{ source: "NOAA GFS runtime cache manifest", identity: "forecast", timeRange: manifest?.runTimeUtc && manifest.validTimeUtc ? `${manifest.runTimeUtc} 至 ${manifest.validTimeUtc}` : "运行时清单缺失", unit: "UTC", freshness: manifest?.generatedAt ?? "未知", limitation: "GFS是正式数值天气预报，不是场站实测或风光发电预测。" }];
}

function genericProvenance(limitation: string): EnergyProvenance[] {
  return [{ source: "EnergyIR semantic catalog", identity: "mapped-asset-sample", timeRange: "未指定", unit: "状态", freshness: "catalog 1.0.0", limitation }];
}

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return null; }
}

function stringParameter(value: string | boolean | undefined) {
  return typeof value === "string" && value ? value : undefined;
}
