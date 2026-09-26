#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.dirname(repo);
const outputDir = path.join(workspace, "outputs", "20260922-nbs-energy");
const rawDir = path.join(workspace, "data", "nbs", "energy-monthly-2015-2025");
const statePath = path.join(outputDir, "import-state.json");
const metadataPath = path.join(outputDir, "metadata.json");
const sourceUrl = "https://data.stats.gov.cn/dg/website/page.html#/pc/national/monthData";
const provinceSourceUrl = "https://data.stats.gov.cn/dg/website/page.html#/pc/national/fsMonthData";
const apiBase = "https://data.stats.gov.cn/dg/website/publicrelease/web/external";
const nationalRootId = "fc982599aa684be7969d7b90b1bd0e84";
// The data endpoint uses a separate service-area root for province requests.
const provinceRootId = "6a99abef22d44119bdf5f8e2451ac390";
const monthCodes = [];
for (let year = 2015; year <= 2025; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    monthCodes.push(`${year}${String(month).padStart(2, "0")}MM`);
  }
}

// Core energy series recommended for the energy platform. Electricity keeps all
// four official variants; the other products use the monthly current value.
const productSpecs = [
  { key: "raw-coal", name: "原煤", metrics: ["current"] },
  { key: "crude-oil", name: "原油", metrics: ["current"] },
  { key: "natural-gas", name: "天然气", metrics: ["current"] },
  { key: "crude-processing", name: "原油加工量", metrics: ["current"] },
  { key: "electricity", name: "发电量", metrics: ["current", "cumulative", "yoy", "cumulative-yoy"] },
  { key: "thermal-power", name: "火力发电量", metrics: ["current"] },
  { key: "hydro-power", name: "水力发电量", metrics: ["current"] },
  { key: "nuclear-power", name: "核能发电量", metrics: ["current"] },
  { key: "wind-power", name: "风力发电量", metrics: ["current"] },
  { key: "solar-power", name: "太阳能发电量", metrics: ["current"] },
];

const metricDefinitions = {
  current: { dp: "1", code: "current", fallback: "当期值" },
  cumulative: { dp: "21", code: "cumulative", fallback: "累计值" },
  yoy: { dp: "11", code: "yoy", fallback: "同比增长" },
  "cumulative-yoy": { dp: "12", code: "cumulative-yoy", fallback: "累计同比增长" },
};

const headers = {
  Origin: "https://data.stats.gov.cn",
  "User-Agent": "Mozilla/5.0 (compatible; energy-platform-data-import/1.0)",
  Accept: "application/json, text/plain, */*",
  "X-Requested-With": "XMLHttpRequest",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function fetchJson(url, init = {}, label = url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...headers, ...(init.headers || {}) },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}: ${text.slice(0, 300)}`);
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error(`${label}: 返回非 JSON（${text.slice(0, 120).replaceAll(/\s+/g, " ")}）`);
      }
      if (payload.success === false) {
        throw new Error(`${label}: ${payload.message || "接口返回失败"}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(600 * attempt);
    }
  }
  throw lastError;
}

