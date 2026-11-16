import { z } from "zod";
import { regionalWeatherModel, weatherRegionCode, weatherRegionSchema } from "./weather-model-forecast";

export const regionalForecastFilter = z.strictObject({
  model: regionalWeatherModel,
  region_code: weatherRegionCode,
});
export type RegionalForecastFilter = z.infer<typeof regionalForecastFilter>;

export const forecastOverviewRequestSchema = z.strictObject({
  topic: z.enum(["power", "weather", "carbon"]),
  regional: regionalForecastFilter.optional(),
}).refine(({ topic, regional }) => !regional || topic === "weather");
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
  weatherRegions: z.array(weatherRegionSchema).optional(),
  regional: z.object({
    regionName: z.string(),
    modelVersion: z.string(),
    sourceUri: z.string(),
    coverage: z.object({ validCells: z.number(), totalCells: z.number() }).optional(),
    comparison: z.object({
      source: z.string(), version: z.string(), modelVersion: z.string(), points: z.array(forecastPointSchema),
    }).optional(),
  }).optional(),
});

export type ForecastOverview = z.infer<typeof forecastOverviewSchema>;
