import "server-only";

import { withBusinessAction } from "@/lib/agent-runtime/policy.server";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { cityDatasets, datasets, generationProducts, powerProducts, type DataQuery, type DataTopic } from "./contracts";
import { cityCodesForName } from "./city-names";
import { catalogEntry, resolveVersion, versionSelect, type VersionRow } from "./catalog.server";
import { DataAgentError, readDataAgent } from "./database.server";
import type { QueryDiagnosis } from "./query-diagnosis";

export async function listDataCatalog(topic?: DataTopic, version?: string) {
  return readDataAgent(async (client) => {
    const versions = await client.query<VersionRow>(`${versionSelect}
      WHERE ($1::text IS NULL OR v.topic_id = $1)
        AND (CASE WHEN $2::text IS NULL THEN v.is_current ELSE v.version = $2 END)
      ORDER BY v.topic_id, (v.dataset_id = ANY($3::text[])) DESC, v.dataset_id`, [topic ?? null, version ?? null, Object.values(datasets)]);
    const catalog = versions.rows.map(catalogEntry);
    const power = versions.rows.find((row) => row.dataset_id === datasets.power);
    if (!power || topic !== "power") return { datasets: catalog };
    const regions = await client.query<{ code: string; name: string }>(`
      SELECT DISTINCT entity_code AS code, source_ref->>'region_name' AS name
      FROM standard.std_data_agent_fact WHERE topic_id = 'power' AND dataset_version_id = $1 ORDER BY code`, [power.id]);
    const products = new Set(catalogEntry(power).metrics.flatMap((metric) => metric.series_codes ?? generationProducts));
    return { datasets: catalog, region_codes: regions.rows, products: powerProducts.filter((product) => products.has(product)) };
  });
}

export async function listDataEntities(topic: DataTopic, datasetId: string, search: string, version?: string) {
  const cityCodes = datasetId === cityDatasets.power || datasetId === cityDatasets.carbon ? cityCodesForName(search) : [];
  return readDataAgent(async client => {
    const { rows } = await client.query<{ code: string; name: string }>(`
      SELECT DISTINCT f.entity_code AS code, COALESCE(f.source_ref->>'region_name', f.entity_code) AS name
      FROM catalog.dataset_version v JOIN standard.std_data_agent_fact f
        ON f.topic_id = v.topic_id AND f.dataset_version_id = v.id
      WHERE v.topic_id = $1 AND v.dataset_id = $2
        AND (CASE WHEN $4::text IS NULL THEN v.is_current ELSE v.version = $4 END)
        AND (f.entity_code = ANY($5::text[]) OR lower(f.entity_code) = lower($3) OR strpos(lower(f.source_ref->>'region_name'), lower($3)) > 0)
      ORDER BY 1, 2 LIMIT 20`, [topic, datasetId, search, version ?? null, cityCodes]);
    return rows;
  });
}

type Observation = {
  time_start: Date;
  issue_time: Date | null;
  entity_code: string;
  series_code: string;
  value: string | null;
  quality_flag: number;
  source_ref: Record<string, string | number | null>;
  matched: number;
  missing: number;
};

const seriesFilters = (comparison: boolean) => `topic_id = $1 AND dataset_version_id = $2 AND metric_code = $3
  AND ${comparison ? "($4::text = '000000000000' AND entity_code ~ '^[1-9][0-9]0{10}$')" : "entity_code = $4"}
  AND series_code = $5`;

const factFilters = (comparison = false) => `${seriesFilters(comparison)}
  AND ($6::date IS NULL OR time_start >= $6::date::timestamptz)
  AND ($7::date IS NULL OR time_start < ($7::date + 1)::timestamptz)`;

