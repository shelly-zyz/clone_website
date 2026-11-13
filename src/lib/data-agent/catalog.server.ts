import "server-only";

import type { PoolClient } from "pg";
import { datasets, metricSchema, type DataQuery, type Topic } from "./contracts";
import { DataAgentError } from "./database.server";
import { withMetricRules } from "./metric-rules";

export type VersionRow = {
  id: string;
  topic_id: Topic;
  dataset_id: string;
  version: string;
  row_count: number;
  published_at: Date;
  metric_snapshot: unknown;
  metrics: unknown[];
};

export const versionSelect = `SELECT v.id, v.topic_id, v.dataset_id, v.version, v.row_count, v.published_at, v.metric_snapshot,
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

export function catalogEntry(row: VersionRow) {
  return {
    topic: row.topic_id, dataset_id: row.dataset_id, version: row.version,
    published_at: row.published_at.toISOString(), row_count: row.row_count,
    metric: withMetricRules(row.dataset_id, metricSchema.parse(row.metric_snapshot)),
    metrics: row.metrics.map((metric) => withMetricRules(row.dataset_id, metricSchema.parse(metric))),
  };
}

export async function resolveVersion(client: PoolClient, query: Pick<DataQuery, "topic" | "version">) {
  const { rows } = await client.query<VersionRow>(`${versionSelect}
    WHERE v.topic_id = $1 AND v.dataset_id = $2
      AND (($3::text IS NULL AND v.is_current) OR v.version = $3)`,
  [query.topic, datasets[query.topic], query.version ?? null]);
  if (!rows[0]) throw new DataAgentError("VERSION_NOT_FOUND", "没有找到该专题已发布的数据版本。");
  return rows[0];
}
