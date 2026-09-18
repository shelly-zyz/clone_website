import type { SdwpfPilotSummary } from "../china-dashboard";
import type { PredictionRealDataEvidence, PredictionSourceDataGates, PredictionStatus, UnavailableForecast } from "./contracts";

const PILOT_DATA_BLOCKERS = [
  "SDWPF只有匿名日序和相对坐标，缺少可用于生产的绝对场址与日历时刻。",
  "当前SDWPF回测证据与服务器端真实场站数据分离，不能代替正式训练集。",
];

const MODEL_BLOCKERS = [
  "尚未完成至少3个滚动起点并证明目标时效稳定胜过持久性基线。",
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
  GB: "GBR",
  UK: "GBR",
};

export function normalizePredictionCountryCode(value: string | null | undefined) {
  const normalized = (value ?? "CHN").trim().toUpperCase();
  const code = COUNTRY_CODE_ALIASES[normalized] ?? normalized;
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function fallbackSourceGates(): PredictionSourceDataGates {
  return {
    observedPower: false,
    historicalNwp: false,
    absoluteSiteTime: false,
    capacityAndAvailability: false,
    temporalCoverage: false,
    sourceQuality: false,
    curtailmentLabels: false,
  };
}

function modelBlockers(rollingHorizons: Array<{ passesRollingGate: boolean }> | undefined) {
  const stableBaselineGain = rollingHorizons?.some((item) => item.passesRollingGate) ?? false;
  return {
    stableBaselineGain,
    blockers: stableBaselineGain ? [MODEL_BLOCKERS[1]] : MODEL_BLOCKERS,
  };
}

function nextRequiredInputs(realData: PredictionRealDataEvidence | null) {
  return realData?.status === "verified-research-only"
    ? [
        "补充或取得连续90天且时间完整率不低于95%的真实功率窗口",
        "补充权威电网限电/停机原因标签或可审计字段映射",
        "在合格数据上完成至少3折滚动基线验证与概率区间校准",
      ]
    : [
        "带实体ID、绝对坐标、时区和日历时刻的真实功率序列",
        "带issue_time和valid_time的同期历史NWP",
        "装机/可用容量、停机、限电和质量码",
      ];
}

export function buildPredictionStatus(
  pilot: SdwpfPilotSummary | null,
  countryCode = "CHN",
  realData: PredictionRealDataEvidence | null = null,
): PredictionStatus {
  const normalizedCountryCode = normalizePredictionCountryCode(countryCode) ?? "CHN";
  const isChina = normalizedCountryCode === "CHN";
  const countryPilot = isChina ? pilot : null;
  const countryRealData = realData?.source.countryCode === normalizedCountryCode ? realData : null;
  const comparisons = countryPilot?.lightgbmComparison?.comparisons ?? [];
  const rollingHorizons = countryPilot?.lightgbmComparison?.rollingValidation?.horizons;
  const sourceGates = countryRealData ? countryRealData.gates : fallbackSourceGates();
  const { stableBaselineGain, blockers: modelGateBlockers } = modelBlockers(rollingHorizons);
  const productionBlockers = countryRealData
    ? [...countryRealData.blockers, ...modelGateBlockers]
    : countryPilot
      ? [...PILOT_DATA_BLOCKERS, ...modelGateBlockers]
      : ["尚未构建可审计的本地真实功率历史回测试点。", ...GENERIC_COUNTRY_BLOCKERS, ...modelGateBlockers];
  return {
    schemaVersion: 2,
    country: {
      code: normalizedCountryCode,
      evidenceScope: countryRealData?.status === "verified-research-only"
        ? "country-specific"
        : countryPilot
          ? "research-dataset"
          : "data-required",
    },
    status: "locked",
    productionReady: false,
    dataGates: {
      ...sourceGates,
      stableBaselineGain,
      calibratedIntervals: false,
    },
    realData: countryRealData,
    researchEvidence: countryPilot ? {
      identity: "historical-backtest-only",
      countryCode: "CHN",
      geographicScope: "anonymous-china-competition-fleet",
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
    blockers: productionBlockers,
    nextRequiredInputs: nextRequiredInputs(countryRealData),
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
