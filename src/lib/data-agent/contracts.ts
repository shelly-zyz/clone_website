import { z } from "zod";

export const topicSchema = z.enum(["meteo", "power", "carbon"]);
export type Topic = z.infer<typeof topicSchema>;

export const datasets = {
  meteo: "meteo_gfs_forecast", power: "power_nbs_monthly", carbon: "carbon_graced_power",
} as const;

export const generationProducts = ["electricity", "thermal-power", "hydro-power", "nuclear-power", "wind-power", "solar-power"] as const;
export const powerProducts = [...generationProducts, "raw-coal", "crude-oil", "crude-processing", "natural-gas"] as const;

const queryDate = z.iso.date().refine((date) => !date.startsWith("0000"), "年份必须大于零");
const issueTime = z.iso.datetime({ offset: true }).refine((date) => new Date(date).getUTCFullYear() > 0, "起报时间无效");
const commonFilters = {
  version: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  metric_code: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).optional(),
  start_date: queryDate.optional(),
  end_date: queryDate.optional(),
  limit: z.number().int().min(1).max(120).default(31),
};

export const dataQuerySchema = z.discriminatedUnion("topic", [
  z.strictObject({ topic: z.literal("meteo"), ...commonFilters, issue_time: issueTime.optional() }),
  z.strictObject({ topic: z.literal("power"), ...commonFilters,
    province_comparison: z.literal(true).optional(),
    region_code: z.string().regex(/^\d{12}$/).default("000000000000"), product: z.enum(powerProducts).optional() }),
  z.strictObject({ topic: z.literal("carbon"), ...commonFilters }),
]).refine(({ start_date, end_date }) => !start_date || !end_date || start_date <= end_date, "起始日期必须早于或等于结束日期").refine(query =>
  query.topic !== "power" || !query.province_comparison || (query.region_code === "000000000000" && query.start_date?.endsWith("-01") &&
    query.end_date && query.start_date.slice(0, 7) === query.end_date.slice(0, 7)), "省级比较须指定同一月份，起始日为当月首日且不限定单一地区。");

export type DataQuery = z.infer<typeof dataQuerySchema>;

const sessionScope = z.strictObject({ project_id: z.uuid(), session_id: z.uuid(), revision: z.number().int().min(0).max(2147483646) });
export type SessionScope = z.infer<typeof sessionScope>;

export const metricSchema = z.object({
  metric_code: z.string(), name: z.string(), unit: z.string(), time_grain: z.string(),
  data_identity: z.enum(["forecast", "official_statistics", "research_estimate"]),
  source_name: z.string(), definition: z.string(), review_status: z.literal("approved"),
  series_codes: z.array(z.string()).nonempty().optional(),
});

export const dataRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("catalog"), topic: topicSchema.optional() }),
  z.strictObject({ action: z.literal("query"), query: dataQuerySchema }),
  z.strictObject({ action: z.literal("ask"), topic: topicSchema, question: z.string().trim().min(1).max(500), session: sessionScope.optional() }),
  z.strictObject({ action: z.literal("create_project"), topic: topicSchema, name: z.string().trim().min(1).max(120) }),
  z.strictObject({ action: z.literal("create_session"), project_id: z.uuid() }),
  z.strictObject({ action: z.literal("get_session"), project_id: z.uuid(), session_id: z.uuid() }),
  z.strictObject({ action: z.literal("resolve_result"), project_id: z.uuid(), result_id: z.uuid() }),
]);
