#!/usr/bin/env node

import process from "node:process";

import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
const sourceId = "hill-of-towie-v2-2025";
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
  query_timeout: 120_000,
  statement_timeout: 120_000,
  application_name: "hill-of-towie-verification",
});

try {
  await client.connect();
  const source = await client.query(`SELECT source_id,import_status,archive_size_bytes,archive_md5,imported_at FROM website_data.forecast_scada_sources WHERE source_id=$1`, [sourceId]);
  const turbines = await client.query(`SELECT count(*)::int AS rows,count(DISTINCT station_id)::int AS stations,sum(rated_power_kw)/1000.0 AS installed_capacity_mw FROM website_data.forecast_scada_turbines WHERE source_id=$1`, [sourceId]);
  const observations = await client.query(`SELECT count(*)::int AS rows,to_char(min(observed_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS earliest_utc,to_char(max(observed_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS latest_utc,count(*)-count(DISTINCT observed_at) AS duplicate_times,count(*) FILTER (WHERE active_power_mw IS NULL)::int AS missing_power FROM website_data.forecast_scada_observations WHERE source_id=$1`, [sourceId]);
  const signals = await client.query(`SELECT count(*)::int AS rows,count(DISTINCT turbine_id)::int AS turbines,to_char(min(observed_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS earliest_utc,to_char(max(observed_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS latest_utc,count(*)-count(DISTINCT (observed_at,turbine_id)) AS duplicate_keys,count(*) FILTER (WHERE curtailment_flag IS NOT NULL)::int AS claimed_curtailment_rows FROM website_data.forecast_scada_turbine_signals WHERE source_id=$1`, [sourceId]);
  const monthly = await client.query(`SELECT to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM') AS month,count(*)::int AS rows,count(DISTINCT turbine_id)::int AS turbines FROM website_data.forecast_scada_turbine_signals WHERE source_id=$1 GROUP BY 1 ORDER BY 1`, [sourceId]);
  const perTurbine = await client.query(`SELECT turbine_id,count(*)::int AS rows,count(*) FILTER (WHERE quality_code='valid')::int AS valid_rows,round(100.0*count(*)/(SELECT count(*) FROM website_data.forecast_scada_observations WHERE source_id=$1),2) AS temporal_completeness_pct FROM website_data.forecast_scada_turbine_signals WHERE source_id=$1 GROUP BY turbine_id ORDER BY turbine_id`, [sourceId]);
  const signalQuality = await client.query(`SELECT quality_code,count(*)::int AS rows FROM website_data.forecast_scada_turbine_signals WHERE source_id=$1 GROUP BY quality_code ORDER BY quality_code`, [sourceId]);
  const observationQuality = await client.query(`SELECT quality_code,count(*)::int AS rows FROM website_data.forecast_scada_observations WHERE source_id=$1 GROUP BY quality_code ORDER BY quality_code`, [sourceId]);
  const database = await client.query(`SELECT pg_database_size(current_database())::bigint AS bytes,pg_size_pretty(pg_database_size(current_database())) AS pretty`);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), source: source.rows[0] ?? null,
    turbines: turbines.rows[0], observations: observations.rows[0], signals: signals.rows[0],
    monthlySignals: monthly.rows, perTurbine: perTurbine.rows, signalQuality: signalQuality.rows,
    observationQuality: observationQuality.rows, databaseSize: database.rows[0],
  }, null, 2));
} finally {
  await client.end();
}