async function diagnoseQuery(client: PoolClient, query: DataQuery, filters: unknown[], issueTime: string | null,
  comparison: boolean, timeGrain: string, status: "empty" | "missing"): Promise<QueryDiagnosis> {
  // Only coverage metadata may extend beyond the requested dates. Keep all other filters fixed.
  const { rows: [coverage] } = await client.query<{ start: string | null; end: string | null; nearest: string | null }>(`
    SELECT (min(time_start)::date)::text AS start, (max(time_start)::date)::text AS "end",
      COALESCE(max(time_start) FILTER (WHERE time_start < $6::date::timestamptz),
        min(time_start) FILTER (WHERE time_start >= ($7::date + 1)::timestamptz))::date::text AS nearest
    FROM standard.std_data_agent_fact
    WHERE ${seriesFilters(comparison)} AND quality_flag = 0
      AND (${query.topic === "meteo" ? "$8::timestamptz IS NULL OR " : ""}issue_time IS NOT DISTINCT FROM $8::timestamptz)`,
  [...filters, issueTime]);
  const nearest = coverage.nearest;
  const monthEnd = nearest && timeGrain === "month" ? new Date(`${nearest}T00:00:00Z`) : null;
  if (monthEnd) monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  const end = monthEnd?.toISOString().slice(0, 10) ?? nearest;
  return {
    reason: status === "missing" ? "all_values_missing" : "no_matching_rows",
    available_range: coverage.start && coverage.end ? { start: coverage.start, end: coverage.end } : null,
    suggested_range: nearest && end ? { start_date: nearest, end_date: end } : null,
  };
}

const legacySeries = { power: generationProducts, meteo: ["temperature"], carbon: ["Power"], economy: ["annual"] } as const;

const outputSchema = [
  { name: "time_start", type: "datetime" }, { name: "issue_time", type: "datetime?" },
  { name: "entity_code", type: "string" }, { name: "series_code", type: "string" },
  { name: "value", type: "decimal-string?" }, { name: "quality_flag", type: "integer" },
  { name: "source_ref", type: "object" },
];

export async function queryData(query: DataQuery) {
  return withBusinessAction("data", "query_published", () => executeDataQuery(query));
}

