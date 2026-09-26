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
const metadataPath = path.join(outputDir, "metadata.json");
const rawDir = path.join(workspace, "data", "nbs", "energy-monthly-2015-2025");
const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
const products = metadata.products;
const provinces = new Map(metadata.provinces.map((entry) => [entry.code, entry.name]));
const metricDefs = {
  current: "1",
  cumulative: "21",
  yoy: "11",
  "cumulative-yoy": "12",
};
const sourceUrl = metadata.nationalSourceUrl;
const provinceSourceUrl = metadata.provinceSourceUrl;

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function monthDate(dt) {
  const m = String(dt || "").match(/^(\d{4})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined || value === "null") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metadataFor(scope, productKey, metricCode) {
  const entry = metadata.products.find((product) => product.key === productKey);
  if (!entry) throw new Error(`未知产品 ${productKey}`);
  const catalogs = scope === "national" ? metadata.nationalCatalogs : metadata.provinceCatalogs;
  const catalog = catalogs[productKey];
  const indicator = (catalog.indicators || []).find((item) => String(item.dp) === metricDefs[metricCode]) || catalog.indicators?.[0];
  if (!indicator) throw new Error(`未知指标 ${scope}/${productKey}/${metricCode}`);
  return {
    productName: entry.name,
    catalogId: catalog.catalogId,
    indicatorId: indicator._id,
    metricName: indicator.dp_name || indicator.i_showname || metricCode,
    unit: indicator.du_name || "",
  };
}

const files = await walk(rawDir);
const rows = [];
const sourceRecords = [];
for (const file of files) {
  const relative = path.relative(rawDir, file).replaceAll("\\", "/");
  const parts = relative.split("/");
  if (parts.length !== 3) continue;
  const [scope, regionCode, filename] = parts;
  const match = filename.match(/^(.+?)-(cumulative-yoy|cumulative|yoy|current)\.json$/);
  if (!match || !["national", "province"].includes(scope)) continue;
  const productKey = match[1];
  const metricCode = match[2];
  const payload = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(payload.rows)) continue;
  const info = metadataFor(scope, productKey, metricCode);
  const regionName = scope === "national" ? "全国" : provinces.get(regionCode) || regionCode;
  for (const raw of payload.rows) {
    const period = monthDate(raw.dt);
    if (!period) continue;
    rows.push([
      scope,
      regionCode,
      regionName,
      productKey,
      info.productName,
      metricCode,
      info.metricName,
      period,
      toNumber(raw.v),
      String(raw.du_name || raw.unit || info.unit || ""),
      info.catalogId,
      info.indicatorId,
      scope === "national" ? sourceUrl : provinceSourceUrl,
      payload.retrievedAt || new Date().toISOString(),
    ]);
  }
  const stat = await fs.stat(file);
  sourceRecords.push({
    path: path.relative(workspace, file).replaceAll("\\", "/"),
    size: stat.size,
    sha256: await sha256(file),
    records: payload.rows.length,
  });
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
  query_timeout: 120_000,
  statement_timeout: 120_000,
});
await client.connect();
try {
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
  await client.query("BEGIN");
  const batchSize = 300;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values = batch.flat();
    const placeholders = batch.map((_, index) => {
      const base = index * 14;
      return `(${Array.from({ length: 14 }, (_, offset) => `$${base + offset + 1}`).join(",")})`;
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
  for (const source of sourceRecords) {
    await client.query(
      `INSERT INTO website_data.source_files
         (path,dataset,source_kind,media_type,size_bytes,modified_at,sha256,import_status,record_count,error)
       VALUES ($1,'nbs-energy-monthly','official-api-cache','application/json',$2,now(),$3,'imported',$4,NULL)
       ON CONFLICT (path) DO UPDATE SET dataset=EXCLUDED.dataset,source_kind=EXCLUDED.source_kind,
         media_type=EXCLUDED.media_type,size_bytes=EXCLUDED.size_bytes,modified_at=EXCLUDED.modified_at,
         sha256=EXCLUDED.sha256,import_status='imported',record_count=EXCLUDED.record_count,error=NULL,imported_at=now()`,
      [source.path, source.size, source.sha256, source.records],
    );
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ status: "imported-cached", files: sourceRecords.length, rows: rows.length, rawDir }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
