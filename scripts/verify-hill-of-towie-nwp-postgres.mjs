#!/usr/bin/env node

import process from "node:process";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const sourceId = "noaa-ncei-gfs-forecast-grid004";
const entityId = "hill-of-towie";
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
  query_timeout: 120_000,
  statement_timeout: 120_000,
  application_name: "hill-of-towie-nwp-verification",
});

try {
  await client.connect();
  const source = await client.query(`SELECT source_id,import_status,native_resolution_hours,grid_resolution_degrees,metadata,imported_at FROM website_data.forecast_nwp_sources WHERE source_id=$1`, [sourceId]);
  const points = await client.query(`
    SELECT count(*)::int AS rows,count(DISTINCT valid_time)::int AS valid_times,
      to_char(min(valid_time) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS earliest_valid_utc,
      to_char(max(valid_time) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS latest_valid_utc,
      count(*) FILTER (WHERE issue_time >= valid_time)::int AS future_issue_rows,
      count(*) FILTER (WHERE quality_code <> 'valid')::int AS non_valid_rows,
      count(DISTINCT grid_latitude)::int AS grid_latitudes,count(DISTINCT grid_longitude)::int AS grid_longitudes
    FROM website_data.forecast_nwp_points WHERE source_id=$1 AND entity_id=$2`, [sourceId, entityId]);
  const pairs = await client.query(`
    SELECT count(*)::int AS rows,
      to_char(min(observed_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS earliest_observed_utc,
      to_char(max(observed_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS latest_observed_utc,
      count(*) FILTER (WHERE nwp_interpolation_method='native-3-hour')::int AS native_rows,
      count(*) FILTER (WHERE nwp_interpolation_method='linear-vector-interpolation')::int AS interpolated_rows,
      count(*) FILTER (WHERE nwp_issue_time >= nwp_valid_time)::int AS future_issue_rows,
      count(*) FILTER (WHERE observed_at <> nwp_valid_time)::int AS mismatched_valid_times,
      count(*) FILTER (WHERE curtailment_known)::int AS curtailment_known_rows,
      count(*) FILTER (WHERE quality_code <> 'valid')::int AS non_valid_rows,
      count(*) FILTER (WHERE available_capacity_mw > installed_capacity_mw)::int AS capacity_overflow_rows
    FROM website_data.forecast_training_pairs WHERE entity_id=$1`, [entityId]);
  const quality = await client.query(`SELECT quality_code,count(*)::int AS rows FROM website_data.forecast_training_pairs WHERE entity_id=$1 GROUP BY quality_code ORDER BY quality_code`, [entityId]);
  const sample = await client.query(`
    SELECT to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS observed_utc,
      round(nwp_wind_speed_mps::numeric,3)::float AS nwp_wind_speed_mps,
      nwp_interpolation_method,nwp_issue_time < nwp_valid_time AS issue_precedes_valid,
      curtailment_known
    FROM website_data.forecast_training_pairs WHERE entity_id=$1 ORDER BY observed_at LIMIT 3`, [entityId]);
  const database = await client.query(`SELECT pg_database_size(current_database())::bigint AS bytes,pg_size_pretty(pg_database_size(current_database())) AS pretty`);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), source: source.rows[0] ?? null,
    points: points.rows[0] ?? null, pairs: pairs.rows[0] ?? null,
    pairQuality: quality.rows, sample: sample.rows, databaseSize: database.rows[0],
    productionGate: { unlocked: false, reason: "curtailment_known is false and this table is for historical backtest/research only" },
  }, null, 2));
} finally {
  await client.end();
}
