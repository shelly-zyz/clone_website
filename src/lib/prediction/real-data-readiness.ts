import type { PredictionRealDataEvidence, PredictionSourceDataGates } from "./contracts";

const HOUR_MS = 3_600_000;
const WINDOW_DAYS = 90;
const WINDOW_HOURS = WINDOW_DAYS * 24;
const SCADA_SOURCE_ID = "hill-of-towie-v2-2025";
const NWP_SOURCE_ID = "noaa-ncei-gfs-forecast-grid004";

export type RealDataReadinessInput = {
  checkedAt?: string;
  scada: {
    sourceStatus: string;
    entityId: string | null;
    turbineCount: number;
    validCoordinateCount: number;
    installedCapacityMw: number | null;
    observationRows: number;
    observationStartUtc: string | null;
    observationEndUtc: string | null;
    missingPowerRows: number;
    negativeObservationRows: number;
    suspectObservationRows: number;
    completeHourlyCandidates: number;
    invalidHourlyWindows: number;
    signalRows: number;
    missingSignalQualityRows: number;
    sourceReducedPowerRows: number;
    sourceReducedPowerSecondsRows: number;
    sourceReducedPowerSeconds: number;
  };
  nwp: {
    sourceStatus: string;
    pointRows: number;
    futureIssueRows: number;
    nonValidRows: number;
    pairRows: number;
    pairStartUtc: string | null;
    pairEndUtc: string | null;
    futurePairRows: number;
    mismatchedValidTimes: number;
    capacityOverflowRows: number;
    curtailmentKnownRows: number;
  };
  pairTimes: string[];
};

