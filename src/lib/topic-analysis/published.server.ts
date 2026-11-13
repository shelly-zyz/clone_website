import "server-only";

import { catalogEntry, resolveVersion } from "@/lib/data-agent/catalog.server";
import { readDataAgent } from "@/lib/data-agent/database.server";
import {
  carbonMetrics, fuelSeries, generationSeries, generationYoyMetric, type PublishedFact, type PublishedHistory,
  type PublishedAnalysisTopic, type RegionalGeneration,
} from "./history";

const national = "000000000000";
const generationMetric = "electricity_generation_current";
const fuelMetrics = fuelSeries.map(item => item.code);

function approvedCodes(entry: ReturnType<typeof catalogEntry>, codes: readonly string[]) {
  return entry.metrics.filter(metric => codes.includes(metric.metric_code)).map(metric => metric.metric_code);
}

function publication(entry: ReturnType<typeof catalogEntry>) {
  return { dataset: entry.dataset_id, version: entry.version, publishedAt: entry.published_at };
}

export function readPublishedHistory(topic: PublishedAnalysisTopic): Promise<PublishedHistory> {
  return readDataAgent(async client => {
    const version = await resolveVersion(client, { topic: topic === "carbon" ? "carbon" : "power" });
    const entry = catalogEntry(version);
    let facts: PublishedFact[];

    if (topic === "carbon") {
      const result = await client.query<PublishedFact>(`
        SELECT to_char(time_start, 'YYYY-MM') AS month, metric_code AS series,
               avg(value)::double precision AS value, count(value)::integer AS coverage
        FROM standard.std_data_agent_fact
        WHERE topic_id = 'carbon' AND dataset_version_id = $1 AND metric_code = ANY($2::text[])
          AND entity_code = 'global' AND series_code = 'Power' AND issue_time IS NULL
        GROUP BY 1, 2 ORDER BY 1, 2
      `, [version.id, approvedCodes(entry, carbonMetrics)]);
      facts = result.rows;
    } else {
      const products = (topic === "generation" ? generationSeries : fuelSeries).map(item => item.id);
      const codes = topic === "generation" ? [generationMetric, generationYoyMetric] : fuelMetrics;
      const result = await client.query<PublishedFact>(`
        SELECT to_char(time_start, 'YYYY-MM') AS month,
               CASE WHEN metric_code = $5 THEN metric_code ELSE series_code END AS series,
               value::double precision AS value, CASE WHEN value IS NULL THEN 0 ELSE 1 END AS coverage
        FROM standard.std_data_agent_fact
        WHERE topic_id = 'power' AND dataset_version_id = $1 AND metric_code = ANY($2::text[])
          AND entity_code = $3 AND series_code = ANY($4::text[]) AND issue_time IS NULL
        ORDER BY time_start, series_code
      `, [version.id, approvedCodes(entry, codes), national, products, generationYoyMetric]);
      facts = result.rows;
    }
    return { ...publication(entry), facts };
  });
}

export function readRegionalGeneration(month: string, expectedVersion: string): Promise<RegionalGeneration> {
  return readDataAgent(async client => {
    const version = await resolveVersion(client, { topic: "power", version: expectedVersion });
    const entry = catalogEntry(version);
    const { rows } = await client.query<RegionalGeneration["regions"][number]>(`
      SELECT entity_code AS code, COALESCE(NULLIF(source_ref->>'region_name', ''), entity_code) AS name,
             value::double precision AS value
      FROM standard.std_data_agent_fact
      WHERE topic_id = 'power' AND dataset_version_id = $1 AND metric_code = ANY($2::text[])
        AND series_code = 'electricity' AND entity_code ~ '^[1-9][0-9]0{10}$' AND issue_time IS NULL
        AND time_start >= $3::date::timestamptz AND time_start < ($3::date + interval '1 month')::timestamptz
      ORDER BY value DESC NULLS LAST, entity_code
    `, [version.id, approvedCodes(entry, [generationMetric]), month + "-01"]);
    return { ...publication(entry), month, regions: rows };
  });
}
