import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildLockedForecast, buildPredictionStatus, normalizePredictionCountryCode } from "./status.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { derivePredictionWorkflow } from "./workflow.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildModelRegistry } from "./registry.ts";
import type { SdwpfPilotSummary } from "../china-dashboard.ts";

const pilot: SdwpfPilotSummary = {
  schemaVersion: 1,
  generatedAt: "2026-09-09T14:56:24.464Z",
  status: "historical-backtest-only",
  source: {
    name: "SDWPF · Baidu KDD Cup 2022",
    url: "https://aistudio.baidu.com/competition/detail/152/0/introduction",
    identity: "real-world-scada",
    operator: "Longyuan Power Group Corp. Ltd.",
    rawSha256: "abc123",
    redistributionLicense: "not-stated-on-official-download-page",
  },
  limitations: ["No historical NWP.", "Anonymous time and relative coordinates."],
  dataset: {
    rawRows: 4_727_520,
    turbineCount: 134,
    dayCount: 245,
    intervalMinutes: 10,
    aggregatePoints: 35_280,
    usableAggregatePoints: 19_171,
    usableRatio: 0.5434,
    quality: { valid: 3_595_859, missing: 49_518, unknown: 1_082_016, abnormal: 127 },
  },
  baseline: {
    model: "persistence",
    trainDays: "1-214",
    holdoutDays: "215-245",
    horizons: [{ horizonMinutes: 10, samples: 2_125, maeMw: 3.942, rmseMw: 5.86 }],
  },
  modelComparison: {
    name: "autoregressive-ridge",
    status: "rejected-no-baseline-gain",
    featurePolicy: "past observations only",
    split: { trainDays: "1-214", holdoutDays: "215-245" },
    comparisons: [],
  },
  lightgbmComparison: {
    name: "LightGBM",
    version: "4.7.0",
    sklearnVersion: "1.9.0",
    status: "candidate",
    featurePolicy: "past observations only; no future meteorology",
    split: { trainDays: "1-183", validationDays: "184-214", holdoutDays: "215-245" },
    comparisons: [
      {
        horizonMinutes: 10,
        bestIteration: 245,
        model: { samples: 1_052, maeMw: 4.063, rmseMw: 5.845 },
        persistence: { samples: 1_052, maeMw: 4.108, rmseMw: 5.911 },
        maeImprovementPct: 1.1,
        beatsPersistence: true,
      },
      {
        horizonMinutes: 30,
        bestIteration: 158,
        model: { samples: 1_035, maeMw: 10.027, rmseMw: 13.633 },
        persistence: { samples: 1_035, maeMw: 9.117, rmseMw: 12.54 },
        maeImprovementPct: -9.98,
        beatsPersistence: false,
      },
    ],
  },
};

test("status exposes research evidence without unlocking production", () => {
  const status = buildPredictionStatus(pilot);

  assert.equal(status.country.code, "CHN");
  assert.equal(status.country.evidenceScope, "country-specific");
  assert.equal(status.status, "locked");
  assert.equal(status.productionReady, false);
  assert.equal(status.dataGates.observedPower, true);
  assert.equal(status.dataGates.historicalNwp, false);
  assert.deepEqual(status.researchEvidence?.candidateHorizonsMinutes, [10]);
  assert.deepEqual(status.researchEvidence?.rejectedHorizonsMinutes, [30]);
  assert.equal(status.researchEvidence?.dataset.rawRows, 4_727_520);
  assert.match(status.blockers.join(" "), /NWP|场址|时刻/);
});

test("workflow derives each workstation state from real gates", () => {
  const status = buildPredictionStatus(pilot);
  const stages = derivePredictionWorkflow(status, true, buildModelRegistry(pilot));

  assert.deepEqual(stages.map((stage) => stage.state), ["complete", "locked", "complete", "complete", "research", "research"]);
  assert.match(stages[1].note, /历史NWP/);
  assert.match(stages[4].product, /10分钟/);
  assert.match(stages[4].note, /1\/3折/);
  assert.match(stages[5].note, /无P10\/P50\/P90/);
});

test("workflow keeps current weather locked when its live layer is unavailable", () => {
  const stages = derivePredictionWorkflow(buildPredictionStatus(pilot), false);

  assert.equal(stages[0].state, "locked");
  assert.match(stages[0].note, /当前GFS/);
});

