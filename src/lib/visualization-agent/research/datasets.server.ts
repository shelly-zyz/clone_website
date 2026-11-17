import "server-only";

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { getAnalysisJob } from "@/lib/agent-runtime/store";
import { analysisResultSchema } from "@/lib/agent-runtime/analysis-result";
import { catalogEntry, resolveVersion } from "@/lib/data-agent/catalog.server";
import { readDataAgent, runDataAgentWrite } from "@/lib/data-agent/database.server";
import { listDataCatalog, queryData } from "@/lib/data-agent/query.server";
import { resolveDataResult } from "@/lib/data-agent/state.server";
import type { DataResult } from "@/lib/data-agent/result-profile";
import { readBundledReplay, readWeatherReplay } from "@/lib/weather-replay/storage.server";
import { WEATHER_METRICS } from "@/lib/weather-earth";
import { officialAnnual, powerRecords } from "@/lib/topic-analysis/power";
import wdi from "../../../../public/data/economy/wdi.json" with { type: "json" };
import gep from "../../../../public/data/economy/gep.json" with { type: "json" };
import growth from "../../../../public/data/economy/real-growth.json" with { type: "json" };
import { dataIdentity, domains, economyMetrics, VisualizationError, type BusinessDataset, type DatasetMetadata, type DatasetPoint,
  type DatasetProfile, type DatasetRequest, type VisualizationDataContract } from "./contracts";

export type ProjectAccess = { project_id: string; key: string };
export const datasetDomain = { power: "electricity", meteo: "meteorology", carbon: "carbon" } as const;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

const urlSchema = z.url({ protocol: /^https?$/ }).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password;
});
const instant = z.iso.datetime({ offset: true });
const numeric = z.number().nullable();
const coordinate = z.tuple([z.number().min(-180).max(360), z.number().min(-90).max(90)]);
const rowSchema = z.strictObject({
  timestamp: instant.nullable(), label: z.string().min(1).max(100), region_id: z.string().min(1).max(80), value: numeric,
  quality_flag: z.number().int().min(0), coordinates: coordinate.optional(),
  bounds: z.tuple([z.number(), z.number()]).optional(), actual: numeric.optional(), target: z.string().min(1).max(100).optional(),
});

const archiveSchema = z.strictObject({
  dataset_id: z.string().min(1).max(100), metric_id: z.string().min(1).max(100), series_id: z.string().min(1).max(100),
  title: z.string().min(1).max(180), domain: z.enum(domains), source_id: z.string().min(1).max(100), source_url: z.array(urlSchema).min(1).max(8),
  dimensions: z.object({ shape: z.enum(["time", "category", "grid", "flow"]), time_grain: z.string().min(1).max(32),
    coordinates: z.literal("EPSG:4326").optional() }),
  time_zone: z.literal("UTC").nullable(), unit: z.string().min(1).max(40), data_type: z.enum(dataIdentity),
  publication_time: instant.nullable(), last_updated_at: instant.nullable(), retrieved_at: instant,
  forecast_origin: instant.nullable(), interval_method: z.string().max(180).nullable(), model_id: z.string().max(140).nullable(),
  model_version: z.string().max(140).nullable(), aggregation_method: z.string().min(1).max(180),
  transform_history: z.array(z.string().max(180)).max(16), region_label: z.string().max(100).optional(),
  grid: z.object({ lon: z.array(z.number().min(-180).max(360)).min(2).max(120), lat: z.array(z.number().min(-90).max(90)).min(2).max(120) }).optional(),
  rows: z.array(rowSchema).min(1).max(5500),
});

function absent(message: string): never {
  throw new VisualizationError("DATA_GAP", "情报空白 · " + message);
}

function dayStart(date: string | undefined) {
  return date ? date.slice(0, 10) + "T00:00:00.000Z" : null;
}

function extent(rows: DatasetPoint[]): { start: string | null; end: string | null } {
  const times = rows.flatMap(row => row.timestamp ? [new Date(row.timestamp).toISOString()] : []).sort();
  return { start: times[0] ?? null, end: times.at(-1) ?? null };
}

