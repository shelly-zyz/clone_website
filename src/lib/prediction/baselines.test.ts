import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires an explicit TypeScript extension.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildPersistenceForecast, buildPreviousDaySameTimeForecast } from "./baselines.ts";

const observations = [
  { timestamp: "2026-01-01T00:00:00Z", valueMw: 10 },
  { timestamp: "2026-01-01T00:10:00Z", valueMw: 12 },
  { timestamp: "2026-01-02T00:00:00Z", valueMw: 18 },
];

test("persistence uses only the latest observation before issue time", () => {
  const forecast = buildPersistenceForecast(
    [...observations, { timestamp: "2026-01-02T00:20:00Z", valueMw: 999 }],
    { issueTime: "2026-01-02T00:10:00Z", horizonMinutes: 30, intervalMinutes: 10 },
  );

  assert.deepEqual(forecast?.points, [
    { timestamp: "2026-01-02T00:20:00.000Z", valueMw: 18 },
    { timestamp: "2026-01-02T00:30:00.000Z", valueMw: 18 },
    { timestamp: "2026-01-02T00:40:00.000Z", valueMw: 18 },
  ]);
});

test("previous-day same-time aligns a fixed local timezone and refuses incomplete history", () => {
  const forecast = buildPreviousDaySameTimeForecast(
    [
      { timestamp: "2026-01-01T00:10:00Z", valueMw: 7 },
      { timestamp: "2026-01-01T00:20:00Z", valueMw: 8 },
      { timestamp: "2026-01-02T00:00:00Z", valueMw: 12 },
    ],
    { issueTime: "2026-01-02T00:00:00Z", horizonMinutes: 20, intervalMinutes: 10, timezoneOffsetMinutes: 480 },
  );

  assert.deepEqual(forecast?.points, [
    { timestamp: "2026-01-02T00:10:00.000Z", valueMw: 7 },
    { timestamp: "2026-01-02T00:20:00.000Z", valueMw: 8 },
  ]);
  assert.equal(buildPreviousDaySameTimeForecast(
    [{ timestamp: "2026-01-01T00:10:00Z", valueMw: 7 }],
    { issueTime: "2026-01-02T00:00:00Z", horizonMinutes: 20, intervalMinutes: 10 },
  ), null);
});

test("baseline rejects a horizon that cannot be represented by the sampling interval", () => {
  assert.throws(
    () => buildPersistenceForecast(observations, { issueTime: "2026-01-02T00:10:00Z", horizonMinutes: 25, intervalMinutes: 10 }),
    /divisible/,
  );
});
