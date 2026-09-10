#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..");
export const defaultOutputDir = path.resolve(repoRoot, ".forecast-data/noaa-gfs/hill-of-towie-2025");
export const defaultProfilePath = path.resolve(repoRoot, ".forecast-data/hill-of-towie/site-profile.json");
export const defaultDecoderPath = path.resolve(scriptDir, "decode-gfs-point.py");
export const DEFAULT_SOURCE_ID = "noaa-ncei-gfs-forecast-grid004";
export const DEFAULT_START = "2025-01-01T00:00:00Z";
export const DEFAULT_END = "2026-01-01T00:00:00Z";
export const DEFAULT_FORECAST_HOURS = [3, 6];
export const GFS_BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
export const SELECTED_FIELDS = [
  { shortName: "UGRD", level: "100 m above ground", output: "u100_mps" },
  { shortName: "VGRD", level: "100 m above ground", output: "v100_mps" },
];

function parseDate(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z")) throw new Error(`${label} must be an ISO timestamp ending in Z`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is not a valid ISO timestamp`);
  return date;
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

export function formatDate(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

export function formatCycle(date) {
  return pad(date.getUTCHours());
}

export function formatForecastHour(value) {
  return `f${pad(value, 3)}`;
}

export function buildGfsUrl(issueTime, forecastHour) {
  const date = formatDate(issueTime);
  const cycle = formatCycle(issueTime);
  return `${GFS_BASE_URL}/gfs.${date}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.0p50.${formatForecastHour(forecastHour)}`;
}

export function buildGfsIndexUrl(issueTime, forecastHour) {
  return `${buildGfsUrl(issueTime, forecastHour)}.idx`;
}

export function toIso(date) {
  return date.toISOString().replace(".000Z", "Z");
}

export function taskKey(task) {
  return `${toIso(task.issueTime)}|${task.forecastHour}`;
}

export function generateTasks(startValue = DEFAULT_START, endValue = DEFAULT_END, forecastHours = DEFAULT_FORECAST_HOURS) {
  const start = startValue instanceof Date ? new Date(startValue) : parseDate(startValue, "start");
  const end = endValue instanceof Date ? new Date(endValue) : parseDate(endValue, "end");
  if (start >= end) throw new Error("start must precede end");
  if (!Array.isArray(forecastHours) || forecastHours.length === 0) throw new Error("forecastHours must not be empty");
  const step = 6 * 60 * 60 * 1_000;
  const firstIssue = new Date(Math.floor((start.getTime() - step) / step) * step);
  const tasks = [];
  for (let issueMs = firstIssue.getTime(); issueMs <= end.getTime(); issueMs += step) {
    const issueTime = new Date(issueMs);
    for (const forecastHour of forecastHours) {
      if (!Number.isInteger(forecastHour) || forecastHour <= 0 || forecastHour > 192) throw new Error(`invalid forecast hour: ${forecastHour}`);
      const validTime = new Date(issueMs + forecastHour * 60 * 60 * 1_000);
      if (validTime < start || validTime > end) continue;
      tasks.push({ issueTime, validTime, forecastHour, url: buildGfsUrl(issueTime, forecastHour), indexUrl: buildGfsIndexUrl(issueTime, forecastHour) });
    }
  }
  return tasks.sort((left, right) => left.validTime - right.validTime || left.issueTime - right.issueTime);
}

export function parseGfsIndex(text) {
  if (typeof text !== "string" || text.trim() === "") throw new Error("GFS index is empty");
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\d+:(\d+):d=(\d{10}):([^:]+):([^:]+):/);
    if (!match) continue;
    records.push({ offset: Number(match[1]), referenceTime: match[2], shortName: match[3], level: match[4], raw: line });
  }
  records.sort((left, right) => left.offset - right.offset);
  return records.map((record, index) => ({ ...record, end: records[index + 1] ? records[index + 1].offset - 1 : null }));
}