type DatasetInput = Omit<DatasetMetadata, "observation_time" | "sample_count" | "validation_status" | "forecast_horizon" | "is_forecast">;
function materialize(input: DatasetInput, rows: DatasetPoint[]): VisualizationDataContract {
  const timeRange = extent(rows);
  const isForecast = input.data_type === "forecast";
  return { ...input, observation_time: isForecast ? { start: null, end: null } : timeRange,
    is_forecast: isForecast, forecast_horizon: isForecast && timeRange.start && timeRange.end ? { start: timeRange.start, end: timeRange.end } : null,
    sample_count: rows.length, validation_status: "pending", rows,
    missing_mask: rows.map(row => row.value === null), quality_flags: rows.map(row => row.quality_flag) };
}

function validateDataset(data: VisualizationDataContract, query: DatasetRequest): DatasetProfile {
  const { rows, missing_mask: missingMask, quality_flags: flags, ...metadata } = data;
  if (!data.unit || !data.source_version || !rows.length) absent(data.title + "没有符合条件的数据。");
  if (!data.source_url.length || !data.source_url.every(url => urlSchema.safeParse(url).success)) {
    throw new VisualizationError("VALIDATION_FAILED", data.title + "缺少可核查的来源链接。");
  }
  if (data.is_forecast && (!(data.forecast_origin || data.forecast_origin_period) || !data.forecast_horizon)) absent(data.title + "缺少预报起点或有效时段。");
  const keys = new Set<string>();
  const values: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (!rowSchema.safeParse(row).success || missingMask[index] !== (row.value === null) || flags[index] !== row.quality_flag) {
      throw new VisualizationError("VALIDATION_FAILED", "数据行、质量标记或缺失掩码不一致。");
    }
    if (row.bounds && (!data.interval_method || row.value === null || row.bounds[0] > row.value || row.bounds[1] < row.value)) {
      throw new VisualizationError("VALIDATION_FAILED", "区间与预测值或区间方法不一致。");
    }
    const key = data.dimensions.shape === "grid" ? row.coordinates?.join(",") : data.dimensions.shape === "flow" ? row.label + "\u0001" + row.target
      : data.dimensions.shape === "time" ? row.timestamp && new Date(row.timestamp).toISOString() : row.region_id;
    if (!key || keys.has(key) || data.dimensions.shape === "flow" && (!row.target || (row.value ?? 0) <= 0)) {
      throw new VisualizationError("VALIDATION_FAILED", "数据存在重复坐标、时间、边或无效流量。");
    }
    keys.add(key);
    if (row.value !== null) values.push(row.value);
  }
  if (!values.length) absent(data.title + "在所选范围内全部缺测。");
  return { ...metadata, validation_status: "valid", query, missing: rows.length - values.length, min: Math.min(...values),
    max: Math.max(...values), digest: hash(JSON.stringify(rows)) };
}

const seriesLabels: Record<string, string> = { electricity: "全部电源", "thermal-power": "火电", "hydro-power": "水电", "wind-power": "风电",
  "solar-power": "太阳能", "nuclear-power": "核电" };
const sourceLinks = { power: "https://data.stats.gov.cn/", carbon: "https://carbonmonitor-graced.com/datasets.html",
  meteo: "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast" };

