#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOUR_MS = 3_600_000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(scriptDir, "../.forecast-data/noaa-gfs/hill-of-towie-2025/hill-of-towie-2025-training-pairs.ndjson");
const defaultStart = "2025-01-01T00:00:00Z";
const defaultEnd = "2026-01-01T00:00:00Z";

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid timestamp: ${value}`);
  return timestamp;
}

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

export function analyzeCleanWindows(timestamps, {
  start = defaultStart,
  end = defaultEnd,
  windowDays = 90,
  minimumCompleteness = 0.95,
} = {}) {
  const rangeStart = parseTimestamp(start);
  const rangeEnd = parseTimestamp(end);
  const windowHours = windowDays * 24;
  if (rangeEnd <= rangeStart) throw new RangeError("end must be later than start");
  if (!Number.isInteger(windowHours) || windowHours <= 0) throw new RangeError("windowDays must be a positive whole number");
  if (minimumCompleteness < 0 || minimumCompleteness > 1) throw new RangeError("minimumCompleteness must be between 0 and 1");

  const parsed = timestamps.map(parseTimestamp).sort((left, right) => left - right);
  const unique = [...new Set(parsed)];
  const duplicateRows = parsed.length - unique.length;
  const runs = [];
  let runStart = null;
  let previous = null;
  for (const timestamp of unique) {
    if (runStart === null || timestamp - previous !== HOUR_MS) {
      if (runStart !== null) runs.push({ start: iso(runStart), end: iso(previous), hours: Math.round((previous - runStart) / HOUR_MS) + 1 });
      runStart = timestamp;
    }
    previous = timestamp;
  }
  if (runStart !== null) runs.push({ start: iso(runStart), end: iso(previous), hours: Math.round((previous - runStart) / HOUR_MS) + 1 });
  runs.sort((left, right) => right.hours - left.hours || left.start.localeCompare(right.start));

  const windowDuration = windowHours * HOUR_MS;
  const expectedHours = Math.round((rangeEnd - rangeStart) / HOUR_MS);
  let left = 0;
  let right = 0;
  let bestWindow = null;
  for (let windowStart = rangeStart; windowStart + windowDuration <= rangeEnd; windowStart += HOUR_MS) {
    const windowEnd = windowStart + windowDuration;
    while (left < unique.length && unique[left] < windowStart) left += 1;
    while (right < unique.length && unique[right] < windowEnd) right += 1;
    const validHours = Math.max(0, right - left);
    const candidate = {
      start: iso(windowStart),
      end: iso(windowEnd - HOUR_MS),
      validHours,
      expectedHours: windowHours,
      completeness: Number((validHours / windowHours).toFixed(4)),
    };
    if (!bestWindow || candidate.validHours > bestWindow.validHours) bestWindow = candidate;
  }

  const maximumCompleteness = bestWindow?.completeness ?? 0;
  return {
    rows: timestamps.length,
    uniqueRows: unique.length,
    duplicateRows,
    range: { start: iso(rangeStart), end: iso(rangeEnd), expectedHours },
    contiguousRuns: runs.length,
    longestContiguousRun: runs[0] ?? null,
    rollingWindow: {
      windowDays,
      minimumCompleteness,
      maximum: bestWindow,
      eligible: maximumCompleteness >= minimumCompleteness,
    },
    topContiguousRuns: runs.slice(0, 10),
  };
}

export async function profile(filePath = defaultPath, options = {}) {
  const text = await readFile(filePath, "utf8");
  const timestamps = text.split(/\r?\n/).filter(Boolean).map((line) => {
    const row = JSON.parse(line);
    if (row.quality_code !== "valid") throw new Error(`Non-valid pair row at ${row.observed_at ?? "unknown time"}`);
    return row.observed_at;
  });
  const result = { checkedAt: new Date().toISOString(), filePath, ...analyzeCleanWindows(timestamps, options) };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  profile(process.argv[2] ? path.resolve(process.argv[2]) : defaultPath).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
