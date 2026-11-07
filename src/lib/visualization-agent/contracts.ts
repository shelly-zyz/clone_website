import { z } from "zod";

export const chartTypes = ["line", "bar"] as const;
export type ChartType = (typeof chartTypes)[number];

const resultScope = { project_id: z.uuid(), result_id: z.uuid() };

export const visualizationRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("render"), ...resultScope, chart: z.enum(chartTypes) }),
  z.strictObject({ action: z.literal("ask"), ...resultScope, instruction: z.string().trim().min(1).max(300) }),
]);