async function fromDataResult(result: DataResult, publication?: string): Promise<VisualizationDataContract> {
  const { data_ref: ref, metric, rows, query } = result;
  const domain = datasetDomain[query.topic];
  const category = ref.shape === "category";
  const label = String(rows[0]?.source_ref.region_name ?? (query.topic === "power"
    ? rows[0]?.entity_code === "000000000000" ? "中国全国" : rows[0]?.entity_code ?? "所选地区"
    : "全球"));
  const series = rows[0]?.series_code ?? ref.dimensions.series;
  const title = [metric.name, seriesLabels[series] && seriesLabels[series] !== "全部电源" ? seriesLabels[series] : undefined].filter(Boolean).join(" · ");
  const sources = [...new Set(rows.flatMap(row => typeof row.source_ref.url === "string" ? [row.source_ref.url] : []))].slice(0, 8);
  if (!sources.length) sources.push(sourceLinks[query.topic]);
  if (query.topic === "meteo" && new Set(rows.map(row => row.issue_time)).size > 1) absent("同一图件数据集须选择一个 GFS 起报批次。");
  return materialize({
    dataset_id: ref.dataset_id, series_id: series, metric_id: metric.metric_code, title, domain, source_id: metric.source_name,
    dimensions: { shape: category ? "category" : "time", time_grain: metric.time_grain },
    time_zone: "UTC", unit: metric.unit, data_type: metric.data_identity, source_url: sources, source_version: ref.version,
    publication_time: publication ?? null, retrieved_at: new Date().toISOString(), last_updated_at: publication ?? null,
    model_id: query.topic === "meteo" ? "GFS" : null, model_version: null, forecast_origin: rows[0]?.issue_time ?? null,
    interval_method: null, transform_history: [], aggregation_method: "按发布原值", rules: metric.rules?.interpretation ?? metric.definition,
    truncated: ref.quality.truncated, region_label: category ? "同月各省" : label,
  }, rows.map(row => ({
    timestamp: row.time_start, label: category ? String(row.source_ref.region_name ?? row.entity_code) : row.time_start,
    region_id: row.entity_code, value: row.value === null || row.quality_flag === 1 ? null : Number(row.value),
    quality_flag: row.quality_flag,
  })));
}

const economyConfig = {
  "real-growth": { key: "NY.GDP.MKTP.KD.ZG", title: "实际 GDP 增速", unit: "%" },
  gdp: { key: "NY.GDP.MKTP.CD", title: "名义 GDP（现价）", unit: "USD" },
  "gdp-per-capita": { key: "NY.GDP.PCAP.CD", title: "人均 GDP（现价）", unit: "USD/人" },
  exports: { key: "NE.EXP.GNFS.CD", title: "商品与服务出口（现价）", unit: "USD" },
  "growth-outlook": { key: "NY.GDP.MKTP.KD.ZG", title: "实际 GDP 增速", unit: "%" },
} as const;

function annualCapacity(query: Extract<DatasetRequest, { kind: "annual-capacity" }>) {
  const version = hash(JSON.stringify(powerRecords));
  if (query.version && query.version !== version) absent("当前年度装机档案没有指定版本。");
  const series = query.source ?? "electricity";
  const mix = query.composition_year !== undefined;
  const records = powerRecords.filter(record => mix ? +record.year === query.composition_year :
    +record.year >= (query.start_year ?? 1960) && +record.year <= (query.end_year ?? 2200));
  const part = series === "electricity" ? undefined : powerRecords[0].parts.find(item => item.id === series);
  const rows = records.flatMap(record => {
    const timestamp = record.year + "-12-31T00:00:00.000Z";
    return mix ? record.parts.map(item => ({ timestamp, label: item.name, region_id: item.id, value: item.capacity, quality_flag: 0 }))
      : [{ timestamp, label: record.year, region_id: "CHN", value: part ? record.parts.find(item => item.id === part.id)?.capacity ?? null : record.capacity, quality_flag: 0 }];
  });
  return materialize({
    dataset_id: "nbs_annual_power_capacity", series_id: mix ? "composition" : series, metric_id: "installed_capacity_year_end",
    title: mix ? query.composition_year + " 年全国年末装机组成" : "全国年末装机量" + (part ? " · " + part.name : ""),
    domain: "electricity", source_id: officialAnnual.label, source_version: version,
    source_url: records.length ? records.map(record => record.source.href) : [officialAnnual.href],
    dimensions: { shape: mix ? "category" : "time", time_grain: "year" },
    unit: "GW", time_zone: "UTC", data_type: "official_statistics", publication_time: null,
    retrieved_at: new Date().toISOString(),
    last_updated_at: null, forecast_origin: null, model_id: null, model_version: null, interval_method: null,
    transform_history: mix ? ["其他及口径差额为总装机减去各项已单列装机容量"] : [],
    aggregation_method: "年末全国存量", region_label: "中国全国", truncated: false,
    rules: "全国公报年末发电装机。构成中的其他项含未单列电源和统计差额。",
  }, rows);
}

