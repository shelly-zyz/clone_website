import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error direct Node type-stripping test import
import { evaluateWeatherFreshness } from "./weather-freshness.ts";

const now = Date.parse("2026-09-18T00:00:00.000Z");

test("freshness requires both a recent cache write and a recent GFS run", () => {
  assert.deepEqual(
    evaluateWeatherFreshness("2026-09-17T23:30:00.000Z", "2026-09-17T18:00:00.000Z", now),
    { cacheFresh: true, runFresh: true, stale: false, ageMinutes: 30, runAgeHours: 6 },
  );
});

test("a historical manifest cannot keep advertising live data", () => {
  const status = evaluateWeatherFreshness("2026-09-09T03:46:22.369Z", "2026-09-08T18:00:00.000Z", now);
  assert.equal(status.stale, true);
  assert.equal(status.cacheFresh, false);
  assert.equal(status.runFresh, false);
});

test("invalid timestamps are stale", () => {
  const status = evaluateWeatherFreshness("invalid", null, now);
  assert.equal(status.stale, true);
  assert.equal(status.ageMinutes, null);
  assert.equal(status.runAgeHours, null);
});
