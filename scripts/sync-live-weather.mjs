#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = path.join(repoRoot, ".weather-cache");
const manifestPath = path.join(cacheDirectory, "manifest.json");
const statusPath = path.join(cacheDirectory, "live-sync-status.json");
const lockPath = path.join(cacheDirectory, "live-sync.lock");
const watchMode = process.argv.includes("--watch");
const intervalMinutes = numberArgument("--interval-minutes", 60);
const expectedMetrics = new Set([
  "wind",
  "temperature",
  "relativeHumidity",
  "cape",
  "mslp",
  "precipitableWater",
  "wind100m",
  "windGust",
  "precipitation",
  "snowDepth",
  "surfacePressure",
  "surfaceSolarRadiation",
  "specificHumidity",
]);

if (watchMode && intervalMinutes < 15) {
  throw new Error("--interval-minutes must be at least 15 to protect the NOAA service.");
}

function numberArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} requires a positive number.`);
  }
  return value;
}

async function run(command, args, label) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit ${code}: ${(stderr || stdout).trim().slice(-2000)}`));
    });
  });
}

async function retry(operation, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(10_000);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function validateCache() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.source !== "GFS" || manifest.refreshStatus !== "live") {
    throw new Error("Weather manifest is not a live GFS refresh.");
  }
  const runTime = Date.parse(manifest.runTimeUtc);
  const validTime = Date.parse(manifest.validTimeUtc);
  if (!Number.isFinite(runTime) || !Number.isFinite(validTime)) {
    throw new Error("Weather manifest timestamps are invalid.");
  }
  const runAgeHours = (Date.now() - runTime) / 3_600_000;
  if (runAgeHours < -1 || runAgeHours > 18) {
    throw new Error(`Latest GFS run is outside the allowed freshness window (${runAgeHours.toFixed(1)}h).`);
  }
  const manifestKeys = new Set(manifest.metrics?.map((metric) => metric.key));
  if (manifestKeys.size !== expectedMetrics.size || [...expectedMetrics].some((key) => !manifestKeys.has(key))) {
    throw new Error("Weather manifest does not contain the exact 13 required metrics.");
  }

  const fields = [];
  for (const metric of manifest.metrics) {
    const filePath = path.join(cacheDirectory, `${metric.key}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    const field = JSON.parse(raw);
    const expectedValues = Number(field.header?.nx) * Number(field.header?.ny);
    const arrays = field.kind === "vector" ? [field.u, field.v] : [field.values];
    const arraysValid = Number.isInteger(expectedValues)
      && expectedValues > 0
      && arrays.every((values) => Array.isArray(values) && values.length === expectedValues);
    if (
      field.key !== metric.key
      || field.source !== "GFS"
      || field.header?.refTime !== manifest.runTimeUtc
      || field.validTimeUtc !== manifest.validTimeUtc
      || !arraysValid
    ) {
      throw new Error(`Weather field validation failed: ${metric.key}.`);
    }
    fields.push({ key: metric.key, bytes: Buffer.byteLength(raw), values: expectedValues });
  }
  return { manifest, fields, runAgeHours };
}

async function verifyDatabase(manifest) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const client = new pg.Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
    statement_timeout: 60_000,
  });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT count(*)::int AS rows,
             count(DISTINCT metric)::int AS metrics,
             count(*) FILTER (WHERE octet_length(payload_json_gzip)=0)::int AS empty_payloads,
             to_char(max(valid_time_utc),'YYYY-MM-DD"T"HH24:MI:SSOF') AS latest_valid
      FROM website_data.weather_forecast_fields
      WHERE source='GFS' AND run_time_utc=$1 AND forecast_hour=$2
    `, [manifest.runTimeUtc, manifest.forecastHour]);
    const row = result.rows[0];
    if (row.rows !== 13 || row.metrics !== 13 || row.empty_payloads !== 0) {
      throw new Error(`Database weather verification failed: ${JSON.stringify(row)}`);
    }
    return row;
  } finally {
    await Promise.race([
      client.end().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    client.connection?.stream?.destroy();
  }
}

async function writeStatus(status) {
  await fs.mkdir(cacheDirectory, { recursive: true });
  const temporaryPath = `${statusPath}.part`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, statusPath);
}

async function syncOnce() {
  const startedAt = new Date().toISOString();
  await run(process.execPath, ["scripts/update-weather-earth-data.mjs", "--quiet"], "GFS download and decode");
  const cache = await validateCache();
  const pythonCommand = process.env.WEATHER_PYTHON || "python";
  await retry(
    () => run(pythonCommand, ["scripts/import-weather-cache-to-postgres.py"], "GFS database import"),
    "GFS database import",
  );
  const database = await retry(
    () => verifyDatabase(cache.manifest),
    "GFS database verification",
  );
  const status = {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    source: "NOAA/NCEP GFS",
    sourceType: "near-real-time operational forecast",
    runTimeUtc: cache.manifest.runTimeUtc,
    validTimeUtc: cache.manifest.validTimeUtc,
    forecastHour: cache.manifest.forecastHour,
    runAgeHours: Number(cache.runAgeHours.toFixed(2)),
    metrics: cache.fields,
    database,
  };
  await writeStatus(status);
  console.log(JSON.stringify(status, null, 2));
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  await fs.mkdir(cacheDirectory, { recursive: true });
  let lock;
  try {
    lock = await fs.open(lockPath, "wx");
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Another live weather sync owns ${lockPath}.`);
    }
    throw error;
  }

  try {
    do {
      try {
        await syncOnce();
      } catch (error) {
        const status = {
          ok: false,
          failedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        };
        await writeStatus(status);
        console.error(JSON.stringify(status, null, 2));
        if (!watchMode) throw error;
      }
      if (watchMode) await delay(intervalMinutes * 60_000);
    } while (watchMode);
  } finally {
    await lock.close();
    await fs.unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

main().catch(() => {
  process.exitCode = 1;
});
