import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Pool } from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const rawDataRoot = path.join(workspaceRoot, "data");
const publicDataRoot = path.join(repoRoot, "public", "data");
const generatedMapPath = path.join(repoRoot, "src", "lib", "china-map-data.generated.json");
const schemaPath = path.join(scriptDir, "database-schema.sql");

await loadLocalEnvironment();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 30_000,
  max: 2,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});
pool.on("error", (error) => {
  console.error(`PostgreSQL pool connection error: ${errorMessage(error)}`);
});

const counters = {
  sourceFiles: 0,
  jsonDocuments: 0,
  energyAssets: 0,
  dataCenters: 0,
  geoFeatures: 0,
  vectorTiles: 0,
  climateHourly: 0,
  errors: 0,
};

let runId;
const existingCatalog = new Map();

async function main() {
  await queryWithRetry(await fs.readFile(schemaPath, "utf8"));
  const run = await queryWithRetry(
    "INSERT INTO website_data.import_runs DEFAULT VALUES RETURNING id",
  );
  runId = run.rows[0].id;
  await loadExistingCatalog();

  try {
    if (process.env.DATA_IMPORT_SKIP_RAW_CATALOG !== "true") {
      await catalogDirectory(rawDataRoot, "raw-source");
    }
    await catalogDirectory(publicDataRoot, "website-public-data");
    await catalogFile(generatedMapPath, "generated-map", "generated");
    await importGeneratedMapData();
    await importJsonDocuments();
    await importGeoJsonFiles();
    await importVectorTiles();
    await importClimateHourly();

    if (counters.errors > 0) {
      throw new Error(`Import contains ${counters.errors} failed files; successful batches are retained for verification.`);
    }

    await queryWithRetry(
      `UPDATE website_data.import_runs
       SET finished_at = now(), status = 'completed', summary = $2::jsonb
       WHERE id = $1`,
      [runId, JSON.stringify(counters)],
    );
    console.log(JSON.stringify({ ok: true, runId, counters }, null, 2));
  } catch (error) {
    await queryWithRetry(
      `UPDATE website_data.import_runs
       SET finished_at = now(), status = 'failed', summary = $2::jsonb, error = $3
       WHERE id = $1`,
      [runId, JSON.stringify(counters), errorMessage(error)],
    ).catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }
}

async function catalogDirectory(root, sourceKind) {
  for await (const filePath of walkFiles(root)) {
    const relativePath = normalizedRelativePath(filePath);
    const dataset = datasetForPath(relativePath);
    await catalogFile(filePath, dataset, sourceKind);
  }
}

async function catalogFile(filePath, dataset, sourceKind) {
  const stats = await fs.stat(filePath);
  const relativePath = normalizedRelativePath(filePath);
  const existing = existingCatalog.get(relativePath);
  if (
    existing
    && Number(existing.size_bytes) === stats.size
    && Math.abs(new Date(existing.modified_at).getTime() - stats.mtime.getTime()) < 1000
    && existing.sha256
  ) {
    counters.sourceFiles += 1;
    return;
  }
  const sha256 = await hashFile(filePath);

  await queryWithRetry(
    `INSERT INTO website_data.source_files (
       path, dataset, source_kind, media_type, size_bytes, modified_at,
       sha256, import_status, error, imported_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'cataloged', NULL, now())
     ON CONFLICT (path) DO UPDATE SET
       dataset = EXCLUDED.dataset,
       source_kind = EXCLUDED.source_kind,
       media_type = EXCLUDED.media_type,
       size_bytes = EXCLUDED.size_bytes,
       modified_at = EXCLUDED.modified_at,
       sha256 = EXCLUDED.sha256,
       import_status = 'cataloged',
       error = NULL,
       imported_at = now()`,
    [
      relativePath,
      dataset,
      sourceKind,
      mediaTypeForPath(filePath),
      stats.size,
      stats.mtime,
      sha256,
    ],
  );
  counters.sourceFiles += 1;
  if (counters.sourceFiles % 250 === 0) {
    console.log(`Cataloged ${counters.sourceFiles} files...`);
  }
}

