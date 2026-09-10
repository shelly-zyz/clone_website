import type { SdwpfPilotSummary } from "../china-dashboard";
import type { PredictionStatus, UnavailableForecast } from "./contracts";

const PRODUCTION_BLOCKERS = [
  "缺少与真实功率按起报时刻和有效时刻配对的历史NWP档案。",
  "SDWPF只有匿名日序和相对坐标，缺少绝对场址与日历时刻。",
  "尚未完成滚动概率校准，因此不能输出P10/P50/P90。",
];

const GENERIC_COUNTRY_BLOCKERS = [
  "该国家尚未接入可审计的真实功率历史序列。",
  "缺少与真实功率按起报时刻和有效时刻配对的历史NWP档案。",
  "缺少实体ID、绝对场址、时区和日历时刻。",
  "尚未完成滚动概率校准，因此不能输出P10/P50/P90。",
];

const COUNTRY_CODE_ALIASES: Record<string, string> = {
  CN: "CHN",
  CHINA: "CHN",
};

export function normalizePredictionCountryCode(value: string | null | undefined) {
  const normalized = (value ?? "CHN").trim().toUpperCase();
  const code = COUNTRY_CODE_ALIASES[normalized] ?? normalized;
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function buildPredictionStatus(pilot: SdwpfPilotSummary | null, countryCode = "CHN"): PredictionStatus {
  const normalizedCountryCode = normalizePredictionCountryCode(countryCode) ?? "CHN";
  const isChina = normalizedCountryCode === "CHN";
  const countryPilot = isChina ? pilot : null;
  const comparisons = countryPilot?.lightgbmComparison?.comparisons ?? [];
  const rollingHorizons = countryPilot?.lightgbmComparison?.rollingValidation?.horizons;
  return {
    schemaVersion: 1,
    country: {
      code: normalizedCountryCode,
      evidenceScope: countryPilot ? "country-specific" : "data-required",
    },
    status: "locked",
    productionReady: false,
    dataGates: {
      observedPower: countryPilot !== null,
      historicalNwp: false,
      absoluteSiteTime: false,
      calibratedIntervals: false,
    },
    researchEvidence: countryPilot ? {
      identity: "historical-backtest-only",
      source: countryPilot.source.name,
      generatedAt: countryPilot.generatedAt,
      model: countryPilot.lightgbmComparison?.name ?? null,
      modelVersion: countryPilot.lightgbmComparison?.version ?? null,
      dataset: {
        rawRows: countryPilot.dataset.rawRows,
        turbineCount: countryPilot.dataset.turbineCount,
        dayCount: countryPilot.dataset.dayCount,
        intervalMinutes: countryPilot.dataset.intervalMinutes,
        usableRatio: countryPilot.dataset.usableRatio,
      },
      split: countryPilot.lightgbmComparison?.split ?? null,
      candidateHorizonsMinutes: rollingHorizons
        ? rollingHorizons.filter((item) => item.passesRollingGate).map((item) => item.horizonMinutes)
        : comparisons.filter((item) => item.beatsPersistence).map((item) => item.horizonMinutes),
      rejectedHorizonsMinutes: rollingHorizons
        ? rollingHorizons.filter((item) => !item.passesRollingGate).map((item) => item.horizonMinutes)
        : comparisons.filter((item) => !item.beatsPersistence).map((item) => item.horizonMinutes),
      metrics: comparisons.map((item) => {
        const rolling = rollingHorizons?.find((candidate) => candidate.horizonMinutes === item.horizonMinutes);
        return {
          horizonMinutes: item.horizonMinutes,
          modelMaeMw: item.model.maeMw,
          persistenceMaeMw: item.persistence.maeMw,
          maeImprovementPct: item.maeImprovementPct,
          beatsPersistence: item.beatsPersistence,
          rollingWins: rolling?.wins ?? null,
          rollingFolds: rolling?.folds ?? null,
          meanRollingImprovementPct: rolling?.meanMaeImprovementPct ?? null,
          passesRollingGate: rolling?.passesRollingGate ?? item.beatsPersistence,
        };
      }),
    } : null,
    blockers: isChina
      ? countryPilot ? PRODUCTION_BLOCKERS : ["尚未构建可审计的本地真实功率历史回测试点。", ...PRODUCTION_BLOCKERS]
      : GENERIC_COUNTRY_BLOCKERS,
    nextRequiredInputs: [
      "带实体ID、绝对坐标、时区和日历时刻的真实功率序列",
      "带issue_time和valid_time的同期历史NWP",
      "装机/可用容量、停机、限电和质量码",
    ],
    modelRegistryHref: "/api/prediction/models",
  };
}

export function buildLockedForecast(status: PredictionStatus): UnavailableForecast {
  return {
    schemaVersion: 1,
    status: "unavailable",
    output: null,
    issueTime: null,
    validTime: null,
    reason: "生产预测门禁尚未通过；当前只提供历史回测证据，不生成实时预测值。",
    blockers: status.blockers,
    statusHref: `/api/prediction/status?country=${status.country.code}`,
  };
}
