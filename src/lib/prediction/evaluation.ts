import type { PredictionResearchMetric } from "./contracts";

export type TimedPowerValue = {
  timestamp: string;
  valueMw: number;
};

export type PointForecastEvaluation = {
  samples: number;
  missingActualRows: number;
  missingForecastRows: number;
  maeMw: number;
  rmseMw: number;
  biasMw: number;
};

export type PointForecastComparison = {
  model: PointForecastEvaluation;
  baseline: PointForecastEvaluation;
  maeImprovementPct: number | null;
  beatsBaseline: boolean;
};

export type PredictionIntervalValue = {
  timestamp: string;
  lowerMw: number;
  medianMw: number;
  upperMw: number;
};

export type PredictionIntervalEvaluation = {
  samples: number;
  coveredSamples: number;
  coverage: number;
  targetCoverage: number;
  meanWidthMw: number;
  passesCoverage: boolean;
};

export type ResearchEvaluationRow = PredictionResearchMetric & {
  derivedImprovementPct: number | null;
};

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid evaluation timestamp: ${value}`);
  return timestamp;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function toUniqueMap(values: TimedPowerValue[]) {
  const result = new Map<number, number>();
  for (const value of values) {
    const timestamp = parseTimestamp(value.timestamp);
    if (!Number.isFinite(value.valueMw)) throw new Error("Evaluation power values must be finite.");
    if (result.has(timestamp)) throw new Error(`Duplicate evaluation timestamp: ${value.timestamp}`);
    result.set(timestamp, value.valueMw);
  }
  return result;
}

export function evaluatePointForecast(
  actual: TimedPowerValue[],
  forecast: TimedPowerValue[],
): PointForecastEvaluation | null {
  const actualByTime = toUniqueMap(actual);
  const forecastByTime = toUniqueMap(forecast);
  const matched = [...forecastByTime.entries()]
    .filter(([timestamp]) => actualByTime.has(timestamp))
    .map(([timestamp, predicted]) => ({ actual: actualByTime.get(timestamp)!, predicted }));
  if (!matched.length) return null;

  const errors = matched.map(({ actual: observed, predicted }) => predicted - observed);
  const absoluteErrors = errors.map(Math.abs);
  return {
    samples: matched.length,
    missingActualRows: forecastByTime.size - matched.length,
    missingForecastRows: actualByTime.size - matched.length,
    maeMw: round(absoluteErrors.reduce((sum, error) => sum + error, 0) / matched.length),
    rmseMw: round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / matched.length)),
    biasMw: round(errors.reduce((sum, error) => sum + error, 0) / matched.length),
  };
}

export function comparePointForecasts(
  actual: TimedPowerValue[],
  modelForecast: TimedPowerValue[],
  baselineForecast: TimedPowerValue[],
): PointForecastComparison | null {
  const model = evaluatePointForecast(actual, modelForecast);
  const baseline = evaluatePointForecast(actual, baselineForecast);
  if (!model || !baseline) return null;
  const maeImprovementPct = baseline.maeMw === 0
    ? null
    : round(((baseline.maeMw - model.maeMw) / baseline.maeMw) * 100);
  return {
    model,
    baseline,
    maeImprovementPct,
    beatsBaseline: maeImprovementPct !== null && maeImprovementPct > 0,
  };
}

export function evaluatePredictionIntervals(
  actual: TimedPowerValue[],
  intervals: PredictionIntervalValue[],
  targetCoverage = 0.8,
): PredictionIntervalEvaluation | null {
  if (targetCoverage <= 0 || targetCoverage > 1) throw new Error("Target interval coverage must be greater than 0 and no greater than 1.");
  const actualByTime = toUniqueMap(actual);
  const intervalByTime = new Map<number, PredictionIntervalValue>();
  for (const interval of intervals) {
    const timestamp = parseTimestamp(interval.timestamp);
    if (![interval.lowerMw, interval.medianMw, interval.upperMw].every(Number.isFinite)) {
      throw new Error("Prediction interval values must be finite.");
    }
    if (interval.lowerMw > interval.medianMw || interval.medianMw > interval.upperMw) {
      throw new Error(`Prediction interval bounds are not ordered at ${interval.timestamp}.`);
    }
    if (intervalByTime.has(timestamp)) throw new Error(`Duplicate interval timestamp: ${interval.timestamp}`);
    intervalByTime.set(timestamp, interval);
  }
  const matched = [...intervalByTime.entries()]
    .filter(([timestamp]) => actualByTime.has(timestamp))
    .map(([timestamp, interval]) => ({ actual: actualByTime.get(timestamp)!, interval }));
  if (!matched.length) return null;
  const coveredSamples = matched.filter(({ actual: observed, interval }) => observed >= interval.lowerMw && observed <= interval.upperMw).length;
  const meanWidthMw = matched.reduce((sum, { interval }) => sum + interval.upperMw - interval.lowerMw, 0) / matched.length;
  return {
    samples: matched.length,
    coveredSamples,
    coverage: round(coveredSamples / matched.length),
    targetCoverage,
    meanWidthMw: round(meanWidthMw),
    passesCoverage: coveredSamples / matched.length >= targetCoverage,
  };
}

export function buildResearchEvaluationRows(metrics: PredictionResearchMetric[]): ResearchEvaluationRow[] {
  return metrics.map((metric) => ({
    ...metric,
    derivedImprovementPct: metric.persistenceMaeMw === 0
      ? null
      : round(((metric.persistenceMaeMw - metric.modelMaeMw) / metric.persistenceMaeMw) * 100),
  }));
}