export function selectGfsWindRange(indexText) {
  const records = parseGfsIndex(indexText);
  const selected = SELECTED_FIELDS.map((field) => records.find((record) => record.shortName === field.shortName && record.level === field.level));
  const missing = SELECTED_FIELDS.filter((_field, index) => !selected[index]);
  if (missing.length) throw new Error(`GFS index is missing: ${missing.map((field) => `${field.shortName}:${field.level}`).join(", ")}`);
  if (selected.some((record) => record.end === null)) throw new Error("GFS selected range has no following record boundary");
  const start = Math.min(...selected.map((record) => record.offset));
  const end = Math.max(...selected.map((record) => record.end));
  return {
    start,
    end,
    bytes: end - start + 1,
    fields: selected.map((record) => ({ shortName: record.shortName, level: record.level, start: record.offset, end: record.end })),
  };
}

function header(response, name) {
  return response?.headers?.get?.(name) ?? response?.headers?.[name] ?? null;
}

async function fetchWithRetry(url, options, fetchImpl, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        const error = new Error(`${label} HTTP ${response.status}`);
        if ([403, 404].includes(response.status)) throw error;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchIndex(url, fetchImpl) {
  const response = await fetchWithRetry(url, { headers: { "user-agent": "OpenGridWorks forecast-data acquisition/1.0" } }, fetchImpl, "GFS index");
  const text = await response.text();
  if (text.length > 600_000) throw new Error("GFS index exceeds the safety limit");
  return { text, etag: header(response, "etag") };
}

function parseContentRange(value) {
  const match = String(value ?? "").match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) throw new Error(`Range response has no valid Content-Range: ${value}`);
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

async function fetchSelectedRange(url, range, fetchImpl) {
  const response = await fetchWithRetry(url, {
    headers: {
      "user-agent": "OpenGridWorks forecast-data acquisition/1.0",
      range: `bytes=${range.start}-${range.end}`,
    },
  }, fetchImpl, "GFS range");
  if (response.status !== 206) throw new Error(`GFS range request returned HTTP ${response.status}; refusing an unbounded download`);
  const contentRange = parseContentRange(header(response, "content-range"));
  const bytes = Buffer.from(await response.arrayBuffer());
  if (contentRange.start !== range.start || contentRange.end !== range.end || bytes.length !== range.bytes) {
    throw new Error(`GFS range length mismatch: expected ${range.start}-${range.end} (${range.bytes}), received ${contentRange.start}-${contentRange.end} (${bytes.length})`);
  }
  return {
    bytes,
    totalBytes: contentRange.total,
    etag: header(response, "etag"),
    md5: createHash("md5").update(bytes).digest("hex"),
  };
}

export function resolvePythonPath(root = repoRoot, environment = process.env) {
  const candidates = [
    environment.FORECAST_PYTHON,
    path.resolve(root, "../outputs/20260904-pg-migration/venv/Scripts/python.exe"),
    path.resolve(root, ".forecast-data/model-venv/Scripts/python.exe"),
    "python",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "python" || existsSync(candidate)) ?? "python";
}

async function decodePoint({ payload, task, target, workDir, pythonPath, decoderPath }) {
  const safeName = `${formatDate(task.issueTime)}-${formatCycle(task.issueTime)}-${formatForecastHour(task.forecastHour)}.grib2`;
  const workPath = path.join(workDir, safeName);
  await writeFile(workPath, payload);
  try {
    const { stdout } = await execFile(pythonPath, [
      decoderPath,
      workPath,
      "--latitude", String(target.latitude),
      "--longitude", String(target.longitude),
      "--issue-time", toIso(task.issueTime),
      "--valid-time", toIso(task.validTime),
      "--forecast-hour", String(task.forecastHour),
    ], { maxBuffer: 1_000_000, windowsHide: true });
    return JSON.parse(stdout);
  } finally {
    await unlink(workPath).catch(() => {});
  }
}

async function loadTarget(profilePath, latitude, longitude) {
  if (latitude !== undefined && longitude !== undefined) return { latitude: Number(latitude), longitude: Number(longitude) };
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  const centroid = profile?.entity?.centroid;
  if (!Number.isFinite(centroid?.latitude) || !Number.isFinite(centroid?.longitude)) throw new Error("Hill of Towie profile has no finite centroid");
  return { latitude: centroid.latitude, longitude: centroid.longitude };
}

async function loadExistingRecords(outputPath) {
  const existing = new Map();
  let text;
  try {
    text = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return existing;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.issue_time && Number.isInteger(record?.forecast_hour)) existing.set(`${record.issue_time}|${record.forecast_hour}`, record);
    } catch {
      throw new Error(`Invalid JSON line in ${outputPath}`);
    }
  }
  return existing;
}

