import { z } from "zod";
import { dataQuerySchema } from "@/lib/data-agent/contracts";

export const domains = ["electricity", "meteorology", "carbon", "economy"] as const;
export type Domain = typeof domains[number];
export const chartKinds = ["trend", "columns", "rank", "stack", "box", "violin", "density", "scatter", "correlation",
  "forecast", "forecast-diagnostics", "waterfall", "dumbbell", "flow", "calendar", "grid", "surface", "rose", "trend-distribution"] as const;
export type ChartKind = typeof chartKinds[number];
export const engines = ["echarts", "flint", "matplotlib", "plotly"] as const;
export type Engine = typeof engines[number];
export const themes = ["academic-light", "academic-monochrome", "editorial-modern", "scientific-spectrum", "dashboard-glass", "dark-analytics"] as const;
export const layouts = ["auto", "focus", "vertical", "horizontal", "2x2", "3x2"] as const;
export const exportFormats = ["svg", "png", "pdf", "json", "python"] as const;
export type ExportFormat = typeof exportFormats[number];

const release = z.string().regex(/^[a-f0-9]{64}$/);
const year = z.number().int().min(1960).max(2200);
const country = z.string().regex(/^[A-Z]{3}$/);
export const economyMetrics = ["real-growth", "gdp", "gdp-per-capita", "exports", "growth-outlook"] as const;

export const datasetRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("published"), query: dataQuerySchema }),
  z.strictObject({ kind: z.literal("result"), result_id: z.uuid() }),
  z.strictObject({ kind: z.literal("forecast-job"), job_id: z.uuid() }),
  z.strictObject({ kind: z.literal("economy"), metric: z.enum(economyMetrics), country,
    start_year: year.optional(), end_year: year.optional(), version: release.optional() }),
  z.strictObject({ kind: z.literal("replay-grid"), id: z.string().regex(/^[a-z0-9-]{1,64}$/), version: release.optional(),
    field: z.enum(["rain", "satellite"]), time: z.iso.datetime({ offset: true }).optional(), archive: z.literal(true).optional() }),
  z.strictObject({ kind: z.literal("gfs-grid"), field: z.enum(["temperature", "wind", "relativeHumidity", "cape", "mslp", "precipitableWater"]),
    version: release.optional() }),
  z.strictObject({ kind: z.literal("approved"), id: z.string().regex(/^[a-z][a-z0-9-]{1,50}$/), version: release.optional() }),
]);
export type DatasetRequest = z.infer<typeof datasetRequestSchema>;

