import { dataQuerySchema } from "@/lib/data-agent/contracts";
import { DataAgentError } from "@/lib/data-agent/database.server";
import { authorizeXiaoyun, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { queryData } from "@/lib/data-agent/query.server";
import { profileDataResult, type DataResult } from "@/lib/data-agent/result-profile";
import { optionalWeatherForecastRegions } from "@/lib/weather-model-forecast.server";
import { weatherModelNames } from "@/lib/weather-model-forecast";
import { forecastOverviewRequestSchema, type ForecastOverview, type RegionalForecastFilter } from "@/lib/globe-forecast";

export const runtime = "nodejs";

const queries = {
  weather: { topic: "meteo", metric_code: "grid_wind_speed_10m_mean", limit: 24 },
  power: { topic: "power", metric_code: "electricity_generation_current", product: "electricity", limit: 36 },
  carbon: { topic: "carbon", metric_code: "global_grid_emission_rate_sum", limit: 31 },
} as const;

function lastTrainingWindow(data: DataResult) {
  // Monthly releases can contain missing or combined months. Use a continuous window
  // and keep its actual cutoff visible when it ends before the latest observation.
  for (let end = data.rows.length; end >= 8; end--) {
    const rows = data.rows.slice(0, end);
    const profile = profileDataResult({ ...data, rows });
    if (profile.analysis.forecast && profile.continuous) {
      return {
        start: rows[end - profile.continuous].time_start,
        end: rows[end - 1].time_start,
        count: profile.continuous,
      };
    }
  }
  return null;
}

function forecastPoints(data: DataResult) {
  return data.rows.map(row => ({ date: row.time_start, value: row.value === null ? null : Number(row.value) }));
}

async function readRegionalForecast(regional: RegionalForecastFilter): Promise<ForecastOverview> {
  const empty = { source: weatherModelNames[regional.model], version: "", unit: "m/s", issueTime: null,
    historicalIssue: false, points: [], training: null, continuous: null };
  if (!(await optionalWeatherForecastRegions())?.some(region => region.code === regional.region_code &&
      region.models.includes(regional.model))) return empty;

  const query = dataQuerySchema.parse({ topic: "meteo", ...regional, limit: 120 });
  const data = await queryData(query).catch((error: unknown) => {
    if (error instanceof DataAgentError && error.code === "VERSION_NOT_FOUND") return null;
    throw error;
  });
  if (!data) return empty;
  const issue = data.rows[0]?.issue_time;
  if (!issue) return empty;
  const latest = data.rows.findLast(row => row.value !== null);
  const metadata = data.rows[0].source_ref;
  const coverage = data.rows.at(-1)?.source_ref;
  const peerModel = regional.model === "wrf" ? "climax" : "wrf";
  const peer = await queryData(dataQuerySchema.parse({ topic: "meteo",
    model: peerModel, region_code: regional.region_code, issue_time: issue, limit: 120 }))
    .catch((error: unknown) => {
      if (error instanceof DataAgentError && error.code === "VERSION_NOT_FOUND") return null;
      throw error;
    });
  const dates = new Set(data.rows.filter(({ value }) => value !== null).map(row => row.time_start));
  const overlap = peer && forecastPoints(peer).filter(point => dates.has(point.date) && point.value !== null);
  return { ...empty, version: data.data_ref.version, issueTime: issue,
    historicalIssue: !!latest && Date.parse(latest.time_start) < Date.now(), points: forecastPoints(data),
    regional: {
      regionName: String(metadata.region_name),
      modelVersion: String(metadata.model_version),
      sourceUri: String(metadata.source_uri),
      coverage: coverage ? { validCells: Number(coverage.valid_cells), totalCells: Number(coverage.total_cells) } : undefined,
      comparison: peer && overlap?.length ? { source: peer.metric.source_name, version: peer.data_ref.version,
        modelVersion: String(peer.rows[0].source_ref.model_version), points: overlap } : undefined,
    },
  };
}

export async function POST(request: Request) {
  const unauthorized = authorizeXiaoyun(request);
  if (unauthorized) return unauthorized;
  const raw = await request.text();
  if (raw.length > 256) return Response.json({ error: "预览请求过长。" }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); } catch {
    return Response.json({ error: "无效的预测预览请求。" }, { status: 400 });
  }
  const parsed = forecastOverviewRequestSchema.safeParse(input);
  if (!parsed.success) return Response.json({ error: "不支持的预测专题。" }, { status: 400 });

  try {
    if (parsed.data.regional) {
      return Response.json(await readRegionalForecast(parsed.data.regional), { headers: { "Cache-Control": "no-store" } });
    }
    const data = await queryData(dataQuerySchema.parse(queries[parsed.data.topic]));
    const profile = profileDataResult(data);
    const lastValid = data.rows.findLast(({ value }) => value !== null);
    const overview: ForecastOverview = {
      source: data.metric.source_name,
      version: data.data_ref.version,
      unit: data.metric.unit,
      issueTime: data.rows[0]?.issue_time ?? null,
      historicalIssue: parsed.data.topic === "weather" && !!lastValid && Date.parse(lastValid.time_start) < Date.now(),
      points: forecastPoints(data),
      ...(parsed.data.topic === "weather" ? { weatherRegions: await optionalWeatherForecastRegions() } : {}),
      training: profile.historical ? lastTrainingWindow(data) : null,
      continuous: profile.continuous,
    };
    return Response.json(overview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
