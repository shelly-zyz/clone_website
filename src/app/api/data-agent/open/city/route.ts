import { z } from "zod";
import { cityDatasets } from "@/lib/data-agent/contracts";
import { dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { queryData } from "@/lib/data-agent/query.server";

export const runtime = "nodejs";

const filters = z.strictObject({
  city_code: z.string().regex(/^\d{6}$/),
  metric: z.enum(["generation", "co2"]),
  year: z.coerce.number().int().min(2000).max(2019).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});
const source = {
  attribution: "Boyang Chen (2025), Power generation and CO₂ emissions of cities in China, figshare. OpenGridWorks 按源城市代码整理。",
  url: "https://doi.org/10.6084/m9.figshare.30338773.v1",
  license: "CC BY 4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
} as const;
const csvCell = (value: string | null) => `"${(value ?? "").replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const input = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return Response.json({ error: "请指定六位 city_code 和 generation 或 co2。可传 2000–2019 年及 json 或 csv 格式。" }, { status: 400 });
  const { city_code, year, metric, format } = input.data;
  const topic = metric === "generation" ? "power" : "carbon";
  try {
    const result = await queryData({
      ...(topic === "power" ? { topic, region_code: "000000000000" } : { topic }),
      dataset_id: cityDatasets[topic], city_code, limit: 20,
      start_date: year ? `${year}-01-01` : undefined,
      end_date: year ? `${year}-12-31` : undefined,
    });
    const version = result.data_ref.version;
    const unit = result.metric.unit;
    const rows = result.rows.map(row => ({
      city_code, year: row.time_start.slice(0, 4), value: row.value, quality_flag: row.quality_flag,
    }));
    const headers = { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" };
    if (format === "csv") {
      const csv = ["city_code,year,metric,value,unit,quality_flag,data_identity,version,source,attribution,license,license_url",
        ...rows.map(row => [city_code, row.year, result.metric.metric_code, row.value, unit, String(row.quality_flag),
          result.metric.data_identity, version, source.url, source.attribution, source.license, source.license_url].map(csvCell).join(",")),
      ];
      return new Response("\uFEFF" + csv.join("\r\n") + "\r\n", { headers: {
        ...headers, "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${city_code}-${metric}.csv"`,
      } });
    }
    return Response.json({ status: result.status, metric: result.metric, version, source, rows }, { headers });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