export const styleSchema = z.strictObject({
  theme: z.enum(themes).optional(), font: z.enum(["Arial", "Microsoft YaHei", "Noto Sans CJK SC", "DejaVu Sans"]).optional(),
  font_size: z.number().min(7).max(18).optional(), legend: z.enum(["top", "bottom", "right", "none"]).optional(),
  width_mm: z.number().min(70).max(245).optional(), height_mm: z.number().min(48).max(230).optional(),
  accent: z.string().regex(/^#[a-fA-F\d]{6}$/).optional(),
});
export type FigureStyle = z.infer<typeof styleSchema>;

export const figurePatchSchema = z.strictObject({
  title: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(["auto", ...chartKinds]).optional(),
  mode: z.enum(["interactive", "paper"]).optional(),
  engine: z.enum(["auto", ...engines]).optional(),
  layout: z.enum(layouts).optional(), style: styleSchema.optional(),
  datasets: z.array(datasetRequestSchema).min(1).max(6).optional(),
});
export type FigurePatch = z.infer<typeof figurePatchSchema>;
export const figureEditSchema = figurePatchSchema.extend({
  clear: z.array(z.enum(["title", "theme", "accent", "font_size", "width_mm", "height_mm"])).max(6).optional(),
});
export type FigureEdit = z.infer<typeof figureEditSchema>;

export const visualizationJobSchema = z.strictObject({
  task_id: z.uuid(),
  intent: z.string().trim().max(500).optional(),
  configuration: figurePatchSchema.extend({ datasets: z.array(datasetRequestSchema).min(1).max(6) }),
});
export type VisualizationJob = z.infer<typeof visualizationJobSchema>;

export const dataIdentity = ["official_statistics", "research_estimate", "forecast", "observation", "reanalysis", "scenario"] as const;
export type DatasetPoint = {
  timestamp: string | null;
  label: string;
  region_id: string;
  value: number | null;
  quality_flag: number;
  coordinates?: [longitude: number, latitude: number];
  bounds?: [lower: number, upper: number];
  actual?: number | null;
  target?: string;
};

export type DatasetMetadata = {
  dataset_id: string; series_id: string; metric_id: string; title: string; domain: Domain; source_id: string;
  dimensions: { shape: "time" | "category" | "grid" | "flow"; time_grain: string; coordinates?: "EPSG:4326" };
  time_zone: "UTC" | null; unit: string; data_type: typeof dataIdentity[number];
  source_url: string[]; source_version: string; observation_time: { start: string | null; end: string | null };
  publication_time: string | null; retrieved_at: string; last_updated_at: string | null;
  is_forecast: boolean; model_id: string | null; model_version: string | null;
  forecast_origin: string | null; forecast_origin_period?: string; forecast_horizon: { start: string; end: string } | null; interval_method: string | null;
  transform_history: string[]; aggregation_method: string; sample_count: number;
  validation_status: "pending" | "valid"; rules?: string; region_label?: string;
  truncated: boolean; grid?: { lon: number[]; lat: number[] };
};

export type VisualizationDataContract = DatasetMetadata & {
  rows: DatasetPoint[];
  missing_mask: boolean[];
  quality_flags: number[];
};

export type DatasetProfile = DatasetMetadata & {
  missing: number; min: number; max: number; digest: string; query: DatasetRequest;
};

export type FigureSeries = {
  name: string; unit: string; data: (number | null)[];
  forecast?: boolean; interval?: ([number, number] | null)[];
};

export type FigurePanel = {
  kind: Exclude<ChartKind, "forecast-diagnostics" | "trend-distribution" | "surface">;
  title: string;
  x: string[];
  axis: "time" | "number" | "category";
  time_grain?: string;
  series: FigureSeries[];
  x_unit?: string;
  points?: [number, number][];
  cells?: [number, number, number][];
  row_labels?: string[];
  links?: { source: string; target: string; value: number }[];
};

export type FigureDesign = Required<Omit<FigureStyle, "accent">> & {
  background: string; foreground: string; muted: string; grid: string;
  colors: string[]; continuous: string[]; diverging: string[]; line_patterns: ("solid" | "dash" | "dot")[];
};

export type Validation = { status: "valid"; checks: { id: string; detail: string }[]; warnings: string[] };
export type VisualizationPlan = {
  version: 1; chart: ChartKind; candidates: ChartKind[]; reason: string; fields: string[];
  skills: string[]; engine: Engine; renderer: Exclude<Engine, "flint">;
  layout: typeof layouts[number]; design: FigureDesign; output: ExportFormat[]; validations: string[];
  transformations: string[]; datasets: DatasetProfile[];
};

export type FigureModel = { title: string; panels: FigurePanel[]; columns: number; focus: boolean };
export type PlotlySpec = { data: Record<string, unknown>[]; layout: Record<string, unknown> };
export type FigureRender = { kind: "echarts"; option: Record<string, unknown> }
  | { kind: "plotly"; spec: PlotlySpec }
  | { kind: "image"; format: "svg"; base64: string };

export type FigureInsight = { label: string; text: string; sources: number[] };

export type VisualizationResult = {
  figure_id: string; revision: number | null; task_id: string;
  recipe: VisualizationJob["configuration"]; plan: VisualizationPlan;
  render: FigureRender; validation: Validation; statistics: Record<string, number>;
  artifact_id: string; engine_version: string | null; insights: FigureInsight[];
  viewport: { rows: number; panels: number; compact_model?: FigureModel };
};

export const figureReference = { figure_id: z.uuid(), revision: z.number().int().min(1).max(30).optional() };
export const projectKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const workspaceRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), domain: z.enum(domains) }),
  z.strictObject({ action: z.literal("catalog") }),
  z.strictObject({ action: z.literal("session-source"), session_id: z.uuid() }),
  z.strictObject({ action: z.literal("profile"), datasets: z.array(datasetRequestSchema).min(1).max(6) }),
  z.strictObject({ action: z.literal("render"), job: visualizationJobSchema }),
  z.strictObject({ action: z.literal("edit"), task_id: z.uuid(), patch: figureEditSchema, artifact_id: z.uuid() }),
  z.strictObject({ action: z.literal("ask"), task_id: z.uuid(), message: z.string().trim().min(1).max(500),
    domain: z.enum(domains), artifact_id: z.uuid().optional() }),
  z.strictObject({ action: z.literal("save"), artifact_id: z.uuid(), figure_id: z.uuid().optional(),
    expected_revision: z.number().int().min(1).max(30).optional() }),
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("open"), ...figureReference }),
  z.strictObject({ action: z.literal("export"), artifact_id: z.uuid(), format: z.enum(exportFormats) }),
  z.strictObject({ action: z.literal("plan"), job: visualizationJobSchema }),
  z.strictObject({ action: z.literal("validate"), job: visualizationJobSchema }),
]);
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;

type VisualizationErrorCode = "DATA_GAP" | "CLARIFICATION" | "INCOMPATIBLE" | "ENGINE_UNAVAILABLE" | "VALIDATION_FAILED" | "CONFLICT" | "BUSY" | "NOT_FOUND";

export class VisualizationError extends Error {
  readonly code: VisualizationErrorCode;

  constructor(code: VisualizationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