type CleanWindowSummary = {
  longestContiguousHours: number | null;
  best90DayCompleteness: number | null;
  best90DayWindow: PredictionRealDataEvidence["quality"]["best90DayWindow"];
};

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid prediction evidence timestamp: ${value}`);
  return timestamp;
}

function toIso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function analyzeCleanWindows(pairTimes: string[], startUtc: string | null, endUtc: string | null): CleanWindowSummary {
  if (!startUtc || !endUtc) return { longestContiguousHours: null, best90DayCompleteness: null, best90DayWindow: null };
  const rangeStart = parseTimestamp(startUtc);
  const rangeEnd = parseTimestamp(endUtc);
  if (rangeEnd <= rangeStart) return { longestContiguousHours: null, best90DayCompleteness: null, best90DayWindow: null };
  const timestamps = [...new Set(pairTimes.map(parseTimestamp))]
    .filter((timestamp) => timestamp >= rangeStart && timestamp < rangeEnd)
    .sort((left, right) => left - right);

  let longestContiguousHours: number | null = null;
  let runStart: number | null = null;
  let previous: number | null = null;
  for (const timestamp of timestamps) {
    if (runStart === null || timestamp - (previous ?? timestamp) !== HOUR_MS) {
      if (runStart !== null && previous !== null) {
        const hours = Math.round((previous - runStart) / HOUR_MS) + 1;
        longestContiguousHours = Math.max(longestContiguousHours ?? 0, hours);
      }
      runStart = timestamp;
    }
    previous = timestamp;
  }
  if (runStart !== null && previous !== null) {
    const hours = Math.round((previous - runStart) / HOUR_MS) + 1;
    longestContiguousHours = Math.max(longestContiguousHours ?? 0, hours);
  }

  const windowDuration = WINDOW_HOURS * HOUR_MS;
  let best90DayWindow: PredictionRealDataEvidence["quality"]["best90DayWindow"] = null;
  let left = 0;
  let right = 0;
  for (let windowStart = rangeStart; windowStart + windowDuration <= rangeEnd; windowStart += HOUR_MS) {
    const windowEnd = windowStart + windowDuration;
    while (left < timestamps.length && timestamps[left] < windowStart) left += 1;
    while (right < timestamps.length && timestamps[right] < windowEnd) right += 1;
    const validHours = Math.max(0, right - left);
    if (!best90DayWindow || validHours > best90DayWindow.validHours) {
      best90DayWindow = {
        start: toIso(windowStart),
        end: toIso(windowEnd - HOUR_MS),
        validHours,
        expectedHours: WINDOW_HOURS,
      };
    }
  }
  return {
    longestContiguousHours,
    best90DayCompleteness: best90DayWindow ? Number((best90DayWindow.validHours / WINDOW_HOURS).toFixed(4)) : null,
    best90DayWindow,
  };
}

function buildSourceGates(input: RealDataReadinessInput, cleanWindow: CleanWindowSummary): PredictionSourceDataGates {
  const { scada, nwp } = input;
  const observedPower = scada.sourceStatus === "imported"
    && scada.observationRows > 0
    && scada.missingPowerRows === 0;
  const historicalNwp = nwp.sourceStatus === "paired-research-only"
    && nwp.pointRows > 0
    && nwp.pairRows > 0
    && nwp.futureIssueRows === 0
    && nwp.futurePairRows === 0
    && nwp.mismatchedValidTimes === 0
    && nwp.nonValidRows === 0;
  const absoluteSiteTime = scada.entityId !== null
    && scada.turbineCount > 0
    && scada.validCoordinateCount === scada.turbineCount
    && scada.observationStartUtc !== null
    && scada.observationEndUtc !== null
    && nwp.pairStartUtc !== null
    && nwp.pairEndUtc !== null;
  const capacityAndAvailability = scada.installedCapacityMw !== null
    && scada.installedCapacityMw > 0
    && nwp.capacityOverflowRows === 0;
  const pairCompleteness = scada.completeHourlyCandidates > 0
    ? nwp.pairRows / scada.completeHourlyCandidates
    : 0;
  const temporalCoverage = pairCompleteness >= 0.95
    && (cleanWindow.best90DayCompleteness ?? 0) >= 0.95
    && scada.invalidHourlyWindows === 0;
  const sourceQuality = scada.observationRows > 0
    && scada.negativeObservationRows === 0
    && scada.suspectObservationRows / scada.observationRows <= 0.05
    && scada.missingSignalQualityRows === 0;
  return {
    observedPower,
    historicalNwp,
    absoluteSiteTime,
    capacityAndAvailability,
    temporalCoverage,
    sourceQuality,
    curtailmentLabels: nwp.curtailmentKnownRows > 0,
  };
}

export function buildRealDataReadiness(input: RealDataReadinessInput): PredictionRealDataEvidence {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const cleanWindow = analyzeCleanWindows(input.pairTimes, input.scada.observationStartUtc, input.scada.observationEndUtc);
  const gates = buildSourceGates(input, cleanWindow);
  const pairCompleteness = input.scada.completeHourlyCandidates > 0
    ? Number((input.nwp.pairRows / input.scada.completeHourlyCandidates).toFixed(4))
    : null;
  const blockers: string[] = [];
  if (!gates.observedPower) blockers.push("真实功率源尚未通过数据库导入与缺失值核验。");
  if (!gates.historicalNwp) blockers.push("历史NWP尚未通过起报时刻、有效时刻和质量码核验。");
  if (!gates.absoluteSiteTime) blockers.push("实体绝对坐标或UTC日历时刻证据不完整。");
  if (!gates.capacityAndAvailability) blockers.push("装机/可用容量约束未通过范围核验。");
  if (!gates.temporalCoverage) {
    blockers.push(`小时配对完整率为${pairCompleteness === null ? "未知" : `${(pairCompleteness * 100).toFixed(1)}%`}；最佳90天窗口完整率为${cleanWindow.best90DayCompleteness === null ? "未知" : `${(cleanWindow.best90DayCompleteness * 100).toFixed(2)}%`}，未达到95%门槛。`);
  }
  if (!gates.sourceQuality) {
    blockers.push(`源功率质量未通过：${input.scada.negativeObservationRows}条负功率观测、${input.scada.suspectObservationRows}条suspect观测或信号质量缺失仍需处置。`);
  }
  if (!gates.curtailmentLabels) blockers.push("没有权威电网限电原因标签；PowerRed/PowerRef只保留为源降功率证据。");
  return {
    identity: "historical-backtest-only",
    status: gates.observedPower && gates.historicalNwp && input.nwp.pairRows > 0 ? "verified-research-only" : "unavailable",
    checkedAt,
    source: {
      countryCode: "GBR",
      scadaId: SCADA_SOURCE_ID,
      nwpId: NWP_SOURCE_ID,
      name: "Hill of Towie 2025 SCADA + NOAA GFS historical issued forecast",
      license: "Hill of Towie CC-BY-4.0; NOAA public data",
    },
    dataset: {
      entityId: input.scada.entityId,
      turbineCount: input.scada.turbineCount,
      installedCapacityMw: input.scada.installedCapacityMw,
      observedRows: input.scada.observationRows,
      signalRows: input.scada.signalRows,
      nwpPointRows: input.nwp.pointRows,
      trainingPairRows: input.nwp.pairRows,
      observedStartUtc: input.scada.observationStartUtc,
      observedEndUtc: input.scada.observationEndUtc,
      pairCompleteness,
    },
    quality: {
      completeHourlyCandidates: input.scada.completeHourlyCandidates,
      invalidHourlyWindows: input.scada.invalidHourlyWindows,
      negativeObservationRows: input.scada.negativeObservationRows,
      suspectObservationRows: input.scada.suspectObservationRows,
      missingSignalQualityRows: input.scada.missingSignalQualityRows,
      sourceReducedPowerRows: input.scada.sourceReducedPowerRows,
      sourceReducedPowerSecondsRows: input.scada.sourceReducedPowerSecondsRows,
      sourceReducedPowerSeconds: input.scada.sourceReducedPowerSeconds,
      longestContiguousHours: cleanWindow.longestContiguousHours,
      best90DayCompleteness: cleanWindow.best90DayCompleteness,
      best90DayWindow: cleanWindow.best90DayWindow,
      curtailmentKnownRows: input.nwp.curtailmentKnownRows,
    },
    gates,
    blockers,
  };
}

export function buildUnavailableRealDataEvidence(reason: string, checkedAt = new Date().toISOString()): PredictionRealDataEvidence {
  return {
    identity: "historical-backtest-only",
    status: "unavailable",
    checkedAt,
    source: {
      countryCode: "GBR",
      scadaId: SCADA_SOURCE_ID,
      nwpId: NWP_SOURCE_ID,
      name: "Hill of Towie 2025 SCADA + NOAA GFS historical issued forecast",
      license: "Hill of Towie CC-BY-4.0; NOAA public data",
    },
    dataset: {
      entityId: null,
      turbineCount: null,
      installedCapacityMw: null,
      observedRows: null,
      signalRows: null,
      nwpPointRows: null,
      trainingPairRows: null,
      observedStartUtc: null,
      observedEndUtc: null,
      pairCompleteness: null,
    },
    quality: {
      completeHourlyCandidates: null,
      invalidHourlyWindows: null,
      negativeObservationRows: null,
      suspectObservationRows: null,
      missingSignalQualityRows: null,
      sourceReducedPowerRows: null,
      sourceReducedPowerSecondsRows: null,
      sourceReducedPowerSeconds: null,
      longestContiguousHours: null,
      best90DayCompleteness: null,
      best90DayWindow: null,
      curtailmentKnownRows: null,
    },
    gates: {
      observedPower: false,
      historicalNwp: false,
      absoluteSiteTime: false,
      capacityAndAvailability: false,
      temporalCoverage: false,
      sourceQuality: false,
      curtailmentLabels: false,
    },
    blockers: [reason],
  };
}