async function executeDataQuery(query: DataQuery) {
  return readDataAgent(async (client) => {
    const version = await resolveVersion(client, query);
    const entry = catalogEntry(version);
    const metric = entry.metrics.find(({ metric_code }) => metric_code === (query.metric_code ?? entry.metric.metric_code));
    if (!metric) throw new DataAgentError("INVALID_METRIC", "该指标未在所选专题和版本发布，或当前未通过审核。");
    const comparison = query.topic === "power" && query.province_comparison === true;
    if (comparison && (version.dataset_id !== datasets.power || metric.time_grain !== "month")) {
      throw new DataAgentError("INVALID_METRIC", "省级比较仅支持同一月份、同一口径的月度指标。");
    }
    const city = "city_code" in query ? query.city_code : undefined;
    const cityDataset = version.dataset_id === cityDatasets.power || version.dataset_id === cityDatasets.carbon;
    if (cityDataset !== Boolean(city)) {
      throw new DataAgentError("INVALID_REGION", cityDataset ? "请指定该版本中的六位城市代码。" : "城市代码仅适用于城市年度数据。");
    }
    const entity = city ?? (query.topic === "economy" ? query.economy_code : query.topic === "power" ? query.region_code
      : query.topic === "meteo" ? query.region_code ?? "global" : "global");
    if (cityDataset || query.topic === "economy" || (query.topic === "power" && entity !== "000000000000")) {
      const region = await client.query(`
        SELECT 1 FROM standard.std_data_agent_fact
        WHERE topic_id = $1 AND dataset_version_id = $2 AND entity_code = $3 LIMIT 1`, [query.topic, version.id, entity]);
      if (!region.rowCount) throw new DataAgentError("INVALID_REGION", "该版本中没有此地区编码。");
    }
    const seriesCodes: readonly string[] = metric.series_codes ?? legacySeries[query.topic];
    const series = (query.topic === "power" ? query.product : undefined) ?? seriesCodes[0];
    if (!seriesCodes.includes(series)) throw new DataAgentError("INVALID_SERIES", "该指标在所选版本中没有发布此产品序列。");
    const filters = [query.topic, version.id, metric.metric_code, entity, series, query.start_date ?? null, query.end_date ?? null];
    let issueTime = query.topic === "meteo" && query.issue_time ? new Date(query.issue_time).toISOString() : null;
    if (query.topic === "meteo" && query.model && issueTime === null) {
      const run = await client.query<{ issue_time: Date }>(
        "SELECT issue_time FROM catalog.weather_model_releases WHERE dataset_version_id = $1", [version.id]);
      issueTime = run.rows[0].issue_time.toISOString();
    }
    if (query.topic === "meteo" && issueTime === null) {
      const latest = await client.query<{ issue_time: Date | null }>(`
        SELECT max(issue_time) AS issue_time FROM standard.std_data_agent_fact
        WHERE ${factFilters()}`, filters);
      issueTime = latest.rows[0]?.issue_time?.toISOString() ?? null;
    }

    const result = await client.query<Observation>(`
      SELECT time_start, issue_time, entity_code, series_code, value::text, quality_flag, source_ref,
        (count(*) OVER ())::integer AS matched,
        (count(*) FILTER (WHERE quality_flag = 1) OVER ())::integer AS missing
      FROM standard.std_data_agent_fact
      WHERE ${factFilters(comparison)}
        AND issue_time IS NOT DISTINCT FROM $8::timestamptz
        ${comparison ? "AND time_start = $6::date::timestamptz" : ""}
      ORDER BY ${comparison ? "std_data_agent_fact.value DESC NULLS LAST, entity_code ASC" : "time_start DESC"} LIMIT $9`, [...filters, issueTime, query.limit]);

    const matched = result.rows[0]?.matched ?? 0;
    const missing = result.rows[0]?.missing ?? 0;
    if (comparison && new Set(result.rows.map(row => row.entity_code)).size !== result.rows.length) {
      throw new DataAgentError("INVALID_REGION", "发布版本含重复省级记录，无法生成同口径比较。");
    }
    const rows = (comparison ? result.rows : result.rows.reverse()).map((row) => ({
      time_start: row.time_start.toISOString(), issue_time: row.issue_time?.toISOString() ?? null,
      entity_code: row.entity_code, series_code: row.series_code, value: row.value,
      quality_flag: row.quality_flag, source_ref: row.source_ref,
    }));
    const effectiveQuery = {
      topic: query.topic, version: version.version, start_date: query.start_date, end_date: query.end_date,
      limit: query.limit,
      ...(city ? { city_code: city } : {}),
      ...(query.topic === "economy" ? { economy_code: entity } : {}),
      ...(query.topic === "power" && !city ? { region_code: entity, product: series, ...(comparison ? { province_comparison: true as const } : {}) } : {}),
      ...(query.topic === "meteo" && issueTime ? { issue_time: issueTime } : {}),
      ...(query.topic === "meteo" && query.model ? { model: query.model, region_code: entity } : {}),
      // Keep the legacy replay hash for a version's default metric.
      ...(metric.metric_code !== entry.metric.metric_code ? { metric_code: metric.metric_code } : {}),
    };
    const queryHash = createHash("sha256").update(JSON.stringify(effectiveQuery)).digest("hex");
    const status = rows.length === 0 ? "empty" : missing === matched ? "missing" : "ok";
    const diagnosis = status === "ok" ? undefined : await diagnoseQuery(client, query, filters, issueTime, comparison, metric.time_grain, status);
    return {
      status,
      ...(diagnosis ? { diagnosis } : {}),
      metric,
      query: effectiveQuery,
      data_ref: {
        dataset_id: version.dataset_id, version: version.version, query_hash: queryHash,
        schema: outputSchema, units: { value: metric.unit },
        shape: comparison ? "category" as const : "time_series" as const,
        dimensions: { x: comparison ? "entity_code" : "time_start", series: "series_code", time_grain: metric.time_grain },
        time_range: { start: rows[0]?.time_start ?? null, end: rows.at(-1)?.time_start ?? null },
        quality: { matched_rows: matched, returned_rows: rows.length, missing_rows: missing, truncated: rows.length < matched },
        artifact_uri: null,
      },
      rows,
    };
  });
}
