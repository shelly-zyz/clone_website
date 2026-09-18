#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";
import { acquireWeatherSyncLock, releaseWeatherSyncLock } from "./weather-sync-lock.mjs";

dotenv.config({ path: ".env.local", quiet: true });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = path.join(repoRoot, ".weather-cache");
const manifestPath = path.join(cacheDirectory, "manifest.json");
const statusPath = path.join(cacheDirectory, "live-sync-status.json");
const lockPath = path.join(cacheDirectory, "live-sync.lock");
const projectWeatherPython = path.resolve(repoRoot, "..", "outputs", "20260904-pg-migration", "venv", "Scripts", "python.exe");
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

async function run(command, args, label, timeoutMs = 5 * 60_000) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} ${timedOut ? "timed out" : `failed with exit ${code}`}: ${(stderr || stdout).trim().slice(-2000)}`));
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

async function syncOnce(lockRecovery = null) {
  const startedAt = new Date().toISOString();
  const stages = {
    acquisitionAndDecode: { status: "running", startedAt },
    cacheValidation: { status: "pending" },
    databaseImport: { status: "pending" },
    databaseVerification: { status: "pending" },
  };
  try {
    await writeStatus({ ok: false, state: "running", startedAt, stages, lockRecovery });
    await run(process.execPath, ["scripts/update-weather-earth-data.mjs", "--quiet"], "GFS download and decode");
    stages.acquisitionAndDecode = { ...stages.acquisitionAndDecode, status: "complete", finishedAt: new Date().toISOString() };
    stages.cacheValidation = { status: "running", startedAt: new Date().toISOString() };
    await writeStatus({ ok: false, state: "running", startedAt, stages, lockRecovery });
    const cache = await validateCache();
    stages.cacheValidation = { ...stages.cacheValidation, status: "complete", finishedAt: new Date().toISOString() };
    const pythonCommand = process.env.WEATHER_PYTHON || (existsSync(projectWeatherPython) ? projectWeatherPython : "python");
    stages.databaseImport = { status: "running", startedAt: new Date().toISOString() };
    await writeStatus({ ok: false, state: "running", startedAt, stages, lockRecovery });
    await retry(
      () => run(pythonCommand, ["scripts/import-weather-cache-to-postgres.py"], "GFS database import"),
      "GFS database import",
    );
    stages.databaseImport = { ...stages.databaseImport, status: "complete", finishedAt: new Date().toISOString() };
    stages.databaseVerification = { status: "running", startedAt: new Date().toISOString() };
    const database = await retry(
      () => verifyDatabase(cache.manifest),
      "GFS database verification",
    );
    stages.databaseVerification = { ...stages.databaseVerification, status: "complete", finishedAt: new Date().toISOString() };
    const status = {
      ok: true, state: "complete", startedAt, finishedAt: new Date().toISOString(),
      source: "NOAA/NCEP GFS", sourceType: "near-real-time operational forecast",
      runTimeUtc: cache.manifest.runTimeUtc, validTimeUtc: cache.manifest.validTimeUtc,
      forecastHour: cache.manifest.forecastHour, runAgeHours: Number(cache.runAgeHours.toFixed(2)),
      metrics: cache.fields, database, stages, lockRecovery,
    };
    await writeStatus(status);
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    const failedAt = new Date().toISOString();
    for (const stage of Object.values(stages)) {
      if (stage.status === "running") Object.assign(stage, { status: "failed", finishedAt: failedAt });
    }
    await writeStatus({ ok: false, state: "failed", startedAt, failedAt, error: error instanceof Error ? error.message : String(error), stages, lockRecovery });
    throw error;
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  await fs.mkdir(cacheDirectory, { recursive: true });
  const lock = await acquireWeatherSyncLock(lockPath);

  try {
    do {
      try {
        await syncOnce(lock.recovered);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        if (!watchMode) throw error;
      }
      if (watchMode) await delay(intervalMinutes * 60_000);
    } while (watchMode);
  } finally {
    await releaseWeatherSyncLock(lockPath, lock);
  }
}

main().catch(() => {
  process.exitCode = 1;
});