function economyDataset(query: Extract<DatasetRequest, { kind: "economy" }>) {
  const code = query.country;
  const historicalCode = code === "WLT" ? "WLD" : code;
  const entity = code === "WLT" || code === "WLD" ? "全球" : wdi.countries.find(row => row.code === code)?.label;
  if (!entity) absent("经济快照没有所选经济体。");
  const metric = economyConfig[query.metric];
  const outlook = query.metric === "growth-outlook";
  const realGrowth = query.metric === "real-growth";
  const since = outlook ? gep.years : realGrowth ? growth.years : wdi.years;
  const observations = outlook ? (gep.values as Record<string, (number | null)[]>)[code === "WLD" ? "WLT" : code]
    : realGrowth ? (growth.values as Record<string, (number | null)[]>)[historicalCode]
      : wdi.countries.find(row => row.code === code)?.values[metric.key as keyof (typeof wdi.countries)[number]["values"]];
  if (!observations) absent("该指标的快照没有此经济体的记录。");
  const version = outlook ? gep.archiveSha256 : hash(JSON.stringify(realGrowth ? growth : wdi));
  if (query.version && version !== query.version) absent("当前快照库没有指定的经济历史版本。");
  const dataset = outlook ? "world_bank_gep" : "world_bank_wdi";
  const updated = realGrowth ? growth.lastUpdated : !outlook ? wdi.updateDates[metric.key as keyof typeof wdi.updateDates] : undefined;
  const rows = since.flatMap((label, index) => {
    if (label < (query.start_year ?? since[0]) || label > (query.end_year ?? since[since.length - 1])) return [];
    const value = observations[index] ?? null;
    return [{ timestamp: label + "-01-01T00:00:00.000Z", label: String(label), region_id: historicalCode,
      value, quality_flag: Number(value === null) }];
  });
  return materialize({
    dataset_id: dataset, metric_id: metric.key, series_id: historicalCode, title: entity + " · " + metric.title,
    domain: "economy", source_id: outlook ? gep.source : wdi.source,
    dimensions: { shape: "time", time_grain: "year" }, unit: metric.unit, time_zone: "UTC",
    data_type: outlook ? "forecast" : "official_statistics", source_version: version,
    source_url: [outlook ? gep.sourceUrl : "https://data.worldbank.org/indicator/" + metric.key],
    publication_time: null, retrieved_at: realGrowth ? growth.retrievedAt : new Date().toISOString(), last_updated_at: dayStart(updated) ?? null,
    forecast_origin: null, forecast_origin_period: outlook ? gep.edition : undefined,
    interval_method: null, model_id: outlook ? "World Bank GEP" : null,
    model_version: outlook ? gep.edition : null, transform_history: ["保留世界银行原值与年历标签"],
    aggregation_method: "按发布原值", region_label: entity, truncated: false,
    rules: outlook ? "GEP 版次为 " + gep.edition + "，发布粒度为月，预测为点值。" : "世界银行 WDI 年度快照。",
  }, rows);
}