async function writeStatus(statusPath, status) {
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export function parseArguments(args) {
  const options = {
    start: DEFAULT_START,
    end: DEFAULT_END,
    forecastHours: DEFAULT_FORECAST_HOURS,
    concurrency: 3,
    outputDir: defaultOutputDir,
    profilePath: defaultProfilePath,
    limit: null,
    latitude: undefined,
    longitude: undefined,
    allowMissing: false,
    dryRun: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--year") {
      const year = Number(args[++index]);
      if (!Number.isInteger(year) || year < 2006 || year > 2100) throw new Error("--year requires a supported integer year");
      options.start = `${year}-01-01T00:00:00Z`;
      options.end = `${year + 1}-01-01T00:00:00Z`;
    } else if (argument === "--start") options.start = args[++index];
    else if (argument === "--end") options.end = args[++index];
    else if (argument === "--output") options.outputDir = path.resolve(args[++index] ?? "");
    else if (argument === "--profile") options.profilePath = path.resolve(args[++index] ?? "");
    else if (argument === "--concurrency") options.concurrency = Number(args[++index]);
    else if (argument === "--limit") options.limit = Number(args[++index]);
    else if (argument === "--latitude") options.latitude = Number(args[++index]);
    else if (argument === "--longitude") options.longitude = Number(args[++index]);
    else if (argument === "--allow-missing") options.allowMissing = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) throw new Error("--concurrency must be an integer from 1 to 8");
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("--limit must be a positive integer");
  if ((options.latitude !== undefined) !== (options.longitude !== undefined)) throw new Error("--latitude and --longitude must be supplied together");
  if (options.latitude !== undefined && (options.latitude < -90 || options.latitude > 90 || options.longitude < -180 || options.longitude > 180)) throw new Error("target coordinates are out of range");
  return options;
}

