import "server-only";

import { z } from "zod";
import { readDataAgent } from "@/lib/data-agent/database.server";
import { weatherRegionSchema, type WeatherRegion } from "./weather-model-forecast";

export async function listWeatherForecastRegions(): Promise<{ regions: WeatherRegion[] }> {
  return readDataAgent(async client => {
    const { rows } = await client.query(`
      SELECT region_code AS code, min(region_name) AS name, array_agg(DISTINCT model ORDER BY model) AS models
      FROM catalog.weather_model_releases GROUP BY region_code ORDER BY name, code LIMIT 120`);
    return { regions: z.array(weatherRegionSchema).parse(rows) };
  });
}

// GFS remains usable while the regional migration is being rolled out.
export async function optionalWeatherForecastRegions(): Promise<WeatherRegion[] | undefined> {
  try {
    return (await listWeatherForecastRegions()).regions;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "42P01") return undefined;
    throw error;
  }
}

export async function inspectWeatherFile(id: string) {
  return readDataAgent(async client => {
    const { rows: [inspection] } = await client.query(`SELECT id, version, model, model_version,
      region_code, region_name, bounds, issue_time, source_uri, file_sha256, file_metadata, status,
      submitted_at, reviewed_at FROM catalog.weather_file_inspections WHERE id = $1::uuid`, [id]);
    return inspection ? { status: "ok", inspection } : { status: "empty" };
  });
}
