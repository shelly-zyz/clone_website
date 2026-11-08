import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { datasets, generationProducts, metricSchema, powerProducts, type DataQuery, type Topic } from "./contracts";
import { DataAgentError, readDataAgent } from "./database.server";

type VersionRow = {
  id: string;
  topic_id: Topic;
  dataset_id: string;
  version: string;
  row_count: number;
  published_at: Date;
  metric_snapshot: unknown;
  metrics: unknown[];
};

const versionSelect = `SELECT v.id, v.topic_id, v.dataset_id, v.version, v.row_count, v.published_at, v.metric_snapshot,
    ARRAY(
      SELECT snapshot.value
      FROM jsonb_each(COALESCE(v.metrics_snapshot, jsonb_build_object(m.metric_code, v.metric_snapshot))) snapshot
      JOIN semantic.sem_metric approved ON approved.topic_id = v.topic_id AND approved.dataset_id = v.dataset_id
        AND approved.metric_code = snapshot.key AND approved.review_status = 'approved'
      ORDER BY snapshot.key
    ) AS metrics
  FROM catalog.dataset_version v
  JOIN semantic.sem_metric m ON m.topic_id = v.topic_id AND m.dataset_id = v.dataset_id
    AND m.metric_code = v.metric_snapshot->>'metric_code' AND m.review_status = 'approved'`;

function catalogEntry(row: VersionRow) {
  return {
    topic: row.topic_id, dataset_id: row.dataset_id, version: row.version,
    published_at: row.published_at.toISOString(), row_count: row.row_count,
    metric: metricSchema.parse(row.metric_snapshot),
    metrics: row.metrics.map((metric) => metricSchema.parse(metric)),
  };
}

export async function listDataCatalog(topic?: Topic, version?: string) {
  return readDataAgent(async (client) => {
    const versions = await client.query<VersionRow>(`${versionSelect}
      WHERE ($1::text IS NULL OR v.topic_id = $1)
        AND (CASE WHEN $2::text IS NULL THEN v.is_current ELSE v.version = $2 END)
      ORDER BY v.topic_id`, [topic ?? null, version ?? null]);
    const catalog = versions.rows.map(catalogEntry);
    const power = versions.rows.find((row) => row.topic_id === "power");
    if (!power || topic !== "power") return { datasets: catalog };
    const regions = await client.query<{ code: string; name: string }>(`
      SELECT DISTINCT entity_code AS code, source_ref->>'region_name' AS name
      FROM standard.std_data_agent_fact WHERE topic_id = 'power' AND dataset_version_id = $1 ORDER BY code`, [power.id]);
    const products = new Set(catalog[0].metrics.flatMap((metric) => metric.series_codes ?? generationProducts));
    return { datasets: catalog, region_codes: regions.rows, products: powerProducts.filter((product) => products.has(product)) };
  });
}

