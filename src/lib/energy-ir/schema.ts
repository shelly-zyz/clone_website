export const ENERGY_IR_METRICS = [
  "mapped_asset_count",
  "mapped_asset_sources",
  "dataset_quality",
  "layer_availability",
  "gfs_run_time",
  "prediction_readiness",
] as const;

export const ENERGY_DATASETS = ["mapped-assets", "gfs", "graced", "vre", "osm", "pv-footprint"] as const;
export const ENERGY_TECHNOLOGIES = ["solar", "wind", "offshore", "hydro", "nuclear", "coal", "gas", "oil", "geothermal"] as const;

export type EnergyMetric = typeof ENERGY_IR_METRICS[number];
export type EnergyDataset = typeof ENERGY_DATASETS[number];
export type EnergyTechnology = typeof ENERGY_TECHNOLOGIES[number];
export type EnergyDataIdentity =
  | "official-statistic"
  | "mapped-asset-sample"
  | "forecast"
  | "research-estimate"
  | "model-scenario"
  | "crowdsourced-map";

export type DashboardQueryContext = {
  selectedProvince?: string;
  selectedLayer?: string;
  selectedFacility?: string;
  timeMode?: string;
};

export type EnergyIR = {
  schemaVersion: 1;
  operation: "read";
  intent: EnergyMetric;
  metric: EnergyMetric;
  entities: {
    country: "CN";
    province?: string;
    technology?: EnergyTechnology;
    dataset?: EnergyDataset;
    facility?: string;
  };
  time: { mode: "none" | "current" | "latest" | "range"; raw?: string };
  groupBy: Array<"source" | "technology" | "province">;
  visualization: "number" | "table" | "status";
  availabilityRequired: boolean;
};

export type EnergyTool = "mapped-assets" | "dataset-catalog" | "layer-catalog" | "weather-manifest" | "prediction-gate";

export type EnergyExecutionPlan = {
  planVersion: 1;
  tool: EnergyTool;
  action: string;
  parameters: Record<string, string | boolean | undefined>;
  readOnly: true;
  sql: null;
  resultLimit: number;
};

export type EnergyProvenance = {
  source: string;
  identity: EnergyDataIdentity;
  timeRange: string;
  unit: string;
  freshness: string;
  limitation: string;
  sourceUrl?: string;
};

export type EnergyResult = {
  status: "answered" | "unavailable";
  summary: string;
  facts: Array<{ label: string; value: string | number | null; unit: string }>;
  provenance: EnergyProvenance[];
  limitations: string[];
  visualization?: { kind: "number" | "table" | "status"; title: string };
};

export type EnergyQueryOutcome =
  | { status: "planned"; ir: EnergyIR; plan: EnergyExecutionPlan }
  | { status: "clarification" | "unavailable" | "refused"; message: string; reasonCode: string };

export type ValidationResult = { ok: true; value: EnergyIR } | { ok: false; errors: string[] };

const metricSet = new Set<string>(ENERGY_IR_METRICS);
const datasetSet = new Set<string>(ENERGY_DATASETS);
const technologySet = new Set<string>(ENERGY_TECHNOLOGIES);
const groupSet = new Set(["source", "technology", "province"]);
const visualizationSet = new Set(["number", "table", "status"]);
const timeModeSet = new Set(["none", "current", "latest", "range"]);

export function validateEnergyIR(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["EnergyIR must be an object."] };
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (value.operation !== "read") errors.push("operation violates the read-only policy.");
  if (typeof value.intent !== "string" || !metricSet.has(value.intent)) errors.push("intent is unknown.");
  if (typeof value.metric !== "string" || !metricSet.has(value.metric)) errors.push("metric is unknown.");
  if (value.intent !== value.metric) errors.push("intent and metric must match in the first release.");
  if (!isRecord(value.entities) || value.entities.country !== "CN") errors.push("entities.country must be CN.");
  if (isRecord(value.entities)) {
    if (value.entities.province !== undefined && typeof value.entities.province !== "string") errors.push("province must be a string.");
    if (value.entities.facility !== undefined && typeof value.entities.facility !== "string") errors.push("facility must be a string.");
    if (value.entities.dataset !== undefined && (typeof value.entities.dataset !== "string" || !datasetSet.has(value.entities.dataset))) errors.push("dataset is unknown.");
    if (value.entities.technology !== undefined && (typeof value.entities.technology !== "string" || !technologySet.has(value.entities.technology))) errors.push("technology is unknown.");
  }
  if (!isRecord(value.time) || typeof value.time.mode !== "string" || !timeModeSet.has(value.time.mode)) errors.push("time.mode is invalid.");
  if (!Array.isArray(value.groupBy) || value.groupBy.some((item) => typeof item !== "string" || !groupSet.has(item))) errors.push("groupBy contains an unsupported field.");
  if (typeof value.visualization !== "string" || !visualizationSet.has(value.visualization)) errors.push("visualization is unsupported.");
  if (typeof value.availabilityRequired !== "boolean") errors.push("availabilityRequired must be boolean.");
  return errors.length ? { ok: false, errors } : { ok: true, value: value as EnergyIR };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
