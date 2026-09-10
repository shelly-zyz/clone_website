import type { SdwpfPilotSummary } from "../china-dashboard";
import type { PredictionModelRegistry, RegisteredPredictionModel } from "./contracts";

const defaultPromotionGate: PredictionModelRegistry["promotionGate"] = {
  requiredStrategy: "rolling-origin",
  rollingValidationPassed: false,
  completedFolds: 1,
  minimumFolds: 3,
  reason: "当前只有一次严格时间留出；至少完成3个滚动起点并证明分时效稳定增益后才能讨论生产晋级。",
};

export function buildModelRegistry(pilot: SdwpfPilotSummary | null): PredictionModelRegistry {
  if (!pilot) {
    return {
      schemaVersion: 1,
      status: "unavailable",
      generatedAt: null,
      productionPromotionAllowed: false,
      promotionGate: { ...defaultPromotionGate, completedFolds: 0 },
      models: [],
    };
  }

  const models: RegisteredPredictionModel[] = [];
  const lightgbm = pilot.lightgbmComparison;
  const rolling = lightgbm?.rollingValidation;
  const anyRollingCandidate = rolling?.horizons.some((item) => item.passesRollingGate) ?? false;
  const promotionGate: PredictionModelRegistry["promotionGate"] = rolling ? {
    requiredStrategy: "rolling-origin",
    rollingValidationPassed: anyRollingCandidate,
    completedFolds: rolling.completedFolds,
    minimumFolds: 3,
    reason: anyRollingCandidate
      ? "滚动验证已完成；通过时效仍需生产NWP与概率校准门禁。"
      : "三折滚动验证已完成，但没有时效在每一折稳定胜过持久性基线。",
  } : defaultPromotionGate;
  const comparablePersistence = lightgbm?.comparisons ?? [];
  models.push({
    id: "sdwpf-persistence",
    name: "Persistence",
    version: "sdwpf-persistence-v1",
    lifecycle: "baseline",
    featurePolicy: "latest usable observed farm power only",
    validation: {
      strategy: "single-temporal-holdout",
      trainDays: lightgbm?.split.trainDays ?? pilot.baseline.trainDays,
      validationDays: lightgbm?.split.validationDays ?? null,
      holdoutDays: lightgbm?.split.holdoutDays ?? pilot.baseline.holdoutDays,
    },
    artifact: { published: false, location: "none" },
    horizons: comparablePersistence.length > 0
      ? comparablePersistence.map((item) => ({
          horizonMinutes: item.horizonMinutes,
          samples: item.persistence.samples,
          maeMw: item.persistence.maeMw,
          rmseMw: item.persistence.rmseMw,
          baselineMaeMw: null,
          improvementPct: null,
          decision: "baseline" as const,
          rollingWins: null,
          rollingFolds: rolling?.completedFolds ?? null,
          meanRollingImprovementPct: null,
        }))
      : pilot.baseline.horizons.flatMap((item) => item.maeMw === null || item.rmseMw === null ? [] : [{
          horizonMinutes: item.horizonMinutes,
          samples: item.samples,
          maeMw: item.maeMw,
          rmseMw: item.rmseMw,
          baselineMaeMw: null,
          improvementPct: null,
          decision: "baseline" as const,
          rollingWins: null,
          rollingFolds: null,
          meanRollingImprovementPct: null,
        }]),
  });

  models.push({
    id: "sdwpf-autoregressive-ridge",
    name: pilot.modelComparison.name,
    version: "sdwpf-ar-ridge-v1",
    lifecycle: "rejected",
    featurePolicy: pilot.modelComparison.featurePolicy,
    validation: {
      strategy: "single-temporal-holdout",
      trainDays: pilot.modelComparison.split.trainDays,
      validationDays: null,
      holdoutDays: pilot.modelComparison.split.holdoutDays,
    },
    artifact: { published: false, location: "none" },
    horizons: pilot.modelComparison.comparisons.map((item) => ({
      horizonMinutes: item.horizonMinutes,
      samples: item.model.samples,
      maeMw: item.model.maeMw,
      rmseMw: item.model.rmseMw,
      baselineMaeMw: item.persistence.maeMw,
      improvementPct: item.maeImprovementPct,
      decision: "rejected" as const,
      rollingWins: null,
      rollingFolds: null,
      meanRollingImprovementPct: null,
    })),
  });

  if (lightgbm) {
    models.push({
      id: "sdwpf-lightgbm",
      name: lightgbm.name,
      version: lightgbm.version,
      lifecycle: rolling
        ? (anyRollingCandidate ? "research-candidate-partial" : "rejected")
        : (lightgbm.comparisons.some((item) => item.beatsPersistence) ? "research-candidate-partial" : "rejected"),
      featurePolicy: lightgbm.featurePolicy,
      validation: {
        strategy: rolling ? "rolling-origin" : "single-temporal-holdout",
        trainDays: lightgbm.split.trainDays,
        validationDays: lightgbm.split.validationDays,
        holdoutDays: lightgbm.split.holdoutDays,
      },
      artifact: { published: false, location: "local-git-ignored" },
      horizons: lightgbm.comparisons.map((item) => {
        const rollingHorizon = rolling?.horizons.find((candidate) => candidate.horizonMinutes === item.horizonMinutes);
        const passes = rollingHorizon?.passesRollingGate ?? item.beatsPersistence;
        return {
          horizonMinutes: item.horizonMinutes,
          samples: item.model.samples,
          maeMw: item.model.maeMw,
          rmseMw: item.model.rmseMw,
          baselineMaeMw: item.persistence.maeMw,
          improvementPct: item.maeImprovementPct,
          decision: passes ? "research-candidate" as const : "rejected" as const,
          rollingWins: rollingHorizon?.wins ?? null,
          rollingFolds: rollingHorizon?.folds ?? null,
          meanRollingImprovementPct: rollingHorizon?.meanMaeImprovementPct ?? null,
        };
      }),
    });
  }

  return {
    schemaVersion: 1,
    status: "research-only",
    generatedAt: pilot.generatedAt,
    productionPromotionAllowed: false,
    promotionGate,
    models,
  };
}