async function resolveVersion(client: PoolClient, query: DataQuery) {
  const { rows } = await client.query<VersionRow>(`${versionSelect}
    WHERE v.topic_id = $1 AND v.dataset_id = $2
      AND (($3::text IS NULL AND v.is_current) OR v.version = $3)`,
  [query.topic, datasets[query.topic], query.version ?? null]);
  if (!rows[0]) throw new DataAgentError("VERSION_NOT_FOUND", "没有找到该专题已发布的数据版本。");
  return rows[0];
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

const factFilters = `topic_id = $1 AND dataset_version_id = $2 AND metric_code = $3
  AND entity_code = $4 AND series_code = $5
  AND ($6::date IS NULL OR time_start >= $6::date::timestamptz)
  AND ($7::date IS NULL OR time_start < ($7::date + 1)::timestamptz)`;

const legacySeries = { power: generationProducts, meteo: ["temperature"], carbon: ["Power"] } as const;

const outputSchema = [
  { name: "time_start", type: "datetime" }, { name: "issue_time", type: "datetime?" },
  { name: "entity_code", type: "string" }, { name: "series_code", type: "string" },
  { name: "value", type: "decimal-string?" }, { name: "quality_flag", type: "integer" },
  { name: "source_ref", type: "object" },
];

export async function queryData(query: DataQuery) {
  return readDataAgent(async (client) => {
    const version = await resolveVersion(client, query);
    const entry = catalogEntry(version);
    const metric = entry.metrics.find(({ metric_code }) => metric_code === (query.metric_code ?? entry.metric.metric_code));
    if (!metric) throw new DataAgentError("INVALID_METRIC", "该指标未在所选专题和版本发布，或当前未通过审核。");
    const entity = query.topic === "power" ? query.region_code : "global";
    if (query.topic === "power" && entity !== "000000000000") {
      const region = await client.query(`
        SELECT 1 FROM standard.std_data_agent_fact
        WHERE topic_id = 'power' AND dataset_version_id = $1 AND entity_code = $2 LIMIT 1`, [version.id, entity]);
      if (!region.rowCount) throw new DataAgentError("INVALID_REGION", "该版本中没有此地区编码。");
    }
    const seriesCodes: readonly string[] = metric.series_codes ?? legacySeries[query.topic];
    const series = (query.topic === "power" ? query.product : undefined) ?? seriesCodes[0];
    if (!seriesCodes.includes(series)) throw new DataAgentError("INVALID_SERIES", "该指标在所选版本中没有发布此产品序列。");
    const filters = [query.topic, version.id, metric.metric_code, entity, series, query.start_date ?? null, query.end_date ?? null];
    let issueTime = query.topic === "meteo" && query.issue_time ? new Date(query.issue_time).toISOString() : null;
    if (query.topic === "meteo" && issueTime === null) {
      const latest = await client.query<{ issue_time: Date | null }>(`
        SELECT max(issue_time) AS issue_time FROM standard.std_data_agent_fact
        WHERE ${factFilters}`, filters);
      issueTime = latest.rows[0]?.issue_time?.toISOString() ?? null;
    }

    const result = await client.query<Observation>(`
      SELECT time_start, issue_time, entity_code, series_code, value::text, quality_flag, source_ref,
        (count(*) OVER ())::integer AS matched,
        (count(*) FILTER (WHERE quality_flag = 1) OVER ())::integer AS missing
      FROM standard.std_data_agent_fact
      WHERE ${factFilters} AND issue_time IS NOT DISTINCT FROM $8::timestamptz
      ORDER BY time_start DESC LIMIT $9`, [...filters, issueTime, query.limit]);

    const matched = result.rows[0]?.matched ?? 0;
    const missing = result.rows[0]?.missing ?? 0;
    const rows = result.rows.reverse().map((row) => ({
      time_start: row.time_start.toISOString(), issue_time: row.issue_time?.toISOString() ?? null,
      entity_code: row.entity_code, series_code: row.series_code, value: row.value,
      quality_flag: row.quality_flag, source_ref: row.source_ref,
    }));
    const effectiveQuery = {
      topic: query.topic, version: version.version, start_date: query.start_date, end_date: query.end_date,
      limit: query.limit,
      ...(query.topic === "power" ? { region_code: entity, product: series } : {}),
      ...(query.topic === "meteo" && issueTime ? { issue_time: issueTime } : {}),
      // Keep the legacy replay hash for a version's default metric.
      ...(metric.metric_code !== entry.metric.metric_code ? { metric_code: metric.metric_code } : {}),
    };
    const queryHash = createHash("sha256").update(JSON.stringify(effectiveQuery)).digest("hex");
    return {
      status: rows.length === 0 ? "empty" : missing === matched ? "missing" : "ok",
      metric,
      query: effectiveQuery,
      data_ref: {
        dataset_id: version.dataset_id, version: version.version, query_hash: queryHash,
        schema: outputSchema, units: { value: metric.unit },
        time_range: { start: rows[0]?.time_start ?? null, end: rows.at(-1)?.time_start ?? null },
        quality: { matched_rows: matched, returned_rows: rows.length, missing_rows: missing, truncated: rows.length < matched },
        artifact_uri: null,
      },
      rows,
    };
  });
}
