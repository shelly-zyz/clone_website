export type PredictionSourceDataGates = {
  observedPower: boolean;
  historicalNwp: boolean;
  absoluteSiteTime: boolean;
  capacityAndAvailability: boolean;
  temporalCoverage: boolean;
  sourceQuality: boolean;
  curtailmentLabels: boolean;
};

export type PredictionDataGates = PredictionSourceDataGates & {
  stableBaselineGain: boolean;
  calibratedIntervals: boolean;
};

export type PredictionRealDataEvidence = {
  identity: "historical-backtest-only";
  status: "verified-research-only" | "unavailable";
  checkedAt: string;
  source: {
    scadaId: string;
    nwpId: string;
    name: string;
    license: string;
  };
  dataset: {
    entityId: string | null;
    turbineCount: number | null;
    installedCapacityMw: number | null;
    observedRows: number | null;
    signalRows: number | null;
    nwpPointRows: number | null;
    trainingPairRows: number | null;
    observedStartUtc: string | null;
    observedEndUtc: string | null;
    pairCompleteness: number | null;
  };
  quality: {
    completeHourlyCandidates: number | null;
    invalidHourlyWindows: number | null;
    negativeObservationRows: number | null;
    suspectObservationRows: number | null;
    missingSignalQualityRows: number | null;
    sourceReducedPowerRows: number | null;
    sourceReducedPowerSecondsRows: number | null;
    sourceReducedPowerSeconds: number | null;
    longestContiguousHours: number | null;
    best90DayCompleteness: number | null;
    best90DayWindow: {
      start: string;
      end: string;
      validHours: number;
      expectedHours: number;
    } | null;
    curtailmentKnownRows: number | null;
  };
  gates: PredictionSourceDataGates;
  blockers: string[];
};

export type PredictionRealBaselineEvaluation = {
  model: "persistence" | "previous-day-same-time";
  horizonMinutes: 60;
  candidateRows: number;
  eligibleRows: number;
  coverage: number;
  missingForecastRows: number;
  maeMw: number | null;
  rmseMw: number | null;
  biasMw: number | null;
  beatsPersistence: boolean | null;
  improvementPct: number | null;
};

export type PredictionRealBaselineBacktest = {
  schemaVersion: 1;
  identity: "historical-backtest-only";
  status: "research-only" | "unavailable";
  checkedAt: string;
  source: {
    scadaId: string;
    nwpId: string;
    entityId: string;
    name: string;
  };
  dataset: {
    candidateRows: number;
    validRows: number;
    quarantinedRows: number;
    curtailmentKnownRows: number;
    startUtc: string | null;
    endUtc: string | null;
    resolutionMinutes: 60;
  };
  evaluations: PredictionRealBaselineEvaluation[];
  blockers: string[];
};

export type PredictionResearchMetric = {
  horizonMinutes: number;
  modelMaeMw: number;
  persistenceMaeMw: number;
  maeImprovementPct: number;
  beatsPersistence: boolean;
  rollingWins: number | null;
  rollingFolds: number | null;
  meanRollingImprovementPct: number | null;
  passesRollingGate: boolean;
};

export type PredictionResearchEvidence = {
  identity: "historical-backtest-only";
  source: string;
  generatedAt: string;
  model: string | null;
  modelVersion: string | null;
  dataset: {
    rawRows: number;
    turbineCount: number;
    dayCount: number;
    intervalMinutes: number;
    usableRatio: number;
  };
  split: { trainDays: string; validationDays: string; holdoutDays: string } | null;
  candidateHorizonsMinutes: number[];
  rejectedHorizonsMinutes: number[];
  metrics: PredictionResearchMetric[];
};

export type PredictionStatus = {
  schemaVersion: 2;
  country: {
    code: string;
    evidenceScope: "country-specific" | "data-required";
  };
  status: "locked";
  productionReady: false;
  dataGates: PredictionDataGates;
  realData: PredictionRealDataEvidence | null;
  researchEvidence: PredictionResearchEvidence | null;
  blockers: string[];
  nextRequiredInputs: string[];
  modelRegistryHref: "/api/prediction/models";
};

export type UnavailableForecast = {
  schemaVersion: 1;
  status: "unavailable";
  output: null;
  issueTime: null;
  validTime: null;
  reason: string;
  blockers: string[];
  statusHref: string;
};

export type RegisteredHorizon = {
  horizonMinutes: number;
  samples: number;
  maeMw: number;
  rmseMw: number;
  baselineMaeMw: number | null;
  improvementPct: number | null;
  decision: "baseline" | "research-candidate" | "rejected";
  rollingWins: number | null;
  rollingFolds: number | null;
  meanRollingImprovementPct: number | null;
};

export type RegisteredPredictionModel = {
  id: string;
  name: string;
  version: string;
  lifecycle: "baseline" | "rejected" | "research-candidate-partial";
  featurePolicy: string;
  validation: {
    strategy: "single-temporal-holdout" | "rolling-origin";
    trainDays: string;
    validationDays: string | null;
    holdoutDays: string;
  };
  artifact: { published: false; location: "local-git-ignored" | "none" };
  horizons: RegisteredHorizon[];
};

export type PredictionModelRegistry = {
  schemaVersion: 1;
  status: "research-only" | "unavailable";
  generatedAt: string | null;
  productionPromotionAllowed: false;
  promotionGate: {
    requiredStrategy: "rolling-origin";
    rollingValidationPassed: boolean;
    completedFolds: number;
    minimumFolds: 3;
    reason: string;
  };
  models: RegisteredPredictionModel[];
};
