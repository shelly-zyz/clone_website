import type { PredictionRealBaselineBacktest, PredictionRealBaselineEvaluation } from "./contracts";
// Node's direct type-stripping test runner needs the explicit extension; the bundler resolves this the same way.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node-compatible module import.
import { evaluatePointForecast } from "./evaluation.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SCADA_SOURCE_ID = "hill-of-towie-v2-2025";
const NWP_SOURCE_ID = "noaa-ncei-gfs-forecast-grid004";
const ENTITY_ID = "hill-of-towie";

export type RealTrainingPairRow = {
  observedAt: string;
  observedPowerMw: number;
  qualityCode: string;
};

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid real backtest timestamp: ${value}`);
  return timestamp;
}

function iso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function buildEvaluation(
  model: PredictionRealBaselineEvaluation["model"],
  candidateRows: number,
  actual: Array<{ timestamp: string; valueMw: number }>,
  forecasts: Array<{ timestamp: string; valueMw: number }>,
): PredictionRealBaselineEvaluation {
  const evaluation = evaluatePointForecast(actual, forecasts);
  const eligibleRows = evaluation?.samples ?? 0;
  return {
    model,
    horizonMinutes: 60,
    candidateRows,
    eligibleRows,
    coverage: candidateRows > 0 ? round(eligibleRows / candidateRows) : 0,
    missingForecastRows: evaluation?.missingForecastRows ?? candidateRows,
    maeMw: evaluation?.maeMw ?? null,
    rmseMw: evaluation?.rmseMw ?? null,
    biasMw: evaluation?.biasMw ?? null,
    beatsPersistence: null,
    improvementPct: null,
  };
}

export function buildRealBaselineBacktest(
  rows: RealTrainingPairRow[],
  { checkedAt = new Date().toISOString(), curtailmentKnownRows = 0 } = {},
): PredictionRealBaselineBacktest {
  const normalized = rows
    .map((row) => ({
      timestamp: parseTimestamp(row.observedAt),
      observedAt: row.observedAt,
      valueMw: row.observedPowerMw,
      qualityCode: row.qualityCode,
    }))
    .map((row) => {
      if (!Number.isFinite(row.valueMw)) throw new Error(`Invalid real backtest power at ${row.observedAt}`);
      return row;
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  const seen = new Set<number>();
  for (const row of normalized) {
    if (seen.has(row.timestamp)) throw new Error(`Duplicate real backtest timestamp: ${row.observedAt}`);
    seen.add(row.timestamp);
  }

  const validRows = normalized.filter((row) => row.qualityCode === "valid" && row.valueMw >= 0);
  const candidateRows = validRows.length;
  const actual = validRows.map((row) => ({ timestamp: iso(row.timestamp), valueMw: row.valueMw }));
  const valuesByTime = new Map(validRows.map((row) => [row.timestamp, row.valueMw]));
  const persistenceForecast = validRows.flatMap((row) => {
    const valueMw = valuesByTime.get(row.timestamp - HOUR_MS);
    return valueMw === undefined ? [] : [{ timestamp: iso(row.timestamp), valueMw }];
  });
  const previousDayForecast = validRows.flatMap((row) => {
    const valueMw = valuesByTime.get(row.timestamp - DAY_MS);
    return valueMw === undefined ? [] : [{ timestamp: iso(row.timestamp), valueMw }];
  });

  const persistence = buildEvaluation("persistence", candidateRows, actual, persistenceForecast);
  const previousDay = buildEvaluation("previous-day-same-time", candidateRows, actual, previousDayForecast);
  const improvementPct = persistence.maeMw !== null && previousDay.maeMw !== null && persistence.maeMw !== 0
    ? round(((persistence.maeMw - previousDay.maeMw) / persistence.maeMw) * 100)
    : null;
  previousDay.improvementPct = improvementPct;
  previousDay.beatsPersistence = improvementPct === null ? null : improvementPct > 0;

  const blockers: string[] = [];
  if (candidateRows === 0) blockers.push("没有质量码为valid且非负的真实小时配对可供回测。");
  if (persistence.coverage < 0.95 || previousDay.coverage < 0.95) blockers.push("基线回测存在时间缺口，覆盖率低于95%，结果仅作研究证据。");
  if (curtailmentKnownRows === 0) blockers.push("权威电网限电标签仍未知，结果不能晋级生产预测。");
  return {
    schemaVersion: 1,
    identity: "historical-backtest-only",
    status: candidateRows > 0 ? "research-only" : "unavailable",
    checkedAt,
    source: {
      countryCode: "GBR",
      scadaId: SCADA_SOURCE_ID,
      nwpId: NWP_SOURCE_ID,
      entityId: ENTITY_ID,
      name: "Hill of Towie 2025 hourly real-power pairs",
    },
    dataset: {
      candidateRows: rows.length,
      validRows: validRows.length,
      quarantinedRows: rows.length - validRows.length,
      curtailmentKnownRows,
      startUtc: validRows[0] ? iso(validRows[0].timestamp) : null,
      endUtc: validRows.at(-1) ? iso(validRows.at(-1)!.timestamp) : null,
      resolutionMinutes: 60,
    },
    evaluations: [persistence, previousDay],
    blockers,
  };
}

export function buildUnavailableRealBaselineBacktest(reason: string, checkedAt = new Date().toISOString()): PredictionRealBaselineBacktest {
  return {
    schemaVersion: 1,
    identity: "historical-backtest-only",
    status: "unavailable",
    checkedAt,
    source: {
      countryCode: "GBR",
      scadaId: SCADA_SOURCE_ID,
      nwpId: NWP_SOURCE_ID,
      entityId: ENTITY_ID,
      name: "Hill of Towie 2025 hourly real-power pairs",
    },
    dataset: {
      candidateRows: 0,
      validRows: 0,
      quarantinedRows: 0,
      curtailmentKnownRows: 0,
      startUtc: null,
      endUtc: null,
      resolutionMinutes: 60,
    },
    evaluations: [],
    blockers: [reason],
  };
}
