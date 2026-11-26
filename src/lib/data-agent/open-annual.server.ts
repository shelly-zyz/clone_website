import "server-only";

import type { queryData } from "./query.server";

type PublicSource = {
  attribution: string;
  url: string;
  license: string;
  license_url: string;
  terms_url?: string;
};

type AnnualResponse = {
  result: Awaited<ReturnType<typeof queryData>>;
  entity: { column: "city_code" | "economy_code"; code: string };
  source: PublicSource;
  metric: string;
  format: "json" | "csv";
};

const csvCell = (value: string | null) => `"${(value ?? "").replaceAll('"', '""')}"`;

export function openAnnualResponse({ result, entity, source, metric, format }: AnnualResponse) {
  const { version } = result.data_ref;
  const rows = result.rows.map(row => ({
    [entity.column]: entity.code, year: row.time_start.slice(0, 4), value: row.value, quality_flag: row.quality_flag,
  }));
  const headers = { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" };
  if (format === "json") {
    return Response.json({ status: result.status, metric: result.metric, version, source, rows }, { headers });
  }
  const sourceColumns = ["source", "attribution", "license", "license_url"];
  const sourceValues = [source.url, source.attribution, source.license, source.license_url];
  if (source.terms_url) {
    sourceColumns.push("terms_url");
    sourceValues.push(source.terms_url);
  }
  const csv = [
    [entity.column, "year", "metric", "value", "unit", "quality_flag", "data_identity", "version", ...sourceColumns].join(","),
    ...rows.map(row => [entity.code, row.year, result.metric.metric_code, row.value, result.metric.unit,
      String(row.quality_flag), result.metric.data_identity, version, ...sourceValues].map(csvCell).join(",")),
  ];
  return new Response("\uFEFF" + csv.join("\r\n") + "\r\n", { headers: {
    ...headers, "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${entity.code}-${metric}.csv"`,
  } });
}
