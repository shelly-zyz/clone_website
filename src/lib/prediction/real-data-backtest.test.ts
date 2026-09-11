import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildRealBaselineBacktest } from "./real-data-backtest.ts";

test("real baseline backtest uses only valid historical pairs and reports coverage gaps", () => {
  const result = buildRealBaselineBacktest([
    { observedAt: "2025-01-01T00:00:00Z", observedPowerMw: 10, qualityCode: "valid" },
    { observedAt: "2025-01-01T01:00:00Z", observedPowerMw: 12, qualityCode: "valid" },
    { observedAt: "2025-01-01T02:00:00Z", observedPowerMw: 16, qualityCode: "valid" },
    { observedAt: "2025-01-02T00:00:00Z", observedPowerMw: 20, qualityCode: "valid" },
    { observedAt: "2025-01-02T01:00:00Z", observedPowerMw: 18, qualityCode: "valid" },
    { observedAt: "2025-01-02T02:00:00Z", observedPowerMw: 14, qualityCode: "valid" },
    { observedAt: "2025-01-03T00:00:00Z", observedPowerMw: -3, qualityCode: "suspect" },
  ], { checkedAt: "2026-09-11T00:00:00Z", curtailmentKnownRows: 0 });

  assert.equal(result.status, "research-only");
  assert.equal(result.dataset.candidateRows, 7);
  assert.equal(result.dataset.validRows, 6);
  assert.equal(result.dataset.quarantinedRows, 1);
  assert.equal(result.dataset.curtailmentKnownRows, 0);
  assert.deepEqual(result.evaluations.map((evaluation) => [evaluation.model, evaluation.eligibleRows, evaluation.coverage]), [
    ["persistence", 4, 0.666667],
    ["previous-day-same-time", 3, 0.5],
  ]);
  assert.equal(result.evaluations[0]?.maeMw, 3);
  assert.equal(result.evaluations[1]?.maeMw, 6);
  assert.equal(result.evaluations[1]?.improvementPct, -100);
  assert.equal(result.evaluations[1]?.beatsPersistence, false);
  assert.match(result.blockers.join(" "), /覆盖率|限电/);
});

test("real baseline backtest returns unavailable when no valid pair remains", () => {
  const result = buildRealBaselineBacktest([
    { observedAt: "2025-01-01T00:00:00Z", observedPowerMw: -1, qualityCode: "suspect" },
  ]);

  assert.equal(result.status, "unavailable");
  assert.equal(result.evaluations.length, 2);
  assert.equal(result.evaluations[0]?.maeMw, null);
  assert.match(result.blockers.join(" "), /没有质量码/);
});

test("real baseline backtest rejects duplicate timestamps instead of choosing one silently", () => {
  assert.throws(
    () => buildRealBaselineBacktest([
      { observedAt: "2025-01-01T00:00:00Z", observedPowerMw: 1, qualityCode: "valid" },
      { observedAt: "2025-01-01T00:00:00Z", observedPowerMw: 2, qualityCode: "valid" },
    ]),
    /Duplicate real backtest timestamp/,
  );
});
