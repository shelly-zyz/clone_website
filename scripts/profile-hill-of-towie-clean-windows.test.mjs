import test from "node:test";
import assert from "node:assert/strict";

import { analyzeCleanWindows } from "./profile-hill-of-towie-clean-windows.mjs";

const hour = 3_600_000;
const isoHours = (start, count, skipped = []) => Array.from({ length: count }, (_, index) => new Date(Date.parse(start) + index * hour)).filter((_, index) => !skipped.includes(index)).map((date) => date.toISOString());

test("reports duplicate rows and contiguous runs", () => {
  const timestamps = [...isoHours("2025-01-01T00:00:00Z", 4), "2025-01-01T03:00:00Z", "2025-01-01T06:00:00Z"];
  const result = analyzeCleanWindows(timestamps, { start: "2025-01-01T00:00:00Z", end: "2025-01-02T00:00:00Z", windowDays: 1 });
  assert.equal(result.uniqueRows, 5);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.contiguousRuns, 2);
  assert.equal(result.longestContiguousRun.hours, 4);
});

test("finds the best rolling window without treating gaps as complete", () => {
  const timestamps = isoHours("2025-01-01T00:00:00Z", 24 * 3, Array.from({ length: 12 }, (_, index) => index + 24));
  const result = analyzeCleanWindows(timestamps, { start: "2025-01-01T00:00:00Z", end: "2025-01-04T00:00:00Z", windowDays: 2, minimumCompleteness: 0.95 });
  assert.equal(result.rollingWindow.maximum.validHours, 36);
  assert.equal(result.rollingWindow.maximum.expectedHours, 48);
  assert.equal(result.rollingWindow.eligible, false);
});

test("rejects invalid ranges and completeness thresholds", () => {
  assert.throws(() => analyzeCleanWindows([], { start: "2025-01-02T00:00:00Z", end: "2025-01-01T00:00:00Z" }), /end must be later/);
  assert.throws(() => analyzeCleanWindows([], { minimumCompleteness: 1.1 }), /between 0 and 1/);
});
