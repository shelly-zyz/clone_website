import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { datasets, metricSchema, powerProducts, type DataQuery, type Topic } from "./contracts";
import { DataAgentError, readDataAgent } from "./database.server";

type VersionRow = {
  id: string;
  topic_id: Topic;
  dataset_id: string;
  version: string;
  row_count: number;
  published_at: Date;
  metric_snapshot: unknown;
};

const versionSelect = `SELECT v.id, v.topic_id, v.dataset_id, v.version, v.row_count, v.published_at, v.metric_snapshot
  FROM catalog.dataset_version v
  JOIN semantic.sem_metric m ON m.topic_id = v.topic_id AND m.dataset_id = v.dataset_id
    AND m.metric_code = v.metric_snapshot->>'metric_code' AND m.review_status = 'approved'`;

function catalogEntry(row: VersionRow) {
  return {
    topic: row.topic_id, dataset_id: row.dataset_id, version: row.version,
    published_at: row.published_at.toISOString(), row_count: row.row_count,
    metric: metricSchema.parse(row.metric_snapshot),
  };
}

export async function listDataCatalog(topic?: Topic) {
  return readDataAgent(async (client) => {
    const versions = await client.query<VersionRow>(`${versionSelect}
      WHERE v.is_current AND ($1::text IS NULL OR v.topic_id = $1) ORDER BY v.topic_id`, [topic ?? null]);
    const catalog = versions.rows.map(catalogEntry);
    const power = versions.rows.find((row) => row.topic_id === "power");
    if (!power || topic !== "power") return { datasets: catalog };
    const regions = await client.query<{ code: string; name: string }>(`
      SELECT DISTINCT entity_code AS code, source_ref->>'region_name' AS name
      FROM standard.std_data_agent_fact WHERE topic_id = 'power' AND dataset_version_id = $1 ORDER BY code`, [power.id]);
    return { datasets: catalog, region_codes: regions.rows, products: powerProducts };
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

const dateFilters = `AND ($5::date IS NULL OR time_start >= $5::date::timestamptz)
  AND ($6::date IS NULL OR time_start < ($6::date + 1)::timestamptz)`;

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
    const entity = query.topic === "power" ? query.region_code : "global";
    const series = query.topic === "power" ? query.product : query.topic === "carbon" ? "Power" : "temperature";
    const filters = [query.topic, version.id, entity, series, query.start_date ?? null, query.end_date ?? null];
    let issueTime = query.topic === "meteo" && query.issue_time ? new Date(query.issue_time).toISOString() : null;
    if (query.topic === "meteo" && issueTime === null) {
      const latest = await client.query<{ issue_time: Date | null }>(`
        SELECT max(issue_time) AS issue_time FROM standard.std_data_agent_fact
        WHERE topic_id = $1 AND dataset_version_id = $2 AND entity_code = $3 AND series_code = $4 ${dateFilters}`, filters);
      issueTime = latest.rows[0]?.issue_time?.toISOString() ?? null;
    }

    const result = await client.query<Observation>(`
      SELECT time_start, issue_time, entity_code, series_code, value::text, quality_flag, source_ref,
        (count(*) OVER ())::integer AS matched,
        (count(*) FILTER (WHERE quality_flag = 1) OVER ())::integer AS missing
      FROM standard.std_data_agent_fact
      WHERE topic_id = $1 AND dataset_version_id = $2 AND entity_code = $3 AND series_code = $4 ${dateFilters}
        AND issue_time IS NOT DISTINCT FROM $7::timestamptz
      ORDER BY time_start DESC LIMIT $8`, [...filters, issueTime, query.limit]);

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
      ...(query.topic === "power" ? { region_code: entity, product: query.product } : {}),
      ...(query.topic === "meteo" && issueTime ? { issue_time: issueTime } : {}),
    };
    const queryHash = createHash("sha256").update(JSON.stringify(effectiveQuery)).digest("hex");
    return {
      status: rows.length === 0 ? "empty" : missing === matched ? "missing" : "ok",
      metric: entry.metric,
      query: effectiveQuery,
      data_ref: {
        dataset_id: version.dataset_id, version: version.version, query_hash: queryHash,
        schema: outputSchema, units: { value: entry.metric.unit },
        time_range: { start: rows[0]?.time_start ?? null, end: rows.at(-1)?.time_start ?? null },
        quality: { matched_rows: matched, returned_rows: rows.length, missing_rows: missing, truncated: rows.length < matched },
        artifact_uri: null,
      },
      rows,
    };
  });
}
