import { z } from "zod";
import { getSessionSchema, openSessionSchema, sessionInput } from "@/lib/agent-runtime/context";

export const analysisOperations = ["describe", "cluster", "forecast", "backtest", "compare"] as const;
export const forecastModels = ["statsforecast", "timesfm", "chronos2"] as const;
const planFields = {
  model: z.enum(forecastModels).optional(),
  horizon: z.number().int().min(1).max(12).optional(),
  clusters: z.number().int().min(2).max(5).optional(),
};
export const planSchema = z.strictObject({ operation: z.enum(analysisOperations), ...planFields });
export const analysisSelectionSchema = z.strictObject({ operation: z.enum([...analysisOperations, "unsupported"]), ...planFields });
export type AnalysisPlan = z.infer<typeof planSchema>;

export const analysisRequestSchema = z.discriminatedUnion("action", [
  openSessionSchema, getSessionSchema,
  z.strictObject({ action: z.literal("get_job"), project_id: z.uuid(), job_id: z.uuid() }),
  z.strictObject({ action: z.literal("submit"), ...sessionInput, result_id: z.uuid().optional(), plan: planSchema }),
  z.strictObject({ action: z.literal("ask"), ...sessionInput, result_id: z.uuid().optional(), instruction: z.string().trim().min(1).max(300) }),
]);
