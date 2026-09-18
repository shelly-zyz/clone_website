import type { EnergyDataIdentity, EnergyDataset, EnergyMetric, EnergyTool } from "./schema";

export type SemanticReviewStatus = "reviewed" | "rule-confirmed" | "candidate" | "rejected";

export type SemanticCatalogEntry = {
  id: string;
  label: string;
  kind: "metric" | "dataset" | "relation";
  source: string;
  unit: string;
  identity: EnergyDataIdentity;
  version: string;
  reviewStatus: SemanticReviewStatus;
  supportedTools: EnergyTool[];
  limitation: string;
  timeRange?: string;
  spatialGrain?: string;
  metric?: EnergyMetric;
  dataset?: EnergyDataset;
};

export const SEMANTIC_CATALOG_VERSION = "1.0.0";

export const reviewedSemanticCatalog: SemanticCatalogEntry[] = [
  {
    id: "metric.mapped_asset_count", label: "映射能源设施数量", kind: "metric", metric: "mapped_asset_count",
    source: "src/lib/china-map-data.generated.json", unit: "个", identity: "mapped-asset-sample", version: SEMANTIC_CATALOG_VERSION,
    reviewStatus: "rule-confirmed", supportedTools: ["mapped-assets"], spatialGrain: "全国/省级边界空间筛选",
    limitation: "多源公开坐标样本；不是官方设施普查，空结果不代表官方为零。",
  },
  {
    id: "metric.mapped_asset_sources", label: "映射能源设施来源", kind: "metric", metric: "mapped_asset_sources",
    source: "china-map-data.generated.json meta.sources", unit: "数据源", identity: "mapped-asset-sample", version: SEMANTIC_CATALOG_VERSION,
    reviewStatus: "reviewed", supportedTools: ["mapped-assets"], spatialGrain: "全国/省级边界空间筛选",
    limitation: "来源描述设施坐标样本，不代表官方统计来源。",
  },
  {
    id: "metric.dataset_quality", label: "数据集时间、更新与缺失状态", kind: "metric", metric: "dataset_quality",
    source: "已审核数据清单与运行时清单", unit: "状态", identity: "mapped-asset-sample", version: SEMANTIC_CATALOG_VERSION,
    reviewStatus: "reviewed", supportedTools: ["dataset-catalog", "weather-manifest"],
    limitation: "不同数据身份不得跨口径合并；未记录字段明确显示未知。",
  },
  {
    id: "metric.layer_availability", label: "图层可用性与覆盖", kind: "metric", metric: "layer_availability",
    source: "/api/china-dashboard/layers 对应本地清单", unit: "状态", identity: "crowdsourced-map", version: SEMANTIC_CATALOG_VERSION,
    reviewStatus: "rule-confirmed", supportedTools: ["layer-catalog"], spatialGrain: "中国大屏图层",
    limitation: "图层可用不等于业务变量完整，也不等于实时监测。",
  },
  {
    id: "metric.gfs_run_time", label: "GFS起报与有效时间", kind: "metric", metric: "gfs_run_time",
    source: ".weather-cache/manifest.json", unit: "UTC时间", identity: "forecast", version: SEMANTIC_CATALOG_VERSION,
    reviewStatus: "rule-confirmed", supportedTools: ["weather-manifest"], spatialGrain: "全球规则网格",
    limitation: "正式数值天气预报，不是场站实测或发电预测。",
  },
  {
    id: "metric.prediction_readiness", label: "预测数据门禁", kind: "metric", metric: "prediction_readiness",
    source: "/api/prediction/status", unit: "状态", identity: "research-estimate", version: SEMANTIC_CATALOG_VERSION,
    reviewStatus: "reviewed", supportedTools: ["prediction-gate"],
    limitation: "首版不提供生产预测；真实输出和P10/P50/P90保持锁定。",
  },
  ...datasetEntries(),
];

export function publishSemanticCatalog(entries: SemanticCatalogEntry[]) {
  const blocked = entries.filter((entry) => entry.reviewStatus !== "reviewed" && entry.reviewStatus !== "rule-confirmed");
  if (blocked.length) throw new Error(`Only reviewed or rule-confirmed semantics may be published: ${blocked.map((entry) => entry.id).join(", ")}`);
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

export const productionSemanticCatalog = publishSemanticCatalog(reviewedSemanticCatalog);

function datasetEntries(): SemanticCatalogEntry[] {
  const shared = { kind: "dataset" as const, unit: "状态", version: SEMANTIC_CATALOG_VERSION, reviewStatus: "reviewed" as const };
  return [
    { ...shared, id: "dataset.mapped-assets", dataset: "mapped-assets", label: "能源设施映射样本", source: "china-map-data.generated.json", identity: "mapped-asset-sample", supportedTools: ["dataset-catalog"], timeRange: "当前构建快照", limitation: "并非官方设施普查。" },
    { ...shared, id: "dataset.gfs", dataset: "gfs", label: "GFS正式预报", source: "NOAA GFS运行时清单", identity: "forecast", supportedTools: ["dataset-catalog", "weather-manifest", "layer-catalog"], limitation: "不是历史观测或发电预测。" },
    { ...shared, id: "dataset.graced", dataset: "graced", label: "GRACED Power", source: "GRACED逐日碳排放栅格", identity: "research-estimate", supportedTools: ["dataset-catalog", "layer-catalog"], limitation: "研究估算，不是实时监测。" },
    { ...shared, id: "dataset.vre", dataset: "vre", label: "VRE长期情景", source: "GFDL-ESM4 SSP1-2.6", identity: "model-scenario", supportedTools: ["dataset-catalog", "layer-catalog"], timeRange: "2021-2060", limitation: "长期模型情景，不是实际发电或短期预测。" },
    { ...shared, id: "dataset.osm", dataset: "osm", label: "OSM电力设施快照", source: "OpenStreetMap China 2026-05-17 extract", identity: "crowdsourced-map", supportedTools: ["dataset-catalog", "layer-catalog"], timeRange: "2026-05-17 snapshot", limitation: "众包几何不是调度拓扑，不含可信容量、损耗或实时潮流。" },
    { ...shared, id: "dataset.pv-footprint", dataset: "pv-footprint", label: "PV遥感足迹", source: "CPVPD-2024 / ChinaPV", identity: "research-estimate", supportedTools: ["dataset-catalog", "layer-catalog"], timeRange: "2015/2020/2024", limitation: "遥感足迹不能直接解释为官方装机容量。" },
  ];
}