test("status remains locked when no local research pilot exists", () => {
  const status = buildPredictionStatus(null);

  assert.equal(status.status, "locked");
  assert.equal(status.researchEvidence, null);
  assert.equal(status.dataGates.observedPower, false);
  assert.ok(status.blockers.length > 0);
});

test("country codes normalize safely and preserve the legacy China default", () => {
  assert.equal(normalizePredictionCountryCode(null), "CHN");
  assert.equal(normalizePredictionCountryCode("cn"), "CHN");
  assert.equal(normalizePredictionCountryCode(" usa "), "USA");
  assert.equal(normalizePredictionCountryCode("US"), null);
  assert.equal(normalizePredictionCountryCode("../../etc"), null);
});

test("another country never inherits China's research evidence", () => {
  const status = buildPredictionStatus(pilot, "USA");

  assert.equal(status.country.code, "USA");
  assert.equal(status.country.evidenceScope, "data-required");
  assert.equal(status.dataGates.observedPower, false);
  assert.equal(status.researchEvidence, null);
  assert.match(status.blockers.join(" "), /该国家|历史NWP|绝对场址/);
  assert.doesNotMatch(status.blockers.join(" "), /SDWPF/);
});

test("locked forecast response contains no generated values", () => {
  const response = buildLockedForecast(buildPredictionStatus(pilot));

  assert.equal(response.status, "unavailable");
  assert.equal(response.output, null);
  assert.equal(response.issueTime, null);
  assert.equal(response.validTime, null);
  assert.match(response.reason, /生产预测/);
  assert.equal(response.statusHref, "/api/prediction/status?country=CHN");
});

test("model registry records comparable horizon decisions without claiming rolling validation", () => {
  const registry = buildModelRegistry(pilot);
  const lightgbm = registry.models.find((model) => model.id === "sdwpf-lightgbm");

  assert.equal(registry.status, "research-only");
  assert.equal(registry.promotionGate.rollingValidationPassed, false);
  assert.equal(registry.promotionGate.completedFolds, 1);
  assert.equal(lightgbm?.lifecycle, "research-candidate-partial");
  assert.deepEqual(lightgbm?.horizons.map((item) => item.decision), ["research-candidate", "rejected"]);
  assert.equal(lightgbm?.artifact.published, false);
});

test("model registry is unavailable without a verified pilot summary", () => {
  const registry = buildModelRegistry(null);

  assert.equal(registry.status, "unavailable");
  assert.deepEqual(registry.models, []);
  assert.equal(registry.productionPromotionAllowed, false);
});

test("three-fold evidence rejects a last-fold winner that is not stable", () => {
  const rollingPilot: SdwpfPilotSummary = {
    ...pilot,
    lightgbmComparison: {
      ...pilot.lightgbmComparison!,
      status: "rejected-no-stable-rolling-gain",
      rollingValidation: {
        strategy: "rolling-origin-expanding-window",
        minimumFolds: 3,
        completedFolds: 3,
        folds: [],
        horizons: [
          { horizonMinutes: 10, wins: 2, folds: 3, meanMaeImprovementPct: 0.65, minimumMaeImprovementPct: -1.06, passesRollingGate: false },
          { horizonMinutes: 30, wins: 0, folds: 3, meanMaeImprovementPct: -7.16, minimumMaeImprovementPct: -9.98, passesRollingGate: false },
        ],
      },
    },
  };
  const status = buildPredictionStatus(rollingPilot);
  const registry = buildModelRegistry(rollingPilot);
  const workflow = derivePredictionWorkflow(status, true, registry);

  assert.deepEqual(status.researchEvidence?.candidateHorizonsMinutes, []);
  assert.deepEqual(status.researchEvidence?.rejectedHorizonsMinutes, [10, 30]);
  assert.equal(registry.promotionGate.completedFolds, 3);
  assert.equal(registry.promotionGate.rollingValidationPassed, false);
  assert.equal(registry.models.find((model) => model.id === "sdwpf-lightgbm")?.lifecycle, "rejected");
  assert.match(workflow[4].product, /未获稳定/);
  assert.match(workflow[4].note, /2\/3折胜/);
});
