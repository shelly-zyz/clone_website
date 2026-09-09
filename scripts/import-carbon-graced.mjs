import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const schemaPath = path.join(scriptDir, "database-schema.sql");

console.log("Loading PostgreSQL environment...");
await loadLocalEnvironment();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const manifestArgument = argumentValue("--manifest");
const manifestPath = manifestArgument
  ? path.resolve(repoRoot, manifestArgument)
  : await latestManifest();
const maxNewFramesArgument = argumentValue("--max-new-frames");
const maxNewFrames = maxNewFramesArgument ? Number.parseInt(maxNewFramesArgument, 10) : 0;
if (!Number.isInteger(maxNewFrames) || maxNewFrames < 0) {
  throw new Error(`Invalid --max-new-frames value: ${maxNewFramesArgument}`);
}
console.log(`Reading carbon manifest: ${manifestPath}`);
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
validateManifest(manifest);

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  max: 1,
  query_timeout: 300_000,
  statement_timeout: 300_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

try {
  const fullSchema = await fs.readFile(schemaPath, "utf8");
  const carbonSchemaStart = fullSchema.indexOf(
    "CREATE TABLE IF NOT EXISTS website_data.carbon_source_archives",
  );
  if (carbonSchemaStart < 0) {
    throw new Error("Carbon database schema was not found.");
  }
  console.log("Applying carbon database schema...");
  for (const statement of fullSchema.slice(carbonSchemaStart).split(";").map((item) => item.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  console.log("Importing carbon archive and frames with per-statement commits...");
  await importArchive(manifest);
  console.log(`Imported archive metadata for ${manifest.sector} / ${manifest.month}`);
  let importedFrames = 0;
  for (const frame of manifest.frames) {
    const imported = await importFrame(manifest, frame);
    if (imported) {
      importedFrames += 1;
      if (maxNewFrames > 0 && importedFrames >= maxNewFrames) {
        break;
      }
    }
  }
  console.log(JSON.stringify({
    ok: true,
    manifest: path.relative(workspaceRoot, manifestPath).split(path.sep).join("/"),
    sector: manifest.sector,
    month: manifest.month,
    frames: manifest.frames.length,
    importedFrames,
  }, null, 2));
} catch (error) {
  throw error;
} finally {
  await pool.end();
}

async function importArchive(payload) {
  const source = payload.source;
  await pool.query(
    `INSERT INTO website_data.carbon_source_archives (
       official_id, sector, data_month, file_name, file_size_label, source_url,
       api_updated_at, archive_sha256, local_archive_path, local_netcdf_path,
       source_attributes, imported_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now())
     ON CONFLICT (official_id) DO UPDATE SET
       sector=EXCLUDED.sector,
       data_month=EXCLUDED.data_month,
       file_name=EXCLUDED.file_name,
       file_size_label=EXCLUDED.file_size_label,
       source_url=EXCLUDED.source_url,
       api_updated_at=EXCLUDED.api_updated_at,
       archive_sha256=EXCLUDED.archive_sha256,
       local_archive_path=EXCLUDED.local_archive_path,
       local_netcdf_path=EXCLUDED.local_netcdf_path,
       source_attributes=EXCLUDED.source_attributes,
       imported_at=now()`,
    [
      source.officialId,
      payload.sector,
      `${payload.month}-01`,
      source.fileName,
      source.fileSizeLabel ?? null,
      source.url,
      parseApiTimestamp(source.apiUpdatedAt),
      source.archiveSha256,
      source.localArchivePath,
      source.localNetcdfPath,
      JSON.stringify(source.attributes ?? {}),
    ],
  );
}

async function importFrame(payload, frame) {
  if (await frameAlreadyImported(payload.sector, frame)) {
    console.log(`Skipping existing ${payload.sector} / ${frame.date}`);
    return false;
  }

  const framePath = path.resolve(workspaceRoot, frame.path);
  assertWithinWorkspace(framePath);
  const frameData = await fs.readFile(framePath);
  if (frameData.length !== frame.sizeBytes) {
    throw new Error(`Frame size mismatch for ${frame.path}.`);
  }
  if (createHash("sha256").update(frameData).digest("hex") !== frame.sha256) {
    throw new Error(`Frame SHA-256 mismatch for ${frame.path}.`);
  }

  const { grid, encoding } = payload;
  const stats = frame.stats;
  await pool.query(
    `INSERT INTO website_data.carbon_emission_frames (
       observed_on, sector, source_archive_id, unit, width, height,
       longitude_min, latitude_max, dx, dy, data_type, byte_order,
       compression, frame_data, frame_sha256, min_value, max_value,
       mean_value, sum_kgc_per_hour, nonzero_count, statistics, imported_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,now()
     )
     ON CONFLICT (observed_on, sector) DO UPDATE SET
       source_archive_id=EXCLUDED.source_archive_id,
       unit=EXCLUDED.unit,
       width=EXCLUDED.width,
       height=EXCLUDED.height,
       longitude_min=EXCLUDED.longitude_min,
       latitude_max=EXCLUDED.latitude_max,
       dx=EXCLUDED.dx,
       dy=EXCLUDED.dy,
       data_type=EXCLUDED.data_type,
       byte_order=EXCLUDED.byte_order,
       compression=EXCLUDED.compression,
       frame_data=EXCLUDED.frame_data,
       frame_sha256=EXCLUDED.frame_sha256,
       min_value=EXCLUDED.min_value,
       max_value=EXCLUDED.max_value,
       mean_value=EXCLUDED.mean_value,
       sum_kgc_per_hour=EXCLUDED.sum_kgc_per_hour,
       nonzero_count=EXCLUDED.nonzero_count,
       statistics=EXCLUDED.statistics,
       imported_at=now()`,
    [
      frame.date,
      payload.sector,
      payload.source.officialId,
      payload.unit,
      grid.width,
      grid.height,
      grid.longitudeMin,
      grid.latitudeMax,
      grid.dx,
      grid.dy,
      encoding.dtype,
      encoding.byteOrder,
      encoding.compression,
      frameData,
      frame.sha256,
      stats.min,
      stats.max,
      stats.mean,
      stats.sumKgCPerHour,
      stats.nonzeroCount,
      JSON.stringify(stats),
    ],
  );
  console.log(`Imported ${payload.sector} / ${frame.date} (${(frameData.length / 1024).toFixed(1)} KiB)`);
  return true;
}

async function frameAlreadyImported(sector, frame) {
  const result = await pool.query(
    `SELECT frame_sha256, octet_length(frame_data) AS bytes
       FROM website_data.carbon_emission_frames
      WHERE sector = $1
        AND observed_on = $2
      LIMIT 1`,
    [sector, frame.date],
  );
  if (result.rowCount > 0 && (result.rows[0].frame_sha256 !== frame.sha256 || Number(result.rows[0].bytes) !== frame.sizeBytes)) {
    throw new Error(`Existing frame differs from source: ${sector}/${frame.date}; refusing overwrite.`);
  }
  return result.rowCount > 0;
}

function validateManifest(payload) {
  if (
    payload?.formatVersion !== 1
    || typeof payload.sector !== "string"
    || !/^\d{4}-\d{2}$/.test(payload.month)
    || !Array.isArray(payload.frames)
    || payload.frames.length === 0
    || !payload.source?.officialId
  ) {
    throw new Error(`Invalid carbon manifest: ${manifestPath}`);
  }
}

function parseApiTimestamp(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).replace(" ", "T");
  const parsed = new Date(`${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function latestManifest() {
  const processedRoot = path.join(workspaceRoot, "data", "carbon-graced", "processed");
  const manifests = [];
  for (const sectorEntry of await fs.readdir(processedRoot, { withFileTypes: true })) {
    if (!sectorEntry.isDirectory()) {
      continue;
    }
    const sectorRoot = path.join(processedRoot, sectorEntry.name);
    for (const monthEntry of await fs.readdir(sectorRoot, { withFileTypes: true })) {
      if (!monthEntry.isDirectory()) {
        continue;
      }
      const candidate = path.join(sectorRoot, monthEntry.name, "manifest.json");
      try {
        const stats = await fs.stat(candidate);
        manifests.push({ path: candidate, modifiedAt: stats.mtimeMs });
      } catch {
        // A month directory may still be in the conversion stage.
      }
    }
  }
  manifests.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!manifests[0]) {
    throw new Error("No processed carbon manifest was found.");
  }
  return manifests[0].path;
}

function assertWithinWorkspace(filePath) {
  const relative = path.relative(workspaceRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Frame path is outside the workspace: ${filePath}`);
  }
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
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
