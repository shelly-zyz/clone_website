import { z } from "zod";

export const topicSchema = z.enum(["meteo", "power", "carbon"]);
export type Topic = z.infer<typeof topicSchema>;

export const datasets = {
  meteo: "meteo_gfs_forecast", power: "power_nbs_monthly", carbon: "carbon_graced_power",
} as const;

export const powerProducts = ["electricity", "thermal-power", "hydro-power", "nuclear-power", "wind-power", "solar-power"] as const;

const commonFilters = {
  version: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().optional(),
  limit: z.number().int().min(1).max(120).default(31),
};

export const dataQuerySchema = z.discriminatedUnion("topic", [
  z.strictObject({ topic: z.literal("meteo"), ...commonFilters, issue_time: z.iso.datetime({ offset: true }).optional() }),
  z.strictObject({ topic: z.literal("power"), ...commonFilters,
    region_code: z.string().regex(/^\d{12}$/).default("000000000000"), product: z.enum(powerProducts).default("electricity") }),
  z.strictObject({ topic: z.literal("carbon"), ...commonFilters }),
]).refine(({ start_date, end_date }) => !start_date || !end_date || start_date <= end_date, "起始日期必须早于或等于结束日期");

export type DataQuery = z.infer<typeof dataQuerySchema>;

export const metricSchema = z.object({
  metric_code: z.string(), name: z.string(), unit: z.string(), time_grain: z.string(),
  data_identity: z.enum(["forecast", "official_statistics", "research_estimate"]),
  source_name: z.string(), definition: z.string(), review_status: z.literal("approved"),
});

export const dataRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("catalog"), topic: topicSchema.optional() }),
  z.strictObject({ action: z.literal("query"), query: dataQuerySchema }),
  z.strictObject({ action: z.literal("ask"), topic: topicSchema, question: z.string().trim().min(1).max(500) }),
]);
