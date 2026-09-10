export type DataAvailability = "available" | "partial" | "unavailable";

type ForecastMetric = {
  samples: number;
  maeMw: number;
  rmseMw: number;
};

type ModelComparison = {
  horizonMinutes: number;
  model: ForecastMetric;
  persistence: ForecastMetric;
  maeImprovementPct: number;
  beatsPersistence: boolean;
};

export type SdwpfPilotSummary = {
  schemaVersion: number;
  generatedAt: string;
  status: "historical-backtest-only";
  source: {
    name: string;
    url: string;
    identity: "real-world-scada";
    operator: string;
    rawSha256: string;
    redistributionLicense: string;
  };
  limitations: string[];
  dataset: {
    rawRows: number;
    turbineCount: number;
    dayCount: number;
    intervalMinutes: number;
    aggregatePoints: number;
    usableAggregatePoints: number;
    usableRatio: number;
    quality: { valid: number; missing: number; unknown: number; abnormal: number };
  };
  baseline: {
    model: "persistence";
    trainDays: string;
    holdoutDays: string;
    horizons: Array<{ horizonMinutes: number; samples: number; maeMw: number | null; rmseMw: number | null }>;
  };
  modelComparison: {
    name: string;
    status: "rejected-no-baseline-gain";
    featurePolicy: string;
    split: { trainDays: string; holdoutDays: string };
    comparisons: ModelComparison[];
  };
  lightgbmComparison?: {
    name: "LightGBM";
    version: string;
    sklearnVersion: string;
    status: "candidate" | "rejected-no-baseline-gain" | "rolling-candidate" | "rejected-no-stable-rolling-gain";
    featurePolicy: string;
    split: { trainDays: string; validationDays: string; holdoutDays: string };
    comparisons: Array<ModelComparison & { bestIteration: number }>;
    rollingValidation?: {
      strategy: "rolling-origin-expanding-window";
      minimumFolds: number;
      completedFolds: number;
      folds: Array<{
        id: string;
        split: { trainDays: string; validationDays: string; holdoutDays: string };
        comparisons: Array<ModelComparison & { bestIteration: number }>;
      }>;
      horizons: Array<{
        horizonMinutes: number;
        wins: number;
        folds: number;
        meanMaeImprovementPct: number;
        minimumMaeImprovementPct: number;
        passesRollingGate: boolean;
      }>;
    };
  };
};
export type ChinaDataIdentity =
  | "official-statistic"
  | "mapped-asset-sample"
  | "geometry"
  | "live-field"
  | "research-estimate"
  | "model-scenario"
  | "interface-only";

type OfficialMetric = {
  source: string;
  sourceUrl: string;
  total: number;
  hydro: number;
  thermal: number;
  nuclear: number;
  wind: number;
  solar: number;
};

export type ChinaOfficialTotals = {
  year: number;
  installedCapacityMw: OfficialMetric;
  generationGwh: OfficialMetric & { cleanEnergy: number };
};

export type MappedSampleInput = {
  count: number;
  capacityMw: number;
  sourceCount: number;
  status?: "available" | "partial";
  reason?: string;
  note?: string;
};

export type ChinaDashboardOverview = {
  region: { id: "china"; label: "中国" };
  official: {
    identity: "official-statistic";
    status: "available";
    year: number;
    installedCapacityMw: OfficialMetric;
    generationGwh: OfficialMetric & { cleanEnergy: number };
    note: string;
  };
  mappedSample: {
    identity: "mapped-asset-sample";
    status: DataAvailability;
    count: number | null;
    capacityMw: number | null;
    sourceCount: number | null;
    note: string;
    reason?: string;
  };
  prediction: {
    identity: "interface-only";
    status: "unavailable";
    output: null;
    reason: string;
  };
};

export function buildChinaDashboardOverview({
  officialTotals,
  mappedSample,
}: {
  officialTotals: ChinaOfficialTotals;
  mappedSample: MappedSampleInput | null;
}): ChinaDashboardOverview {
  return {
    region: { id: "china", label: "中国" },
    official: {
      identity: "official-statistic",
      status: "available",
      year: officialTotals.year,
      installedCapacityMw: officialTotals.installedCapacityMw,
      generationGwh: officialTotals.generationGwh,
      note: "官方统计只用于全国总量与结构校验，不提供资产坐标。",
    },
    mappedSample: mappedSample
      ? {
          identity: "mapped-asset-sample",
          status: mappedSample.status ?? "available",
          count: mappedSample.count,
          capacityMw: mappedSample.capacityMw,
          sourceCount: mappedSample.sourceCount,
          note: mappedSample.note ?? "地图点位是多源坐标样本，不能与官方全国统计直接等同。",
          ...(mappedSample.reason ? { reason: mappedSample.reason } : {}),
        }
      : {
          identity: "mapped-asset-sample",
          status: "unavailable",
          count: null,
          capacityMw: null,
          sourceCount: null,
          note: "地图样本与官方统计保持独立。",
          reason: "地图样本数据库当前不可用。",
        },
    prediction: {
      identity: "interface-only",
      status: "unavailable",
      output: null,
      reason: "超短期预测模型与实时输入尚未接入，因此不生成预测数值。",
    },
  };
}

