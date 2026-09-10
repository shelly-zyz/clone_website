export type ObservedPowerPoint = {
  timestamp: string;
  valueMw: number;
};

export type ForecastPoint = {
  timestamp: string;
  valueMw: number;
};

export type BaselineForecast = {
  identity: "historical-backtest-only";
  model: "persistence" | "previous-day-same-time";
  issueTime: string;
  horizonMinutes: number;
  intervalMinutes: number;
  points: ForecastPoint[];
};

export type BaselineForecastOptions = {
  issueTime: string;
  horizonMinutes: number;
  intervalMinutes: number;
  timezoneOffsetMinutes?: number;
};

const DAY_MS = 24 * 60 * 60 * 1_000;

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid prediction timestamp: ${value}`);
  return timestamp;
}

function validateOptions(options: BaselineForecastOptions) {
  const issueTimestamp = parseTimestamp(options.issueTime);
  if (!Number.isInteger(options.horizonMinutes) || options.horizonMinutes <= 0) {
    throw new Error("Prediction horizon must be a positive integer in minutes.");
  }
  if (!Number.isInteger(options.intervalMinutes) || options.intervalMinutes <= 0) {
    throw new Error("Prediction interval must be a positive integer in minutes.");
  }
  if (options.horizonMinutes % options.intervalMinutes !== 0) {
    throw new Error("Prediction horizon must be divisible by the sampling interval.");
  }
  const timezoneOffsetMinutes = options.timezoneOffsetMinutes ?? 0;
  if (!Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -14 * 60 || timezoneOffsetMinutes > 14 * 60) {
    throw new Error("Timezone offset must be an integer between -14:00 and +14:00.");
  }
  return { issueTimestamp, stepCount: options.horizonMinutes / options.intervalMinutes, timezoneOffsetMinutes };
}

function normalizeObservations(observations: ObservedPowerPoint[], issueTimestamp: number) {
  return observations
    .map((observation) => ({
      timestamp: parseTimestamp(observation.timestamp),
      valueMw: observation.valueMw,
    }))
    .map((observation) => {
      if (!Number.isFinite(observation.valueMw)) throw new Error("Observed power must be finite.");
      return observation;
    })
    .filter((observation) => observation.timestamp < issueTimestamp)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function toIso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function forecastTimestamps(issueTimestamp: number, stepCount: number, intervalMinutes: number) {
  return Array.from({ length: stepCount }, (_, index) => issueTimestamp + (index + 1) * intervalMinutes * 60_000);
}

function buildForecast(
  model: BaselineForecast["model"],
  options: BaselineForecastOptions,
  values: Array<{ timestamp: number; valueMw: number }>,
) {
  const { issueTimestamp, stepCount } = validateOptions(options);
  return {
    identity: "historical-backtest-only" as const,
    model,
    issueTime: toIso(issueTimestamp),
    horizonMinutes: options.horizonMinutes,
    intervalMinutes: options.intervalMinutes,
    points: values.slice(0, stepCount).map((value, index) => ({
      timestamp: toIso(issueTimestamp + (index + 1) * options.intervalMinutes * 60_000),
      valueMw: value.valueMw,
    })),
  };
}

export function buildPersistenceForecast(
  observations: ObservedPowerPoint[],
  options: BaselineForecastOptions,
): BaselineForecast | null {
  const { issueTimestamp, stepCount } = validateOptions(options);
  const history = normalizeObservations(observations, issueTimestamp);
  const latest = history.at(-1);
  if (!latest) return null;
  return buildForecast(
    "persistence",
    options,
    forecastTimestamps(issueTimestamp, stepCount, options.intervalMinutes).map((timestamp) => ({
      timestamp,
      valueMw: latest.valueMw,
    })),
  );
}

export function buildPreviousDaySameTimeForecast(
  observations: ObservedPowerPoint[],
  options: BaselineForecastOptions,
): BaselineForecast | null {
  const { issueTimestamp, stepCount, timezoneOffsetMinutes } = validateOptions(options);
  const history = normalizeObservations(observations, issueTimestamp);
  if (!history.length) return null;

  const historyByTimestamp = new Map(history.map((observation) => [observation.timestamp, observation.valueMw]));
  const localOffsetMs = timezoneOffsetMinutes * 60_000;
  const values = forecastTimestamps(issueTimestamp, stepCount, options.intervalMinutes).map((timestamp) => {
    const localTimestamp = timestamp + localOffsetMs;
    const previousLocalTimestamp = localTimestamp - DAY_MS;
    const previousDayTimestamp = previousLocalTimestamp - localOffsetMs;
    const valueMw = historyByTimestamp.get(previousDayTimestamp);
    return valueMw === undefined ? null : { timestamp, valueMw };
  });
  if (values.some((value) => value === null)) return null;
  return buildForecast("previous-day-same-time", options, values as Array<{ timestamp: number; valueMw: number }>);
}
