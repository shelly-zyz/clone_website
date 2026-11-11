import { dataQuerySchema } from "@/lib/data-agent/contracts";
import { authorizeXiaoyun, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { queryData } from "@/lib/data-agent/query.server";
import { profileDataResult, type DataResult } from "@/lib/data-agent/result-profile";
import { forecastOverviewRequestSchema, type ForecastOverview } from "@/lib/globe-forecast";

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

export async function POST(request: Request) {
  const unauthorized = authorizeXiaoyun(request);
  if (unauthorized) return unauthorized;
  const raw = await request.text();
  if (raw.length > 128) return Response.json({ error: "预览请求过长。" }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); } catch {
    return Response.json({ error: "无效的预测预览请求。" }, { status: 400 });
  }
  const parsed = forecastOverviewRequestSchema.safeParse(input);
  if (!parsed.success) return Response.json({ error: "不支持的预测专题。" }, { status: 400 });

  try {
    const data = await queryData(dataQuerySchema.parse(queries[parsed.data.topic]));
    const profile = profileDataResult(data);
    const lastValid = data.rows.findLast(({ value }) => value !== null);
    const overview: ForecastOverview = {
      source: data.metric.source_name,
      version: data.data_ref.version,
      unit: data.metric.unit,
      issueTime: data.rows[0]?.issue_time ?? null,
      historicalIssue: parsed.data.topic === "weather" && !!lastValid && Date.parse(lastValid.time_start) < Date.now(),
      points: data.rows.map(row => ({ date: row.time_start, value: row.value === null ? null : Number(row.value) })),
      training: profile.historical ? lastTrainingWindow(data) : null,
      continuous: profile.continuous,
    };
    return Response.json(overview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
