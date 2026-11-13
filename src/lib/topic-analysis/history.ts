import type { VreTechnology } from "@/lib/climate-vre";

export const publishedAnalysisTopics = ["generation", "fuels", "carbon"] as const;
export type PublishedAnalysisTopic = typeof publishedAnalysisTopics[number];

export type PublishedFact = {
  month: string;
  series: string;
  value: number | null;
  coverage: number;
};

export type PublishedHistory = {
  dataset: string;
  version: string;
  publishedAt: string;
  facts: PublishedFact[];
};

export type RegionalGeneration = {
  dataset: string;
  version: string;
  publishedAt: string;
  month: string;
  regions: { code: string; name: string; value: number | null }[];
};

export type ScenarioRow = {
  region: string;
  technology: VreTechnology;
  year: number;
  factor: number;
  generation: number;
  monthly: (number | null)[];
};

export type RenewableScenario = {
  origin: "database" | "archive";
  generatedAt: string;
  gcm: string;
  scenario: string;
  regions: { id: string; label: string }[];
  rows: ScenarioRow[];
};

export const generationSeries = [
  { id: "electricity", name: "发电量合计", color: "#246591" },
  { id: "thermal-power", name: "火电", color: "#e46a59" },
  { id: "hydro-power", name: "水电", color: "#4f91df" },
  { id: "nuclear-power", name: "核电", color: "#9671d9" },
  { id: "wind-power", name: "风电", color: "#25ada0" },
  { id: "solar-power", name: "太阳能", color: "#f3bd4c" },
] as const;

export const fuelSeries = [
  { id: "raw-coal", name: "原煤", color: "#a1532f", code: "raw_coal_production_current", annualUnit: "亿吨", monthlyUnit: "万吨" },
  { id: "crude-oil", name: "原油", color: "#5d6097", code: "crude_oil_production_current", annualUnit: "万吨", monthlyUnit: "万吨" },
  { id: "natural-gas", name: "天然气", color: "#187c83", code: "natural_gas_production_current", annualUnit: "亿立方米", monthlyUnit: "亿立方米" },
] as const;

export const generationYoyMetric = "electricity_generation_yoy";

export const carbonMetrics = [
  "global_grid_emission_rate_sum",
  "global_grid_nonzero_cell_count",
] as const;
