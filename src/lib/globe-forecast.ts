import { z } from "zod";

export const forecastOverviewRequestSchema = z.strictObject({
  topic: z.enum(["power", "weather", "carbon"]),
});
export type ForecastOverviewTopic = z.infer<typeof forecastOverviewRequestSchema>["topic"];

const forecastPointSchema = z.object({ date: z.string(), value: z.number().nullable() });
export type ForecastPoint = z.infer<typeof forecastPointSchema>;

export const forecastOverviewSchema = z.object({
  source: z.string(),
  version: z.string(),
  unit: z.string(),
  issueTime: z.string().nullable(),
  historicalIssue: z.boolean(),
  points: z.array(forecastPointSchema),
  training: z.object({ start: z.string(), end: z.string(), count: z.number() }).nullable(),
  continuous: z.number().nullable(),
});

export type ForecastOverview = z.infer<typeof forecastOverviewSchema>;
