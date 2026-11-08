import { z } from "zod";

const errors = z.object({ mae: z.number().min(0), rmse: z.number().min(0) });
const modelSelection = z.object({
  selected_method: z.string(), folds: z.literal(3), horizon: z.number().int().positive(), baseline_method: z.string(),
  refit_fallback: z.string().optional(),
  candidates: z.array(z.object({ method: z.string(), status: z.enum(["ok", "unavailable"]),
    mae: z.number().min(0).optional(), rmse: z.number().min(0).optional() })).length(3),
});

export const analysisResultSchema = z.object({
  metric: z.string().min(1),
  unit: z.string(),
  observed_rows: z.number().int().min(0),
  missing_rows: z.number().int().min(0),
  points: z.array(z.object({
    date: z.iso.datetime({ offset: true }), value: z.number(), actual: z.number().optional(),
    p10: z.number().optional(), p50: z.number().optional(), p90: z.number().optional(),
  }).refine(({ p10, p50, p90 }) => p10 === undefined && p50 === undefined && p90 === undefined
    || p10 !== undefined && p50 !== undefined && p90 !== undefined && p10 <= p50 && p50 <= p90)).max(12).optional(),
  summary: z.object({
    mean: z.number(), median: z.number(), min: z.number(), max: z.number(), stddev: z.number().min(0),
  }).optional(),
  groups: z.array(z.object({ group: z.number(), center: z.number(), count: z.number() })).optional(),
  evaluation: errors.optional(),
  baseline: errors.optional(),
  model: z.object({ name: z.string(), method: z.string().optional(), version: z.string(), revision: z.string().optional() }).optional(),
  model_selection: modelSelection.optional(),
});

export function validAnalysisOutput(value: unknown, plan: { operation: string; horizon?: number; strategy?: string }) {
  const output = analysisResultSchema.safeParse(value).data;
  if (!output) return false;
  if (plan.operation === "describe") return Boolean(output.summary);
  if (plan.operation === "cluster") return Boolean(output.groups?.length);
  if (plan.operation === "select_model") return output.model_selection?.horizon === plan.horizon && plan.horizon !== undefined;
  if (!output.points?.length || output.points.length !== plan.horizon || !output.model) return false;
  if (plan.operation === "forecast") return plan.strategy !== "auto" || Boolean(output.model_selection);
  return (plan.operation === "compare" || plan.operation === "backtest") && Boolean(output.evaluation)
    && output.points.every(point => point.actual !== undefined) && (plan.operation !== "compare" || Boolean(output.baseline));
}