const forecastReference = z.object({ dataset_id: z.string(), version: z.string(), units: z.object({ value: z.string() }).optional(),
  dimensions: z.object({ time_grain: z.string() }).optional(), time_range: z.object({ start: z.string().nullable(), end: z.string().nullable() }).optional(),
  result_id: z.uuid().optional(), query_hash: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const jobResult = analysisResultSchema.extend({
  training_end: instant, source_name: z.string().optional(), interval_method: z.string().optional(),
});

async function fromForecast(jobId: string, access: ProjectAccess) {
  const job = await getAnalysisJob(access.project_id, jobId);
  const output = jobResult.safeParse(job?.result).data;
  const ref = forecastReference.safeParse(job?.data_ref).data;
  if (job?.status !== "succeeded" || !output?.points?.length || !output.model || !ref) absent("项目内没有这个已完成的预测或回测结果。");
  const sourceId = ref.result_id ?? (ref.query_hash && await runDataAgentWrite("green_agent_context", async client => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM results.data_query_result WHERE project_id=$1 AND query_hash=$2", [access.project_id, ref.query_hash]);
    return rows[0]?.id;
  }));
  if (!sourceId) absent("该预测任务缺少可核对的原始查询引用。");
  const source = await resolveDataResult(access.project_id, sourceId, access.key);
  if (source.status !== "ok" || source.data_ref.version !== ref.version || source.metric.unit !== output.unit) {
    throw new VisualizationError("VALIDATION_FAILED", "预测任务和原查询的发布版本或量纲不一致。");
  }
  const dataSource = await fromDataResult(source);
  const intervalMethod = output.interval_method ?? (output.points.some(point => point.p10 !== undefined) ? "分析 Worker 返回的预测分位数 P10–P90" : null);
  return materialize({
    dataset_id: ref.dataset_id, metric_id: source.metric.metric_code, series_id: dataSource.series_id, title: dataSource.title,
    domain: dataSource.domain, source_id: dataSource.source_id, source_url: dataSource.source_url, source_version: ref.version,
    dimensions: { shape: "time", time_grain: source.metric.time_grain }, time_zone: "UTC", unit: output.unit,
    data_type: "forecast", publication_time: new Date(job.updated_at).toISOString(), retrieved_at: new Date().toISOString(),
    last_updated_at: new Date(job.updated_at).toISOString(), forecast_origin: output.training_end,
    model_id: output.model.method ?? output.model.name, model_version: output.model.revision ?? output.model.version,
    interval_method: intervalMethod, transform_history: [], aggregation_method: "分析 Worker 返回值", truncated: false, region_label: dataSource.region_label,
    rules: "预测起点为所选运行的训练截止日。",
  }, output.points.map(point => ({
    timestamp: point.date, label: point.date, region_id: dataSource.rows[0].region_id,
    value: point.value, quality_flag: 0, actual: point.actual ?? null,
    bounds: point.p10 !== undefined && point.p90 !== undefined ? [point.p10, point.p90] : undefined,
  })));
}

const frameSchema = z.object({ time: instant, url: urlSchema, values: z.array(numeric).max(250_000) });
const replaySchema = z.object({
  region: z.string(), bounds: z.object({ west: z.number(), east: z.number(), north: z.number(), south: z.number() }),
  rows: z.number().int().min(2).max(1000), cols: z.number().int().min(2).max(1000),
  rain: z.array(frameSchema), satellite: z.array(frameSchema),
});
function sampledGrid(nx: number, ny: number, longitude: (i: number) => number, latitude: (i: number) => number,
  value: (i: number) => number | null, time: string, region: string) {
  const strideX = Math.max(1, Math.ceil(nx / 90));
  const strideY = Math.max(1, Math.ceil(ny / 62));
  const cols = Array.from({ length: Math.ceil(nx / strideX) }, (_, index) => index * strideX);
  const lines = Array.from({ length: Math.ceil(ny / strideY) }, (_, index) => index * strideY);
  const lon = cols.map(longitude);
  const lat = lines.map(latitude);
  const rows: DatasetPoint[] = [];
  for (const [y, row] of lines.entries()) {
    for (const [x, col] of cols.entries()) {
      const observed = value(row * nx + col);
      rows.push({ timestamp: time, value: observed, coordinates: [lon[x], lat[y]], label: lon[x] + ", " + lat[y],
        quality_flag: Number(observed === null), region_id: region });
    }
  }
  return { rows, grid: { lon, lat }, stride: [strideX, strideY] };
}

async function fromReplay(query: Extract<DatasetRequest, { kind: "replay-grid" }>) {
  const object = query.archive ? await readBundledReplay(query.id, query.version ?? null) : await readWeatherReplay(query.id, query.version ?? null);
  if (!object) absent("没有匹配的已发布气象网格。");
  const document = replaySchema.safeParse(JSON.parse(object.body)).data;
  if (!document) throw new VisualizationError("VALIDATION_FAILED", "气象回放缺少可校验的网格。");
  const frame = query.time ? document[query.field].find(row => Date.parse(row.time) === Date.parse(query.time!)) : document[query.field][0];
  if (!frame || frame.values.length !== document.rows * document.cols) absent("回放没有所选时间的完整网格。");
  const { bounds, region, rows: ny, cols: nx } = document;
  const precipitation = query.field === "rain";
  const grid = sampledGrid(nx, ny, i => bounds.west + (bounds.east - bounds.west) * i / (nx - 1),
    i => bounds.north - (bounds.north - bounds.south) * i / (ny - 1), i => frame.values[i], frame.time, query.id);
  return { resolved: { ...query, time: frame.time }, data: materialize({
    dataset_id: query.id, metric_id: precipitation ? "precipitation-rate" : "brightness-temperature",
    series_id: query.field, title: region + (precipitation ? " · 降水率" : " · 红外亮温"), domain: "meteorology",
    source_id: precipitation ? "PARDIG-NRT" : "SatWeave", source_url: [frame.url], source_version: object.version,
    dimensions: { shape: "grid", time_grain: "frame", coordinates: "EPSG:4326" }, unit: precipitation ? "mm/h" : "K",
    time_zone: "UTC", data_type: "research_estimate", publication_time: null, retrieved_at: new Date().toISOString(), last_updated_at: null,
    forecast_origin: null, model_id: null, model_version: null, interval_method: null, grid: grid.grid, truncated: false,
    aggregation_method: "已归档的网格值", transform_history: ["规则网格抽取步长：" + grid.stride.join("×")], region_label: region,
    rules: precipitation ? "区域卫星估算的瞬时降水率。" : "区域卫星融合红外亮温。",
  }, grid.rows) };
}

const gridFileSchema = z.object({
  key: z.string(), source: z.literal("GFS"), generatedAt: instant, validTimeUtc: instant,
  header: z.object({ lo1: z.number(), la1: z.number(), dx: z.number().positive(), dy: z.number().positive(), nx: z.number().int().min(2).max(1440),
    ny: z.number().int().min(2).max(721), refTime: instant, forecastTime: z.number().int().min(0).max(384) }),
  encoding: z.object({ kind: z.literal("linear"), scale: z.number().positive(), offset: z.number(), missingValue: z.number() }),
  kind: z.enum(["scalar", "vector"]), values: z.array(numeric).optional(), u: z.array(numeric).optional(), v: z.array(numeric).optional(),
});

async function readSmallFile(path: string, limit: number) {
  const size = await stat(path).then(info => info.isFile() && info.size <= limit).catch(() => false);
  if (!size) absent("数据归档文件不存在或超出单文件预算。");
  const buffer = await readFile(path);
  if (buffer.length > limit) absent("数据归档超出单文件预算。");
  return buffer;
}

async function fromGfs(query: Extract<DatasetRequest, { kind: "gfs-grid" }>) {
  const cache = join(process.cwd(), ".weather-cache", query.field + ".json");
  const archive = process.env.OGW_VIS_GRID_ARCHIVE;
  let fromArchive = false;
  let payload = await readSmallFile(cache, 9_000_000).catch(error => {
    if (archive && isAbsolute(archive) && query.version && error instanceof VisualizationError) return null;
    throw error;
  });
  if (query.version && (!payload || hash(payload) !== query.version)) {
    if (!archive || !isAbsolute(archive)) absent("只读天气缓存已经换版，该版本需要从配置的 GFS 归档读取。");
    payload = await readSmallFile(join(archive, query.version + ".json"), 9_000_000);
    fromArchive = true;
  }
  if (!payload) absent("GFS 网格缓存不可用。");
  const version = hash(payload);
  if (query.version && query.version !== version) throw new VisualizationError("VALIDATION_FAILED", "GFS 文件与版次摘要不符。");
  const file = gridFileSchema.safeParse(JSON.parse(payload.toString())).data;
  const metric = WEATHER_METRICS.find(item => item.key === query.field);
  if (!file || !metric || file.key !== query.field || Date.parse(file.validTimeUtc) !== Date.parse(file.header.refTime) + file.header.forecastTime * 3_600_000) {
    absent("没有可核验的 GFS 初始化时间、时效与网格元信息。");
  }
  const { header, encoding } = file;
  const sourceManifest = await readFile(join(process.cwd(), ".weather-cache/manifest.json"), "utf8")
    .then(value => z.object({ refreshStatus: z.string(), validTimeUtc: instant }).parse(JSON.parse(value))).catch(() => null);
  if (!fromArchive && (!sourceManifest || !["live", "cached"].includes(sourceManifest.refreshStatus) ||
    Date.parse(sourceManifest.validTimeUtc) !== Date.parse(file.validTimeUtc))) {
    absent("天气网格缓存没有匹配的真实来源清单。");
  }
  const decode = (observed?: number | null) => observed == null || observed === encoding.missingValue ? null : observed * encoding.scale + encoding.offset;
  const length = header.nx * header.ny;
  if (file.kind === "scalar" ? file.values?.length !== length : file.u?.length !== length || file.v?.length !== length) {
    throw new VisualizationError("VALIDATION_FAILED", "GFS 网格数组长度与坐标维度不一致。");
  }
  const grid = sampledGrid(header.nx, header.ny, i => header.lo1 + i * header.dx, i => header.la1 - i * header.dy,
    index => {
      if (file.kind === "scalar") return decode(file.values?.[index]);
      const u = decode(file.u?.[index]);
      const v = decode(file.v?.[index]);
      return u === null || v === null ? null : Math.hypot(u, v);
    }, file.validTimeUtc, "global");
  return materialize({
    dataset_id: "gfs_grid_cache", metric_id: query.field, series_id: query.field, title: metric.label, domain: "meteorology",
    source_id: "NOAA GFS", source_url: ["https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast"], source_version: version,
    dimensions: { shape: "grid", time_grain: "forecast_frame", coordinates: "EPSG:4326" }, unit: metric.unit,
    time_zone: "UTC", data_type: "forecast", publication_time: null, retrieved_at: file.generatedAt, last_updated_at: null,
    forecast_origin: header.refTime, model_id: "GFS", model_version: null, interval_method: null,
    grid: grid.grid, truncated: false, aggregation_method: "GRIB 解码和规则抽样",
    transform_history: ["网格原间隔 " + header.dx + "° × " + header.dy + "°，无插值",
      "抽取步长 " + grid.stride.join("×"), ...(file.kind === "vector" ? ["风速 = √(u² + v²)"] : [])],
    region_label: "全球", rules: "既有 GFS 缓存的历史起报帧，标注有效时间。",
  }, grid.rows);
}

async function approvedArchive(query: Extract<DatasetRequest, { kind: "approved" }>) {
  const directory = process.env.OGW_VIS_DATA_CATALOG;
  if (!directory || !isAbsolute(directory)) absent("未配置此领域的审核发布目录。");
  const manifest = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).parse(
    JSON.parse((await readSmallFile(join(directory, "releases.json"), 64_000)).toString()));
  const digest = query.version ?? manifest[query.id];
  if (!digest || !Object.hasOwn(manifest, query.id)) absent("审核发布目录未登记此项数据。");
  const body = await readSmallFile(join(directory, query.id, digest + ".json"), 4_500_000);
  if (digest !== hash(body)) throw new VisualizationError("VALIDATION_FAILED", "发布数据摘要不匹配。");
  const { rows, ...fields } = archiveSchema.parse(JSON.parse(body.toString()));
  return materialize({ ...fields, source_version: digest, truncated: false }, rows);
}