export type ChinaLayer = {
  id: "terrain" | "provinces" | "osm-power" | "pv-footprint" | "gfs-weather" | "graced-power" | "vre-scenario";
  label: string;
  identity: ChinaDataIdentity;
  status: DataAvailability;
  detail: string;
};

export function buildChinaLayerCatalog({
  terrainAvailable,
  provinceGeometryAvailable,
  osmTileCount,
  osmSnapshotDate = "2026-05-17",
  weatherAvailable,
  pvFootprintSummaryAvailable = false,
  gracedAvailable = false,
  vreScenarioAvailable = false,
}: {
  terrainAvailable: boolean;
  provinceGeometryAvailable: boolean;
  osmTileCount: number;
  osmSnapshotDate?: string;
  weatherAvailable: boolean;
  pvFootprintSummaryAvailable?: boolean;
  gracedAvailable?: boolean;
  vreScenarioAvailable?: boolean;
}) {
  const layers: ChinaLayer[] = [
    {
      id: "terrain",
      label: "彩色土地地貌",
      identity: "geometry",
      status: terrainAvailable ? "available" : "unavailable",
      detail: terrainAvailable ? "本地彩色地貌纹理" : "地貌纹理未找到",
    },
    {
      id: "provinces",
      label: "省级边界",
      identity: "geometry",
      status: provinceGeometryAvailable ? "available" : "unavailable",
      detail: provinceGeometryAvailable ? "本地中国省份 GeoJSON" : "省级边界未找到",
    },
    {
      id: "osm-power",
      label: "OSM 电力设施",
      identity: "mapped-asset-sample",
      status: osmTileCount > 0 ? "available" : "unavailable",
      detail: osmTileCount > 0 ? `${osmSnapshotDate} 快照 · ${osmTileCount} 个本地矢量瓦片 · z3–5 有界加载` : "本地瓦片不可用",
    },
    {
      id: "pv-footprint",
      label: "PV 遥感足迹",
      identity: "research-estimate",
      status: pvFootprintSummaryAvailable ? "partial" : "unavailable",
      detail: pvFootprintSummaryAvailable ? "2015 / 2020 / 2024 汇总可用 · 精细多边形待结构化" : "PV 足迹摘要不可用",
    },
    {
      id: "gfs-weather",
      label: "GFS 气象场",
      identity: "live-field",
      status: weatherAvailable ? "available" : "unavailable",
      detail: weatherAvailable ? "运行时气象场已就绪" : "运行时气象场尚未就绪",
    },
    {
      id: "graced-power",
      label: "GRACED Power",
      identity: "research-estimate",
      status: gracedAvailable ? "available" : "unavailable",
      detail: gracedAvailable ? "逐日研究估算帧可用" : "当前数据库未提供 GRACED Power 帧",
    },
    {
      id: "vre-scenario",
      label: "VRE 长期情景",
      identity: "model-scenario",
      status: vreScenarioAvailable ? "available" : "unavailable",
      detail: vreScenarioAvailable ? "GFDL-ESM4 SSP1-2.6 · 2021–2060 情景摘要" : "长期情景摘要不可用",
    },
  ];

  return { layers };
}

export type ChinaLayerCatalog = ReturnType<typeof buildChinaLayerCatalog>;

export type ChinaSourceLedgerEntry = {
  id: string;
  label: string;
  identity: ChinaDataIdentity;
  status: DataAvailability;
  scope: string;
  usedAsGeometry: boolean;
  timeRange?: string;
  limitation?: string;
};

export function buildChinaDashboardQuality({
  officialTotals,
  mappedSourceCount,
}: {
  officialTotals: ChinaOfficialTotals;
  mappedSourceCount: number;
}) {
  const sources: ChinaSourceLedgerEntry[] = [
    {
      id: "official-capacity",
      label: officialTotals.installedCapacityMw.source,
      identity: "official-statistic",
      status: "available",
      scope: `${officialTotals.year} 年全国装机总量校验`,
      usedAsGeometry: false,
    },
    {
      id: "official-generation",
      label: officialTotals.generationGwh.source,
      identity: "official-statistic",
      status: "available",
      scope: `${officialTotals.year} 年全国发电量总量校验`,
      usedAsGeometry: false,
    },
    {
      id: "mapped-assets",
      label: "多源电源项目坐标样本",
      identity: "mapped-asset-sample",
      status: mappedSourceCount > 0 ? "available" : "unavailable",
      scope: mappedSourceCount > 0 ? `${mappedSourceCount} 类来源，仅用于地图点位` : "样本来源不可用",
      usedAsGeometry: true,
    },
    {
      id: "osm-power-tiles",
      label: "OpenStreetMap China power extract",
      identity: "mapped-asset-sample",
      status: "available",
      scope: "输电线路、变电站、电厂与发电单元矢量瓦片",
      usedAsGeometry: true,
      timeRange: "2026-05-17 snapshot",
      limitation: "众包几何不是调度拓扑，不含可信线路容量、损耗或实时潮流。",
    },
  ];

  return {
    sources,
    predictionReady: false,
    notice: "预测链为交互演示；在模型、实时输入与回测通过前不输出预测值。",
  };
}

export type ChinaDashboardQuality = ReturnType<typeof buildChinaDashboardQuality>;
