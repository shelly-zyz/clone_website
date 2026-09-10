import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires an explicit TypeScript extension.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildResearchEvaluationRows, comparePointForecasts, evaluatePointForecast, evaluatePredictionIntervals } from "./evaluation.ts";
import type { PredictionResearchMetric } from "./contracts.ts";

test("point evaluation reports auditable error and missing-row counts", () => {
  const actual = [
    { timestamp: "2026-01-01T00:10:00Z", valueMw: 10 },
    { timestamp: "2026-01-01T00:20:00Z", valueMw: 14 },
  ];
  const model = [
    { timestamp: "2026-01-01T00:10:00Z", valueMw: 12 },
    { timestamp: "2026-01-01T00:20:00Z", valueMw: 13 },
    { timestamp: "2026-01-01T00:30:00Z", valueMw: 20 },
  ];

  assert.deepEqual(evaluatePointForecast(actual, model), {
    samples: 2,
    missingActualRows: 1,
    missingForecastRows: 0,
    maeMw: 1.5,
    rmseMw: 1.581139,
    biasMw: 0.5,
  });
});

test("comparison uses strict improvement over persistence", () => {
  const actual = [{ timestamp: "2026-01-01T00:10:00Z", valueMw: 10 }];
  const equal = [{ timestamp: "2026-01-01T00:10:00Z", valueMw: 12 }];
  const better = [{ timestamp: "2026-01-01T00:10:00Z", valueMw: 11 }];

  assert.equal(comparePointForecasts(actual, equal, equal)?.beatsBaseline, false);
  assert.equal(comparePointForecasts(actual, better, equal)?.maeImprovementPct, 50);
  assert.equal(comparePointForecasts(actual, better, equal)?.beatsBaseline, true);
});

test("interval evaluation checks ordered bounds and target coverage", () => {
  const actual = [
    { timestamp: "2026-01-01T00:10:00Z", valueMw: 10 },
    { timestamp: "2026-01-01T00:20:00Z", valueMw: 20 },
  ];
  const intervals = [
    { timestamp: "2026-01-01T00:10:00Z", lowerMw: 8, medianMw: 10, upperMw: 12 },
    { timestamp: "2026-01-01T00:20:00Z", lowerMw: 12, medianMw: 16, upperMw: 18 },
  ];

  assert.deepEqual(evaluatePredictionIntervals(actual, intervals), {
    samples: 2,
    coveredSamples: 1,
    coverage: 0.5,
    targetCoverage: 0.8,
    meanWidthMw: 5,
    passesCoverage: false,
  });
  assert.throws(() => evaluatePredictionIntervals(actual, [{ ...intervals[0], lowerMw: 11 }]), /not ordered/);
});

test("research rows recalculate displayed gain from auditable MAE values", () => {
  const metrics: PredictionResearchMetric[] = [{
    horizonMinutes: 10,
    modelMaeMw: 4,
    persistenceMaeMw: 5,
    maeImprovementPct: 18,
    beatsPersistence: true,
    rollingWins: 2,
    rollingFolds: 3,
    meanRollingImprovementPct: 1,
    passesRollingGate: false,
  }];

  assert.equal(buildResearchEvaluationRows(metrics)[0]?.derivedImprovementPct, 20);
});