async function resolveOne(request: DatasetRequest, access: ProjectAccess) {
  let data: VisualizationDataContract;
  let resolved = request;
  if (request.kind === "published") {
    const result = await queryData(request.query);
    if (result.status !== "ok") absent(result.metric.name + "在所请求的版本、地区或时段没有有效值。");
    const publication = await readDataAgent(async client => catalogEntry(await resolveVersion(client, {
      topic: request.query.topic, version: result.data_ref.version,
    })).published_at);
    data = await fromDataResult(result, publication);
    resolved = { kind: "published", query: { ...request.query, ...result.query, metric_code: result.metric.metric_code } as typeof request.query };
  } else if (request.kind === "result") {
    const result = await resolveDataResult(access.project_id, request.result_id, access.key);
    data = await fromDataResult(result);
  } else if (request.kind === "forecast-job") data = await fromForecast(request.job_id, access);
  else if (request.kind === "economy") data = economyDataset(request);
  else if (request.kind === "annual-capacity") data = annualCapacity(request);
  else if (request.kind === "approved") data = await approvedArchive(request);
  else if (request.kind === "gfs-grid") data = await fromGfs(request);
  else {
    const replay = await fromReplay(request);
    data = replay.data;
    resolved = replay.resolved;
  }
  if (resolved.kind !== "published" && resolved.kind !== "result" && resolved.kind !== "forecast-job") {
    resolved = { ...resolved, version: data.source_version };
  }
  return { data, profile: validateDataset(data, resolved) };
}