async function importGeneratedMapData() {
  const payload = JSON.parse(await fs.readFile(generatedMapPath, "utf8"));
  const assets = (payload.energyAssets ?? []).map((asset) => {
    const {
        id,
        name,
        technology,
        capacityMw,
        status,
        countryCode,
        regionId,
        source,
        lat,
        lng,
        ...properties
      } = asset;
    return {
      id, name, technology, capacity_mw: capacityMw, status,
      country_code: countryCode, region_id: regionId ?? null, source,
      latitude: lat, longitude: lng, properties,
    };
  });
  for (let offset = 0; offset < assets.length; offset += 500) {
    const batch = assets.slice(offset, offset + 500);
    await queryWithRetry(
      `INSERT INTO website_data.energy_assets (
         id, name, technology, capacity_mw, status, country_code, region_id,
         source, latitude, longitude, properties, updated_at
       )
       SELECT id, name, technology, capacity_mw, status, country_code, region_id,
              source, latitude, longitude, properties, now()
       FROM jsonb_to_recordset($1::jsonb) AS row(
         id text, name text, technology text, capacity_mw double precision,
         status text, country_code text, region_id text, source text,
         latitude double precision, longitude double precision, properties jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, technology=EXCLUDED.technology,
         capacity_mw=EXCLUDED.capacity_mw, status=EXCLUDED.status,
         country_code=EXCLUDED.country_code, region_id=EXCLUDED.region_id,
         source=EXCLUDED.source, latitude=EXCLUDED.latitude,
         longitude=EXCLUDED.longitude, properties=EXCLUDED.properties,
         updated_at=now()`,
      [JSON.stringify(batch)],
    );
    counters.energyAssets += batch.length;
  }

  const centers = (payload.dataCenters ?? []).map((center) => {
    const {
        id,
        name,
        kind,
        operator,
        countryCode,
        regionId,
        source,
        lat,
        lng,
        ...properties
      } = center;
    return {
      id, name, kind, operator: operator ?? null, country_code: countryCode,
      region_id: regionId ?? null, source, latitude: lat, longitude: lng, properties,
    };
  });
  if (centers.length > 0) {
    await queryWithRetry(
      `INSERT INTO website_data.data_centers (
         id, name, kind, operator, country_code, region_id, source,
         latitude, longitude, properties, updated_at
       )
       SELECT id, name, kind, operator, country_code, region_id, source,
              latitude, longitude, properties, now()
       FROM jsonb_to_recordset($1::jsonb) AS row(
         id text, name text, kind text, operator text, country_code text,
         region_id text, source text, latitude double precision,
         longitude double precision, properties jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, kind=EXCLUDED.kind, operator=EXCLUDED.operator,
         country_code=EXCLUDED.country_code, region_id=EXCLUDED.region_id,
         source=EXCLUDED.source, latitude=EXCLUDED.latitude,
         longitude=EXCLUDED.longitude, properties=EXCLUDED.properties,
         updated_at=now()`,
      [JSON.stringify(centers)],
    );
    counters.dataCenters += centers.length;
  }
  await markImported(normalizedRelativePath(generatedMapPath), counters.energyAssets + counters.dataCenters);
}

async function importJsonDocuments() {
  const files = [];
  for await (const filePath of walkFiles(publicDataRoot)) {
    if (path.extname(filePath).toLowerCase() !== ".json") {
      continue;
    }
    const relativePath = normalizedRelativePath(filePath);
    if (relativePath.includes("/climate-vre/hourly/")) {
      continue;
    }
    files.push(filePath);
  }

  for (const filePath of files) {
    const relativePath = normalizedRelativePath(filePath);
    try {
      const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
      await queryWithRetry(
        `INSERT INTO website_data.json_documents (path, dataset, payload, updated_at)
         VALUES ($1,$2,$3::jsonb,now())
         ON CONFLICT (path) DO UPDATE SET
           dataset=EXCLUDED.dataset, payload=EXCLUDED.payload, updated_at=now()`,
        [relativePath, datasetForPath(relativePath), JSON.stringify(payload)],
      );
      await markImported(relativePath, Array.isArray(payload) ? payload.length : 1);
      counters.jsonDocuments += 1;
    } catch (error) {
      counters.errors += 1;
      await markError(relativePath, error);
      console.error(`Could not import JSON ${relativePath}: ${errorMessage(error)}`);
    }
  }
}