export async function acquire(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const target = dependencies.target ?? await loadTarget(options.profilePath ?? defaultProfilePath, options.latitude, options.longitude);
  const allTasks = generateTasks(options.start, options.end, options.forecastHours ?? DEFAULT_FORECAST_HOURS);
  const tasks = options.limit ? allTasks.slice(0, options.limit) : allTasks;
  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir);
  const outputPath = path.join(outputDir, "hill-of-towie-2025-gfs-100m.ndjson");
  const statusPath = path.join(outputDir, "acquisition-status.json");
  const workDir = path.join(outputDir, "work");
  await mkdir(workDir, { recursive: true });
  const existing = await loadExistingRecords(outputPath);
  const pending = tasks.filter((task) => !existing.has(taskKey(task)));
  if (options.dryRun) return { sourceId: DEFAULT_SOURCE_ID, target, totalTasks: tasks.length, pendingTasks: pending.length, firstTasks: tasks.slice(0, 5).map((task) => ({ issueTime: toIso(task.issueTime), validTime: toIso(task.validTime), forecastHour: task.forecastHour, url: task.url })) };

  const pythonPath = dependencies.pythonPath ?? resolvePythonPath(repoRoot, dependencies.environment ?? process.env);
  const decoderPath = dependencies.decoderPath ?? defaultDecoderPath;
  const stats = { totalTasks: tasks.length, existing: tasks.length - pending.length, completed: 0, failed: 0, failures: [] };
  const statusBase = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      id: DEFAULT_SOURCE_ID,
      product: "NOAA GFS 0.5 degree pgrb2",
      provider: "NOAA Big Data Program AWS Open Data",
      bucket: "noaa-gfs-bdp-pds",
      productUrl: "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast",
      objectPattern: "gfs.YYYYMMDD/HH/atmos/gfs.tHHz.pgrb2.0p50.fFFF",
      indexSuffix: ".idx",
      dataIdentity: "historical-issued-forecast",
      resolutionDegrees: 0.5,
      selectedFields: SELECTED_FIELDS,
    },
    target: { entityId: "hill-of-towie", ...target, selection: "nearest grid point to verified site centroid" },
    selection: { start: options.start, end: options.end, forecastHours: options.forecastHours ?? DEFAULT_FORECAST_HOURS, interpolation: "linear vector interpolation between 3-hour valid points during pairing" },
    acquisition: { status: "running", outputPath, ...stats },
    productionGate: { unlocked: false, blockers: ["Historical issued NWP point extraction and local hourly pairing are complete, but the 6,605-row pair set remains research-only until the source-quality gate passes.", "Hill of Towie exposes source-reported PowerRed/PowerRef reduction evidence but no authoritative grid-curtailment label.", "Model metrics must still beat the persistence baseline before the UI may display a formal forecast."] },
  };
  await writeStatus(statusPath, statusBase);
  let cursor = 0;
  let writeQueue = Promise.resolve();
  const appendRecord = (record) => {
    writeQueue = writeQueue.then(() => appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8"));
    return writeQueue;
  };
  const workers = Array.from({ length: Math.min(options.concurrency, Math.max(1, pending.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length || (!options.allowMissing && stats.failed > 0)) return;
      const task = pending[index];
      try {
        const indexPayload = await fetchIndex(task.indexUrl, fetchImpl);
        const range = selectGfsWindRange(indexPayload.text);
        const payload = await fetchSelectedRange(task.url, range, fetchImpl);
        const point = await decodePoint({ payload: payload.bytes, task, target, workDir, pythonPath, decoderPath });
        const record = {
          source_id: DEFAULT_SOURCE_ID,
          issue_time: point.issue_time,
          valid_time: point.valid_time,
          forecast_hour: point.forecast_hour,
          target_latitude: point.target_latitude,
          target_longitude: point.target_longitude,
          grid_latitude: point.grid_latitude,
          grid_longitude: point.grid_longitude,
          u100_mps: point.u100_mps,
          v100_mps: point.v100_mps,
          wind_speed_mps: point.wind_speed_mps,
          quality_code: "valid",
          source_file_url: task.url,
          source_index_url: task.indexUrl,
          source_file_etag: payload.etag,
          source_file_bytes: payload.totalBytes,
          selected_range_start: range.start,
          selected_range_end: range.end,
          selected_payload_bytes: payload.bytes.length,
          selected_payload_md5: payload.md5,
          selected_fields: range.fields,
        };
        existing.set(taskKey(task), record);
        await appendRecord(record);
        stats.completed += 1;
        if (stats.completed % 10 === 0 || stats.completed === pending.length) {
          statusBase.acquisition = { status: "running", outputPath, ...stats };
          await writeStatus(statusPath, statusBase);
          console.error(`GFS point extraction: ${stats.completed}/${pending.length} new files`);
        }
      } catch (error) {
        stats.failed += 1;
        const failure = { issueTime: toIso(task.issueTime), validTime: toIso(task.validTime), forecastHour: task.forecastHour, message: error instanceof Error ? error.message : String(error) };
        stats.failures.push(failure);
        console.error(`GFS point extraction failed: ${failure.issueTime} f${pad(task.forecastHour, 3)} — ${failure.message}`);
      }
    }
  });
  await Promise.all(workers);
  await writeQueue;
  statusBase.acquisition = { status: stats.failed === 0 ? "point-values-verified" : "partial-failure", outputPath, ...stats };
  await writeStatus(statusPath, statusBase);
  if (stats.failed > 0 && !options.allowMissing) throw new Error(`GFS acquisition stopped after ${stats.failed} failure(s); rerun with --allow-missing only after reviewing acquisition-status.json`);
  return statusBase;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await acquire(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
