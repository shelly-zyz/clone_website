import { z } from "zod";
import { getSessionSchema, openSessionSchema, sessionInput } from "@/lib/agent-runtime/context";

export const chartTypes = ["line", "bar"] as const;
export type ChartType = (typeof chartTypes)[number];
export const chartBackends = ["echarts", "vchart", "antv"] as const;
export type ChartBackend = (typeof chartBackends)[number];

const resultScope = { project_id: z.uuid(), result_id: z.uuid() };
const renderFields = { ...resultScope, chart: z.enum(chartTypes), renderer: z.enum(chartBackends).optional() };
const instruction = z.string().trim().min(1).max(300);
export const sceneFields = {
  project_id: z.uuid(), renderer: z.enum(["maplibre", "three"]),
  bounds: z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85),
    z.number().min(-180).max(180), z.number().min(-85).max(85)]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
};

export const visualizationRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("render"), ...renderFields }),
  z.strictObject({ action: z.literal("ask"), ...resultScope, instruction, renderer: z.enum(chartBackends).optional() }),
  openSessionSchema, getSessionSchema,
  z.strictObject({ action: z.literal("ask_session"), ...sessionInput, result_id: z.uuid().optional(), instruction,
    renderer: z.enum(chartBackends).optional() }),
  z.strictObject({ action: z.literal("scene"), ...sceneFields }),
]);
