export type PredictionDataGates = {
  observedPower: boolean;
  historicalNwp: boolean;
  absoluteSiteTime: boolean;
  calibratedIntervals: boolean;
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
  schemaVersion: 1;
  country: {
    code: string;
    evidenceScope: "country-specific" | "data-required";
  };
  status: "locked";
  productionReady: false;
  dataGates: PredictionDataGates;
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
