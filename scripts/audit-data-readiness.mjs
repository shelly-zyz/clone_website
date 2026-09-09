#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.dirname(repoRoot);
const outputDirectory = path.join(workspaceRoot, "outputs", "20260908-data-readiness");
const outputPath = path.join(outputDirectory, "data-readiness-audit.json");
const sectors = [
  "total",
  "Power",
  "Industry",
  "Residential",
  "GroundTransportation",
  "InternationalAviation",
  "InternationalShipping",
  "DomesticAviation",
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10_000,
  query_timeout: 120_000,
  statement_timeout: 120_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

const query = async (sql, values = []) => (await client.query(sql, values)).rows;

async function fetchGracedAvailability() {
  const results = [];
  for (const sector of sectors) {
    try {
      const response = await fetch("https://carbonmonitor-graced.com/api/data/month", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "OpenGridWorks-data-readiness-audit/1.0",
        },
        body: JSON.stringify({ department: sector, dataType: 0 }),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json();
      const archives = Array.isArray(payload.data)
        ? payload.data
          .filter((item) => item && typeof item === "object" && /^\d{4}-\d{2}$/.test(String(item.dataTime)))
          .sort((left, right) => String(left.dataTime).localeCompare(String(right.dataTime)))
        : [];
      results.push({
        sector,
        reachable: response.ok && payload.success === true,
        archiveCount: archives.length,
        firstMonth: archives[0]?.dataTime ?? null,
        latestMonth: archives.at(-1)?.dataTime ?? null,
        latestFile: archives.at(-1)?.fileName ?? null,
      });
    } catch (error) {
      results.push({
        sector,
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function main() {
  await client.connect();
  const [identity] = await query(`
    SELECT current_database() AS database,
           current_user AS role,
           pg_database_size(current_database())::bigint AS database_bytes,
           pg_size_pretty(pg_database_size(current_database())) AS database_size
  `);
  const extensions = await query(`SELECT extname, extversion FROM pg_extension ORDER BY extname`);
  const tables = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='website_data' AND table_type='BASE TABLE'
    ORDER BY table_name
  `);
  const carbon = await query(`
    SELECT sector, count(*)::int AS daily_frames,
           to_char(min(observed_on),'YYYY-MM-DD') AS first_date,
           to_char(max(observed_on),'YYYY-MM-DD') AS last_date,
           count(*) FILTER (WHERE octet_length(frame_data)=0)::int AS empty_frames,
           count(*) FILTER (WHERE unit<>'kgC/h')::int AS invalid_units
    FROM website_data.carbon_emission_frames
    GROUP BY sector ORDER BY sector
  `);
  const weather = await query(`
    SELECT source, count(*)::int AS rows,
           count(DISTINCT run_time_utc)::int AS cycles,
           count(DISTINCT metric)::int AS metrics,
           to_char(min(run_time_utc),'YYYY-MM-DD HH24:MI:SSOF') AS first_run,
           to_char(max(run_time_utc),'YYYY-MM-DD HH24:MI:SSOF') AS latest_run,
           to_char(max(valid_time_utc),'YYYY-MM-DD HH24:MI:SSOF') AS latest_valid,
           count(*) FILTER (WHERE octet_length(payload_json_gzip)=0)::int AS empty_payloads
    FROM website_data.weather_forecast_fields
    GROUP BY source ORDER BY source
  `);
  const climate = await query(`
    SELECT count(*)::int AS daily_frames,
           count(DISTINCT source_id)::int AS sources,
           count(DISTINCT variable)::int AS variables,
           count(DISTINCT grid_id)::int AS grids,
           to_char(min(valid_date),'YYYY-MM-DD') AS first_date,
           to_char(max(valid_date),'YYYY-MM-DD') AS last_date,
           count(*) FILTER (WHERE missing_count>0)::int AS frames_with_missing_values
    FROM website_data.climate_projection_daily
  `);
  const vre = await query(`
    SELECT count(*)::int AS rows,
           count(DISTINCT region_id)::int AS regions,
           count(DISTINCT technology)::int AS technologies,
           min(year)::int AS first_year,
           max(year)::int AS last_year,
           count(*) FILTER (WHERE hours NOT IN (8760,8784) OR jsonb_array_length(values_json)<>hours)::int AS invalid_rows
    FROM website_data.climate_vre_hourly
  `);
  const energyAssets = await query(`
    SELECT count(*)::int AS rows,
           count(*) FILTER (WHERE capacity_mw<=0)::int AS nonpositive_capacity,
           count(*) FILTER (WHERE region_id IS NULL OR btrim(region_id)='')::int AS missing_region,
           count(*) FILTER (WHERE btrim(name)='')::int AS missing_name,
           count(*) FILTER (WHERE longitude NOT BETWEEN -180 AND 180 OR latitude NOT BETWEEN -90 AND 90)::int AS invalid_coordinates
    FROM website_data.energy_assets
  `);
  const dataCenters = await query(`
    SELECT count(*)::int AS rows,
           count(*) FILTER (WHERE operator IS NULL OR btrim(operator)='')::int AS missing_operator,
           count(*) FILTER (WHERE region_id IS NULL OR btrim(region_id)='')::int AS missing_region,
           count(*) FILTER (WHERE longitude NOT BETWEEN -180 AND 180 OR latitude NOT BETWEEN -90 AND 90)::int AS invalid_coordinates
    FROM website_data.data_centers
  `);
  const potential = await query(`
    SELECT technology, count(*)::int AS rows,
           count(*) FILTER (WHERE annual_capacity_factor NOT BETWEEN 0 AND 1)::int AS invalid_annual_cf,
           count(*) FILTER (WHERE max_capacity_factor NOT BETWEEN 0 AND 1)::int AS invalid_max_cf,
           count(*) FILTER (WHERE capacity_potential_gw<0)::int AS negative_potential,
           count(*) FILTER (WHERE region='' OR grid='')::int AS missing_region_or_grid
    FROM website_data.renewable_resource_potential
    GROUP BY technology ORDER BY technology
  `);
  const geospatial = await query(`
    SELECT dataset, count(*)::int AS rows,
           count(*) FILTER (WHERE geometry IS NULL)::int AS missing_geometry,
           count(*) FILTER (WHERE geometry_type IS NULL OR btrim(geometry_type)='')::int AS missing_geometry_type
    FROM website_data.geo_features
    GROUP BY dataset ORDER BY dataset
  `);
  const sourceFiles = await query(`
    SELECT dataset, import_status, count(*)::int AS files,
           sum(size_bytes)::bigint AS bytes,
           count(*) FILTER (WHERE sha256 IS NULL)::int AS missing_sha256,
           count(*) FILTER (WHERE error IS NOT NULL)::int AS files_with_error
    FROM website_data.source_files
    GROUP BY dataset, import_status
    ORDER BY dataset, import_status
  `);
  const catalog = await query(`
    SELECT dataset_key, earth_layer, name, provider, source_url, data_type,
           spatial_scope, temporal_resolution, coverage_start, coverage_end,
           auth_required, license, acquisition_status, database_status,
           database_relation, priority, notes, updated_at
    FROM website_data.dataset_catalog
    ORDER BY earth_layer, priority, dataset_key
  `);

  const gracedAvailability = await fetchGracedAvailability();
  const output = {
    checkedAt: new Date().toISOString(),
    identity,
    extensions,
    tableCount: tables.length,
    tables: tables.map((row) => row.table_name),
    carbon,
    weather,
    climate: climate[0],
    vre: vre[0],
    energyAssets: energyAssets[0],
    dataCenters: dataCenters[0],
    renewablePotential: potential,
    geospatial,
    sourceFiles,
    catalog,
    gracedAvailability,
  };
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    checkedAt: output.checkedAt,
    database: identity.database,
    databaseSize: identity.database_size,
    tableCount: output.tableCount,
    extensions,
    carbon,
    weather,
    climate: output.climate,
    gracedAvailability,
    outputPath,
  }, null, 2));
}

try {
  await main();
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}
