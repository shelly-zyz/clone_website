import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildRealDataReadiness, buildUnavailableRealDataEvidence } from "./real-data-readiness.ts";

const hour = 3_600_000;
const pairTimes = Array.from({ length: 90 * 24 }, (_, index) => new Date(Date.parse("2025-01-01T00:00:00Z") + index * hour).toISOString())
  .filter((_, index) => index !== 10);

const fixture = {
  checkedAt: "2026-09-11T00:00:00.000Z",
  scada: {
    sourceStatus: "imported",
    entityId: "hill-of-towie",
    turbineCount: 21,
    validCoordinateCount: 21,
    installedCapacityMw: 48.3,
    observationRows: 52_561,
    observationStartUtc: "2025-01-01T00:00:00Z",
    observationEndUtc: "2026-01-01T00:00:00Z",
    missingPowerRows: 0,
    negativeObservationRows: 1,
    suspectObservationRows: 1,
    completeHourlyCandidates: 2_160,
    invalidHourlyWindows: 1,
    signalRows: 1_059_488,
    missingSignalQualityRows: 1,
    sourceReducedPowerRows: 37_299,
    sourceReducedPowerSecondsRows: 66_219,
    sourceReducedPowerSeconds: 22_360_804,
  },
  nwp: {
    sourceStatus: "paired-research-only",
    pointRows: 2_921,
    futureIssueRows: 0,
    nonValidRows: 0,
    pairRows: pairTimes.length,
    pairStartUtc: "2025-01-01T00:00:00Z",
    pairEndUtc: "2025-04-01T23:00:00Z",
    futurePairRows: 0,
    mismatchedValidTimes: 0,
    capacityOverflowRows: 0,
    curtailmentKnownRows: 0,
  },
  pairTimes,
};

test("closes source gates only for verified evidence and keeps quality blockers explicit", () => {
  const result = buildRealDataReadiness(fixture);

  assert.equal(result.status, "verified-research-only");
  assert.equal(result.gates.observedPower, true);
  assert.equal(result.gates.historicalNwp, true);
  assert.equal(result.gates.absoluteSiteTime, true);
  assert.equal(result.gates.capacityAndAvailability, true);
  assert.equal(result.gates.temporalCoverage, false);
  assert.equal(result.gates.sourceQuality, false);
  assert.equal(result.gates.curtailmentLabels, false);
  assert.equal(result.quality.best90DayCompleteness, 0.9995);
  assert.match(result.blockers.join(" "), /95%/);
  assert.match(result.blockers.join(" "), /限电/);
});

test("unavailable evidence never presents a partial source as ready", () => {
  const result = buildUnavailableRealDataEvidence("数据库不可核验。", "2026-09-11T00:00:00.000Z");

  assert.equal(result.status, "unavailable");
  assert.equal(result.dataset.trainingPairRows, null);
  assert.equal(result.gates.historicalNwp, false);
  assert.deepEqual(result.blockers, ["数据库不可核验。"]);
});
