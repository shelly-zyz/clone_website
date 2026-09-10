#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateTasks, taskKey } from "./acquire-hill-of-towie-gfs.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(scriptDir, "../.forecast-data/noaa-gfs/hill-of-towie-2025/hill-of-towie-2025-gfs-100m.ndjson");

export async function verify(filePath = defaultPath, start = "2025-01-01T00:00:00Z", end = "2026-01-01T00:00:00Z") {
  const text = await readFile(filePath, "utf8");
  const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const expected = generateTasks(start, end);
  const expectedKeys = new Set(expected.map(taskKey));
  const seenKeys = new Set();
  const validTimes = new Set();
  const gridPoints = new Set();
  const failures = [];
  for (const record of records) {
    const key = `${record.issue_time}|${record.forecast_hour}`;
    if (seenKeys.has(key)) failures.push(`duplicate task ${key}`);
    seenKeys.add(key);
    if (!expectedKeys.has(key)) failures.push(`unexpected task ${key}`);
    if (record.issue_time >= record.valid_time) failures.push(`issue does not precede valid: ${key}`);
    const valid = Date.parse(record.valid_time);
    const issue = Date.parse(record.issue_time);
    if (!Number.isFinite(valid) || !Number.isFinite(issue) || valid !== issue + record.forecast_hour * 3_600_000) failures.push(`invalid issue/valid/forecast-hour relation: ${key}`);
    if (record.quality_code !== "valid") failures.push(`non-valid quality code: ${key}`);
    if (![3, 6].includes(record.forecast_hour)) failures.push(`unexpected forecast hour: ${key}`);
    if (!Number.isFinite(record.wind_speed_mps) || record.wind_speed_mps < 0) failures.push(`invalid wind speed: ${key}`);
    validTimes.add(record.valid_time);
    gridPoints.add(`${record.grid_latitude}|${record.grid_longitude}`);
  }
  for (const task of expected) if (!seenKeys.has(taskKey(task))) failures.push(`missing task ${taskKey(task)}`);
  const result = {
    checkedAt: new Date().toISOString(),
    filePath,
    expectedTasks: expected.length,
    recordCount: records.length,
    distinctValidTimes: validTimes.size,
    distinctGridPoints: gridPoints.size,
    earliestValidUtc: records.length ? records.map((record) => record.valid_time).sort()[0] : null,
    latestValidUtc: records.length ? records.map((record) => record.valid_time).sort().at(-1) : null,
    sourceFileBytes: {
      distinct: new Set(records.map((record) => record.source_file_bytes)).size,
      min: Math.min(...records.map((record) => record.source_file_bytes)),
      max: Math.max(...records.map((record) => record.source_file_bytes)),
    },
    selectedPayloadBytes: records.length ? { min: Math.min(...records.map((record) => record.selected_payload_bytes)), max: Math.max(...records.map((record) => record.selected_payload_bytes)) } : null,
    failures,
    status: failures.length === 0 && records.length === expected.length ? "verified" : "invalid",
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "verified") process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  verify(process.argv[2] ? path.resolve(process.argv[2]) : defaultPath).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