function listFromTree(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

const treeCache = new Map();
async function queryTree(code, pid = "") {
  const key = `${code}:${pid}`;
  if (!treeCache.has(key)) {
    const suffix = pid ? `&pid=${encodeURIComponent(pid)}` : "";
    treeCache.set(
      key,
      fetchJson(
        `${apiBase}/new/queryIndexTreeAsync?code=${encodeURIComponent(code)}${suffix}`,
        { headers: { Referer: code === "4" ? provinceSourceUrl : sourceUrl } },
        `目录 ${code}/${pid || "root"}`,
      ).then(listFromTree),
    );
  }
  return treeCache.get(key);
}

async function locateCatalogPath(code, names) {
  const roots = await queryTree(code);
  let current = roots.find((entry) => entry.name === (code === "4" ? "分省月度数据" : "月度数据")) || roots[0];
  if (!current) throw new Error(`国家统计局 ${code} 目录根节点为空`);
  for (const name of names) {
    const children = await queryTree(code, current._id);
    current = children.find((entry) => entry.name === name);
    if (!current) throw new Error(`国家统计局 ${code} 目录缺少：${name}`);
  }
  return current;
}

async function queryIndicators(catalogId, referer) {
  const payload = await fetchJson(
    `${apiBase}/new/queryIndicatorsByCid?cid=${encodeURIComponent(catalogId)}&dt=`,
    { headers: { Referer: referer } },
    `指标 ${catalogId}`,
  );
  return payload?.data?.list || [];
}

async function queryProvinces() {
  const payload = await fetchJson(
    `${apiBase}/getAllProvince`,
    { headers: { Referer: provinceSourceUrl } },
    "省份列表",
  );
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const normalized = list
    .map((entry) => ({
      code: String(entry.code || entry.value || entry.id || ""),
      name: String(entry.name || entry.label || entry.text || ""),
    }))
    .filter((entry) => entry.code && entry.name)
    // Mainland provincial energy data is the comparable scope for this platform.
    .filter((entry) => !["710000000000", "810000000000", "820000000000"].includes(entry.code));
  if (normalized.length < 30) throw new Error(`省份列表数量异常：${normalized.length}`);
  return normalized;
}

function safePart(value) {
  return String(value).replaceAll(/[^\p{L}\p{N}_-]+/gu, "_");
}

function fileForJob(job) {
  return path.join(
    rawDir,
    job.scope,
    safePart(job.regionCode),
    `${safePart(job.productKey)}-${safePart(job.metricCode)}.json`,
  );
}

async function requestJob(job) {
  const file = fileForJob(job);
  const cached = await readJson(file);
  if (
    cached &&
    cached.request?.catalogId === job.catalogId &&
    cached.request?.indicatorId === job.indicatorId &&
    Array.isArray(cached.rows) &&
    cached.rows.length === monthCodes.length
  ) {
    return { ...job, file, rows: cached.rows, cached: true };
  }
  const payload = await fetchJson(
    `${apiBase}/getEsDataByIndicatorIdAndDa`,
    {
      method: "POST",
      headers: {
        Referer: job.scope === "national" ? sourceUrl : provinceSourceUrl,
        "Content-Type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({
        cid: job.catalogId,
        id: job.indicatorId,
        da: job.regionCode,
        dt: "",
        rootId: job.scope === "national" ? nationalRootId : provinceRootId,
        dts: monthCodes,
      }),
    },
    `${job.scope}/${job.regionName}/${job.productName}/${job.metricCode}`,
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length !== monthCodes.length) {
    throw new Error(`${job.scope}/${job.regionName}/${job.productName}/${job.metricCode}: 返回 ${rows.length} 行，预期 ${monthCodes.length} 行`);
  }
  await writeJsonAtomic(file, {
    retrievedAt: new Date().toISOString(),
    sourceUrl: job.scope === "national" ? sourceUrl : provinceSourceUrl,
    request: {
      catalogId: job.catalogId,
      indicatorId: job.indicatorId,
      regionCode: job.regionCode,
      monthCodes,
    },
    rows,
  });
  return { ...job, file, rows, cached: false };
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function toDate(dt) {
  const match = String(dt || "").match(/^(\d{4})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-01` : null;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "null") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

async function ensureDatabaseTable(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS website_data;
    CREATE TABLE IF NOT EXISTS website_data.nbs_energy_monthly (
      scope text NOT NULL CHECK (scope IN ('national', 'province')),
      region_code text NOT NULL,
      region_name text NOT NULL,
      product_code text NOT NULL,
      product_name text NOT NULL,
      metric_code text NOT NULL,
      metric_name text NOT NULL,
      period_month date NOT NULL,
      value numeric,
      unit text NOT NULL,
      nbs_catalog_id text NOT NULL,
      nbs_indicator_id text NOT NULL,
      source_url text NOT NULL,
      retrieved_at timestamptz NOT NULL,
      PRIMARY KEY (scope, region_code, product_code, metric_code, period_month)
    );
    CREATE INDEX IF NOT EXISTS nbs_energy_monthly_region_period_idx
      ON website_data.nbs_energy_monthly (scope, region_code, period_month);
    CREATE INDEX IF NOT EXISTS nbs_energy_monthly_product_period_idx
      ON website_data.nbs_energy_monthly (product_code, metric_code, period_month);
  `);
}

async function registerSourceFile(client, relativePath, dataset, sizeBytes, digest, recordCount, error = null) {
  await client.query(
    `INSERT INTO website_data.source_files
       (path, dataset, source_kind, media_type, size_bytes, modified_at, sha256, import_status, record_count, error)
     VALUES ($1, $2, 'official-api-cache', 'application/json', $3, now(), $4, $5, $6, $7)
     ON CONFLICT (path) DO UPDATE SET
       dataset=EXCLUDED.dataset, source_kind=EXCLUDED.source_kind, media_type=EXCLUDED.media_type,
       size_bytes=EXCLUDED.size_bytes, modified_at=EXCLUDED.modified_at, sha256=EXCLUDED.sha256,
       import_status=EXCLUDED.import_status, record_count=EXCLUDED.record_count, error=EXCLUDED.error,
       imported_at=now()`,
    [relativePath, dataset, sizeBytes, digest, error ? "failed" : "imported", recordCount, error],
  );
}

async function importRows(client, jobs) {
  const successful = jobs.filter((entry) => entry.ok).map((entry) => entry.value);
  const rows = [];
  for (const job of successful) {
    for (const raw of job.rows) {
      const periodMonth = toDate(raw.dt);
      if (!periodMonth) continue;
      rows.push({
        scope: job.scope,
        regionCode: job.regionCode,
        regionName: job.regionName,
        productCode: job.productKey,
        productName: job.productName,
        metricCode: job.metricCode,
        metricName: job.metricName,
        periodMonth,
        value: numericOrNull(raw.v),
        unit: String(raw.du_name || raw.unit || job.unit || ""),
        catalogId: job.catalogId,
        indicatorId: job.indicatorId,
        sourceUrl: job.scope === "national" ? sourceUrl : provinceSourceUrl,
        retrievedAt: job.retrievedAt || new Date().toISOString(),
      });
    }
  }
  await client.query("BEGIN");
  try {
    await ensureDatabaseTable(client);
    const batchSize = 300;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const values = [];
      const placeholders = batch.map((row, index) => {
        const base = index * 14;
        values.push(
          row.scope,
          row.regionCode,
          row.regionName,
          row.productCode,
          row.productName,
          row.metricCode,
          row.metricName,
          row.periodMonth,
          row.value,
          row.unit,
          row.catalogId,
          row.indicatorId,
          row.sourceUrl,
          row.retrievedAt,
          // Keep a stable timestamp per row while allowing re-imports to update it.
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`;
      });
      await client.query(
        `INSERT INTO website_data.nbs_energy_monthly
          (scope,region_code,region_name,product_code,product_name,metric_code,metric_name,period_month,value,unit,nbs_catalog_id,nbs_indicator_id,source_url,retrieved_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (scope,region_code,product_code,metric_code,period_month) DO UPDATE SET
           region_name=EXCLUDED.region_name, product_name=EXCLUDED.product_name, metric_name=EXCLUDED.metric_name,
           value=EXCLUDED.value, unit=EXCLUDED.unit, nbs_catalog_id=EXCLUDED.nbs_catalog_id,
           nbs_indicator_id=EXCLUDED.nbs_indicator_id, source_url=EXCLUDED.source_url, retrieved_at=EXCLUDED.retrieved_at`,
        values,
      );
      if ((start + batch.length) % 6000 < batch.length || start + batch.length === rows.length) {
        console.log(`NBS_DB_ROWS ${Math.min(start + batch.length, rows.length)}/${rows.length}`);
      }
    }
    for (const job of successful) {
      const relative = path.relative(workspace, job.file).replaceAll("\\", "/");
      const stat = await fs.stat(job.file);
      await registerSourceFile(client, relative, "nbs-energy-monthly", stat.size, await sha256(job.file), job.rows.length);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { rows: rows.length, jobs: successful.length };
}

function jobsFromMetadata(metadata) {
  const provinceNames = new Map((metadata.provinces || []).map((entry) => [entry.code, entry.name]));
  const jobs = [];
  const add = (scope, regionCode, regionName, catalogs, referer) => {
    for (const product of productSpecs) {
      const catalog = catalogs[product.key];
      if (!catalog) throw new Error(`缓存元数据缺少产品目录：${scope}/${product.key}`);
      const byDp = new Map((catalog.indicators || []).map((indicator) => [String(indicator.dp), indicator]));
      for (const metricCode of product.metrics) {
        const metric = metricDefinitions[metricCode];
        const indicator = byDp.get(metric.dp) || catalog.indicators?.[0];
        if (!indicator) throw new Error(`缓存元数据缺少指标：${scope}/${product.key}/${metricCode}`);
        jobs.push({
          scope,
          regionCode,
          regionName,
          productKey: product.key,
          productName: product.name,
          metricCode,
          metricName: indicator.dp_name || indicator.i_showname || metric.fallback,
          catalogId: catalog.catalogId,
          indicatorId: indicator._id,
          unit: indicator.du_name || "",
          sourceUrl: referer,
        });
      }
    }
  };
  add("national", "000000000000", "全国", metadata.nationalCatalogs, sourceUrl);
  for (const province of metadata.provinces || []) {
    add("province", province.code, provinceNames.get(province.code) || province.name, metadata.provinceCatalogs, provinceSourceUrl);
  }
  return jobs;
}

async function resumeFromMetadata(metadata) {
  const jobs = jobsFromMetadata(metadata);
  state.totalJobs = jobs.length;
  state.status = "downloading";
  state.updatedAt = new Date().toISOString();
  await persistState();
  const results = await mapWithConcurrency(jobs, 2, async (job) => {
    state.currentJob = `${job.scope}/${job.regionName}/${job.productName}/${job.metricCode}`;
    const result = await requestJob(job);
    state.completedJobs += 1;
    state.downloadedRows += result.rows.length;
    if (result.cached) state.cachedJobs += 1;
    else state.downloadedJobs += 1;
    state.currentJob = null;
    state.updatedAt = new Date().toISOString();
    await persistState();
    console.log(`NBS_JOB ${state.completedJobs}/${state.totalJobs} ${result.cached ? "cached" : "downloaded"} ${job.scope}/${job.regionName}/${job.productName}/${job.metricCode}`);
    return result;
  });
  for (const result of results) if (!result.ok) state.errors.push(String(result.error?.message || result.error));
  state.failedJobs = state.errors.length;
  state.status = state.failedJobs ? "download-partial" : "download-complete";
  state.updatedAt = new Date().toISOString();
  await persistState();
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15_000,
    query_timeout: 120_000,
    statement_timeout: 120_000,
  });
  await client.connect();
  try {
    const imported = await importRows(client, results);
    state.importedRows = imported.rows;
    state.status = state.failedJobs ? "complete-with-download-errors" : "complete";
    state.finishedAt = new Date().toISOString();
    state.updatedAt = state.finishedAt;
    await persistState();
    console.log(JSON.stringify({ status: state.status, totalJobs: state.totalJobs, completedJobs: state.completedJobs, cachedJobs: state.cachedJobs, downloadedJobs: state.downloadedJobs, failedJobs: state.failedJobs, downloadedRows: state.downloadedRows, importedRows: state.importedRows, errors: state.errors.slice(0, 20), statePath, metadataPath, rawDir }, null, 2));
  } finally {
    await client.end().catch(() => {});
  }
}

const state = {
  status: "starting",
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalJobs: 0,
  completedJobs: 0,
  cachedJobs: 0,
  downloadedJobs: 0,
  failedJobs: 0,
  downloadedRows: 0,
  importedRows: 0,
  errors: [],
  currentJob: null,
};

let stateWriteQueue = Promise.resolve();
const persistState = async () => {
  stateWriteQueue = stateWriteQueue.then(() => writeJsonAtomic(statePath, state));
  return stateWriteQueue;
};

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(rawDir, { recursive: true });
await persistState();

const cachedMetadata = await readJson(metadataPath);
if (process.env.NBS_RESUME_ONLY === "1" && cachedMetadata) {
  try {
    await resumeFromMetadata(cachedMetadata);
  } catch (error) {
    state.status = "failed";
    state.error = String(error?.stack || error);
    state.updatedAt = new Date().toISOString();
    await persistState();
    console.error(JSON.stringify({ status: state.status, error: state.error, statePath }, null, 2));
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

let client;
try {
  const [nationalProducts, provinceProducts, provinces] = await Promise.all([
    locateCatalogPath("1", ["能源", "能源主要产品产量"]).then((catalog) => queryTree("1", catalog._id)),
    locateCatalogPath("4", ["能源", "能源主要产品产量"]).then((catalog) => queryTree("4", catalog._id)),
    queryProvinces(),
  ]);
  const nationalByName = new Map(nationalProducts.map((entry) => [entry.name, entry]));
  const provinceByName = new Map(provinceProducts.map((entry) => [entry.name, entry]));
  const missingProducts = productSpecs.filter((product) => !nationalByName.has(product.name) || !provinceByName.has(product.name));
  if (missingProducts.length) throw new Error(`目录缺少核心产品：${missingProducts.map((entry) => entry.name).join(",")}`);

  const indicatorCache = new Map();
  async function indicatorsFor(scope, catalogId) {
    const key = `${scope}:${catalogId}`;
    if (!indicatorCache.has(key)) {
      indicatorCache.set(key, queryIndicators(catalogId, scope === "national" ? sourceUrl : provinceSourceUrl));
    }
    return indicatorCache.get(key);
  }

  const nationalIndicators = new Map();
  const provinceIndicators = new Map();
  for (const product of productSpecs) {
    const [nationalList, provinceList] = await Promise.all([
      indicatorsFor("national", nationalByName.get(product.name)._id),
      indicatorsFor("province", provinceByName.get(product.name)._id),
    ]);
    nationalIndicators.set(product.name, nationalList);
    provinceIndicators.set(product.name, provinceList);
  }

  const jobs = [];
  const addJobs = (scope, regionCode, regionName, catalogMap, indicatorMap, regionUrl) => {
    for (const product of productSpecs) {
      const catalog = catalogMap.get(product.name);
      const list = indicatorMap.get(product.name) || [];
      const byDp = new Map(list.map((indicator) => [String(indicator.dp), indicator]));
      for (const metricCode of product.metrics) {
        const metric = metricDefinitions[metricCode];
        const indicator = byDp.get(metric.dp) || list[0];
        if (!indicator) throw new Error(`指标为空：${scope}/${product.name}/${metricCode}`);
        jobs.push({
          scope,
          regionCode,
          regionName,
          productKey: product.key,
          productName: product.name,
          metricCode,
          metricName: indicator.dp_name || indicator.i_showname || metric.fallback,
          catalogId: catalog._id,
          indicatorId: indicator._id,
          unit: indicator.du_name || "",
          sourceUrl: regionUrl,
        });
      }
    }
  };
  addJobs("national", "000000000000", "全国", nationalByName, nationalIndicators, sourceUrl);
  for (const province of provinces) {
    addJobs("province", province.code, province.name, provinceByName, provinceIndicators, provinceSourceUrl);
  }
  state.totalJobs = jobs.length;
  state.status = "downloading";
  state.updatedAt = new Date().toISOString();
  await persistState();

  await writeJsonAtomic(metadataPath, {
    generatedAt: new Date().toISOString(),
    coverage: { start: "2015-01", end: "2025-12", monthCount: monthCodes.length },
    nationalSourceUrl: sourceUrl,
    provinceSourceUrl,
    products: productSpecs,
    provinceCount: provinces.length,
    provinces,
    nationalCatalogs: Object.fromEntries(productSpecs.map((product) => [product.key, {
      name: product.name,
      catalogId: nationalByName.get(product.name)._id,
      indicators: nationalIndicators.get(product.name),
    }])),
    provinceCatalogs: Object.fromEntries(productSpecs.map((product) => [product.key, {
      name: product.name,
      catalogId: provinceByName.get(product.name)._id,
      indicators: provinceIndicators.get(product.name),
    }])),
  });

  // The public NBS service throttles bursty clients; two workers keep the
  // download reliable while the per-job cache makes restarts inexpensive.
  const results = await mapWithConcurrency(jobs, 2, async (job, index) => {
    state.currentJob = `${job.scope}/${job.regionName}/${job.productName}/${job.metricCode}`;
    const result = await requestJob(job);
    state.completedJobs += 1;
    state.downloadedRows += result.rows.length;
    if (result.cached) state.cachedJobs += 1;
    else state.downloadedJobs += 1;
    state.currentJob = null;
    state.updatedAt = new Date().toISOString();
    await persistState();
    console.log(`NBS_JOB ${state.completedJobs}/${state.totalJobs} ${result.cached ? "cached" : "downloaded"} ${job.scope}/${job.regionName}/${job.productName}/${job.metricCode}`);
    return result;
  });
  for (const result of results) {
    if (!result.ok) state.errors.push(String(result.error?.message || result.error));
  }
  state.failedJobs = state.errors.length;
  state.status = state.failedJobs ? "download-partial" : "download-complete";
  state.updatedAt = new Date().toISOString();
  await persistState();

  client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15_000,
    query_timeout: 120_000,
    statement_timeout: 120_000,
  });
  await client.connect();
  const imported = await importRows(client, results);
  state.importedRows = imported.rows;
  state.status = state.failedJobs ? "complete-with-download-errors" : "complete";
  state.finishedAt = new Date().toISOString();
  state.updatedAt = state.finishedAt;
  await persistState();
  console.log(JSON.stringify({
    status: state.status,
    totalJobs: state.totalJobs,
    completedJobs: state.completedJobs,
    cachedJobs: state.cachedJobs,
    downloadedJobs: state.downloadedJobs,
    failedJobs: state.failedJobs,
    downloadedRows: state.downloadedRows,
    importedRows: state.importedRows,
    errors: state.errors.slice(0, 20),
    statePath,
    metadataPath,
    rawDir,
  }, null, 2));
} catch (error) {
  state.status = "failed";
  state.error = String(error?.stack || error);
  state.updatedAt = new Date().toISOString();
  await persistState();
  console.error(JSON.stringify({ status: state.status, error: state.error, statePath }, null, 2));
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