export async function resolveDatasets(requests: DatasetRequest[], access: ProjectAccess, signal: AbortSignal) {
  const items = [];
  for (const request of requests) {
    signal.throwIfAborted();
    items.push(await resolveOne(request, access));
  }
  signal.throwIfAborted();
  return items;
}

export async function researchCatalog() {
  const [catalog, power] = await Promise.all([listDataCatalog().catch(() => undefined), listDataCatalog("power").catch(() => undefined)]);
  const published = catalog?.datasets ?? [];
  const business_datasets: BusinessDataset[] = published.flatMap(({ topic, metrics }) => metrics.map(metric => ({
    id: "published:" + metric.metric_code, label: businessNames[metric.metric_code] ?? metric.name, domain: datasetDomain[topic],
    unit: metric.unit, frequency: metric.time_grain,
    request: { kind: "published", query: topic === "power"
      ? { topic, metric_code: metric.metric_code, limit: 120, region_code: "000000000000" }
      : { topic, metric_code: metric.metric_code, limit: 120 } },
  })));
  business_datasets.unshift({ id: "annual-capacity", label: "装机量 · 全国年末", domain: "electricity", unit: "GW", frequency: "year",
    request: { kind: "annual-capacity", source: "electricity", start_year: +powerRecords[0].year, end_year: +powerRecords.at(-1)!.year } });
  business_datasets.push(...economyMetrics.map((metric): BusinessDataset => ({
    id: "economy:" + metric, label: metric === "growth-outlook" ? "实际 GDP 增速展望" : economyConfig[metric].title,
    domain: "economy", unit: economyConfig[metric].unit, frequency: "year", request: { kind: "economy", metric, country: "CHN" },
  })), {
    id: "replay-grid:rain", label: "降水率 · 美国东南部回放", domain: "meteorology", unit: "mm/h", frequency: "frame",
    request: { kind: "replay-grid", field: "rain", id: "us-southeast-2026-09-26", archive: true },
  }, {
    id: "replay-grid:satellite", label: "红外亮温 · 美国东南部回放", domain: "meteorology", unit: "K", frequency: "frame",
    request: { kind: "replay-grid", field: "satellite", id: "us-southeast-2026-09-26", archive: true },
  });
  const weatherDir = join(process.cwd(), ".weather-cache");
  const manifest = await readSmallFile(join(weatherDir, "manifest.json"), 64_000)
    .then(body => z.object({ refreshStatus: z.enum(["live", "cached"]) }).safeParse(JSON.parse(body.toString())).success).catch(() => false);
  const grids = manifest ? await Promise.all(WEATHER_METRICS.map(async metric => ({
    metric, available: await stat(join(weatherDir, metric.key + ".json")).then(file => file.isFile()).catch(() => false),
  }))) : [];
  for (const { metric, available } of grids) {
    if (available) business_datasets.push({ id: "gfs-grid:" + metric.key, label: metric.label + " · 空间网格", domain: "meteorology",
      unit: metric.unit, frequency: "frame", request: { kind: "gfs-grid", field: metric.key } });
  }
  return { published, business_datasets, power_regions: power?.region_codes ?? [], published_available: Boolean(catalog), economic_editions: { wdi: growth.lastUpdated, gep: gep.edition },
    approved_catalog: Boolean(process.env.OGW_VIS_DATA_CATALOG), global_grid: { fields: WEATHER_METRICS.map(item => item.key), cache: "GFS" } };
}

const businessNames: Record<string, string> = {
  electricity_generation_current: "发电量 · 本期值", electricity_generation_cumulative: "发电量 · 累计值",
  electricity_generation_yoy: "发电量 · 本期同比", electricity_generation_cumulative_yoy: "发电量 · 累计同比",
  grid_temperature_mean: "气温 · 全球格点均值", grid_wind_speed_10m_mean: "10 米风速 · 全球格点均值",
  grid_wind_speed_100m_mean: "100 米风速 · 全球格点均值", grid_surface_wind_gust_mean: "阵风 · 全球格点均值",
  global_grid_emission_rate_sum: "全球电力部门排放速率", global_grid_nonzero_cell_count: "非零排放格点数",
  global_grid_total_cell_count: "排放格点总数",
};