async function importGeoJsonFiles() {
  const files = [];
  for await (const filePath of walkFiles(publicDataRoot)) {
    if (path.extname(filePath).toLowerCase() === ".geojson") {
      files.push(filePath);
    }
  }

  for (const filePath of files) {
    const relativePath = normalizedRelativePath(filePath);
    if (!isWebsiteGeoJson(relativePath)) {
      await queryWithRetry(
        `UPDATE website_data.source_files
         SET import_status='cataloged-duplicate', record_count=NULL,
             error='Full GeoJSON duplicates the website vector-tile dataset; retained in the verified source catalog instead of expanding every feature.',
             imported_at=now()
         WHERE path=$1`,
        [relativePath],
      );
      console.log(`Catalog-only duplicate GeoJSON ${relativePath}`);
      continue;
    }
    console.log(`Importing GeoJSON ${relativePath}...`);
    try {
      const collection = JSON.parse(await fs.readFile(filePath, "utf8"));
      const features = Array.isArray(collection.features) ? collection.features : [];
      for (let offset = 0; offset < features.length; offset += 2000) {
        const batch = features.slice(offset, offset + 2000);
        const params = [];
        const placeholders = batch.map((feature, index) => {
          const base = index * 7;
          params.push(
            relativePath,
            offset + index,
            datasetForPath(relativePath),
            feature.id === undefined ? null : String(feature.id),
            feature.geometry?.type ?? null,
            JSON.stringify(feature.geometry ?? null),
            JSON.stringify(feature.properties ?? {}),
          );
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb,$${base + 7}::jsonb)`;
        });
        if (batch.length > 0) {
          await queryWithRetry(
            `INSERT INTO website_data.geo_features (
               source_path, feature_index, dataset, feature_id,
               geometry_type, geometry, properties
             ) VALUES ${placeholders.join(",")}
             ON CONFLICT (source_path, feature_index) DO UPDATE SET
               dataset=EXCLUDED.dataset, feature_id=EXCLUDED.feature_id,
               geometry_type=EXCLUDED.geometry_type, geometry=EXCLUDED.geometry,
               properties=EXCLUDED.properties`,
            params,
          );
        }
        if (offset > 0 && offset % 50_000 === 0) {
          console.log(`Imported ${offset}/${features.length} features from ${relativePath}...`);
        }
      }
      await queryWithRetry(
        `DELETE FROM website_data.geo_features
         WHERE source_path = $1 AND feature_index >= $2`,
        [relativePath, features.length],
      );
      await markImported(relativePath, features.length);
      counters.geoFeatures += features.length;
    } catch (error) {
      counters.errors += 1;
      await markError(relativePath, error);
      console.error(`Could not import GeoJSON ${relativePath}: ${errorMessage(error)}`);
    }
  }
}

async function importVectorTiles() {
  for await (const filePath of walkFiles(publicDataRoot)) {
    if (path.extname(filePath).toLowerCase() !== ".pbf") {
      continue;
    }
    const relativePath = normalizedRelativePath(filePath);
    const tile = tileCoordinates(relativePath);
    try {
      const content = gzipSync(await fs.readFile(filePath), { level: 6 });
      await queryWithRetry(
        `INSERT INTO website_data.vector_tiles (
           path, dataset, z, x, y, content, content_encoding, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'gzip',now())
         ON CONFLICT (path) DO UPDATE SET
           dataset=EXCLUDED.dataset, z=EXCLUDED.z, x=EXCLUDED.x, y=EXCLUDED.y,
           content=EXCLUDED.content, content_encoding='gzip', updated_at=now()`,
        [
          relativePath,
          datasetForPath(relativePath),
          tile?.z ?? null,
          tile?.x ?? null,
          tile?.y ?? null,
          content,
        ],
      );
      await markImported(relativePath, 1);
      counters.vectorTiles += 1;
      console.log(`Imported vector tile ${counters.vectorTiles}: ${relativePath}`);
    } catch (error) {
      counters.errors += 1;
      await markError(relativePath, error);
      console.error(`Could not import tile ${relativePath}: ${errorMessage(error)}`);
    }
  }
}

async function importClimateHourly() {
  const hourlyRoot = path.join(publicDataRoot, "climate-vre", "hourly");
  let pending = [];
  for await (const filePath of walkFiles(hourlyRoot)) {
    if (path.extname(filePath).toLowerCase() !== ".json") {
      continue;
    }
    const relativePath = normalizedRelativePath(filePath);
    try {
      const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
      const {
        gcm = "gfdl-esm4",
        scenario = "ssp126",
        regionId,
        year,
        technology,
        regionLabel,
        capacityMw,
        scale,
        hours,
        values,
        stats,
        ...metadata
      } = payload;
      pending.push({
        relativePath,
        recordCount: values.length,
        row: {
          gcm, scenario, region_id: regionId, year, technology, region_label: regionLabel,
          capacity_mw: capacityMw, scale, hours, values_json: values, stats, metadata,
        },
      });
      if (pending.length >= 25) {
        await flushClimateBatch(pending);
        pending = [];
      }
    } catch (error) {
      counters.errors += 1;
      await markError(relativePath, error);
      console.error(`Could not import climate file ${relativePath}: ${errorMessage(error)}`);
    }
  }
  if (pending.length > 0) {
    await flushClimateBatch(pending);
  }
}

async function flushClimateBatch(batch) {
  await queryWithRetry(
    `INSERT INTO website_data.climate_vre_hourly (
       gcm, scenario, region_id, year, technology, region_label, capacity_mw, scale,
       hours, values_json, stats, metadata
     )
     SELECT gcm, scenario, region_id, year, technology, region_label, capacity_mw, scale,
            hours, values_json, stats, metadata
     FROM jsonb_to_recordset($1::jsonb) AS row(
       gcm text, scenario text, region_id text, year integer, technology text, region_label text,
       capacity_mw double precision, scale double precision, hours integer,
       values_json jsonb, stats jsonb, metadata jsonb
     )
     ON CONFLICT (gcm,scenario,region_id,year,technology) DO UPDATE SET
       region_label=EXCLUDED.region_label, capacity_mw=EXCLUDED.capacity_mw,
       scale=EXCLUDED.scale, hours=EXCLUDED.hours,
       values_json=EXCLUDED.values_json, stats=EXCLUDED.stats,
       metadata=EXCLUDED.metadata`,
    [JSON.stringify(batch.map((item) => item.row))],
  );
  for (const item of batch) {
    await markImported(item.relativePath, item.recordCount);
  }
  counters.climateHourly += batch.length;
  if (counters.climateHourly % 100 === 0) {
    console.log(`Imported ${counters.climateHourly} climate hourly files...`);
  }
}

async function markImported(relativePath, recordCount) {
  await queryWithRetry(
    `UPDATE website_data.source_files
     SET import_status='imported', record_count=$2, error=NULL, imported_at=now()
     WHERE path=$1`,
    [relativePath, recordCount],
  );
}

async function markError(relativePath, error) {
  await queryWithRetry(
    `UPDATE website_data.source_files
     SET import_status='error', error=$2, imported_at=now()
     WHERE path=$1`,
    [relativePath, errorMessage(error)],
  );
}

async function queryWithRetry(text, values = [], attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await pool.query(text, values);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

function isRetryable(error) {
  const message = errorMessage(error).toLowerCase();
  return [
    "timeout",
    "connection terminated",
    "connection reset",
    "server closed the connection",
    "econnreset",
    "econnrefused",
  ].some((token) => message.includes(token));
}

async function* walkFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function loadExistingCatalog() {
  const result = await queryWithRetry(
    "SELECT path, size_bytes, modified_at, sha256 FROM website_data.source_files",
  );
  for (const row of result.rows) {
    existingCatalog.set(row.path, row);
  }
}

function normalizedRelativePath(filePath) {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

function datasetForPath(relativePath) {
  const parts = relativePath.split("/");
  const publicDataIndex = parts.findIndex((part, index) => part === "public" && parts[index + 1] === "data");
  if (publicDataIndex >= 0) {
    return parts[publicDataIndex + 2] ?? "public-data";
  }
  if (parts[0] === "data") {
    return "raw-source";
  }
  return "generated-map";
}

function mediaTypeForPath(filePath) {
  return {
    ".csv": "text/csv",
    ".dbf": "application/x-dbf",
    ".geojson": "application/geo+json",
    ".json": "application/json",
    ".mat": "application/x-matlab-data",
    ".pbf": "application/x-protobuf",
    ".pdf": "application/pdf",
    ".shp": "application/x-esri-shapefile",
    ".tif": "image/tiff",
    ".txt": "text/plain",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
  }[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function tileCoordinates(relativePath) {
  const match = relativePath.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
  return match ? { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
}

function isWebsiteGeoJson(relativePath) {
  return process.env.DATA_IMPORT_INCLUDE_FULL_GEOJSON === "true"
    || relativePath.includes("/public/data/natural-earth/")
    || relativePath.endsWith("/osm-power/china-transmission-preview.geojson")
    || relativePath.endsWith("/osm-power/china-transmission-detail-preview.geojson");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function loadLocalEnvironment() {
  const envPath = path.join(repoRoot, ".env.local");
  let contents;
  try {
    contents = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

await main();
