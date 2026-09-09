#!/usr/bin/env node

import process from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 60_000,
  statement_timeout: 60_000,
});

const query = async (sql) => (await client.query(sql)).rows;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  await client.connect();
  const identity = await query(`SELECT current_database() AS database, current_user AS role,
                  pg_size_pretty(pg_database_size(current_database())) AS database_size`);
  const carbon = await query(`SELECT f.sector, count(*)::int AS daily_frames,
                  to_char(min(f.observed_on),'YYYY-MM-DD') AS first_date,
                  to_char(max(f.observed_on),'YYYY-MM-DD') AS last_date,
                  count(DISTINCT a.data_month)::int AS source_months
           FROM website_data.carbon_emission_frames f
           JOIN website_data.carbon_source_archives a ON a.official_id=f.source_archive_id
           GROUP BY f.sector ORDER BY f.sector`);
  const carbonIntegrity = await query(`SELECT
             count(*) FILTER (WHERE octet_length(frame_data)=0 OR frame_sha256 IS NULL)::int AS invalid_frames,
             count(*) FILTER (WHERE unit<>'kgC/h')::int AS invalid_units,
             count(*)::int AS total_frames
           FROM website_data.carbon_emission_frames`);
  const vre = await query(`SELECT count(*)::int AS rows,
                  count(DISTINCT region_id)::int AS regions,
                  count(DISTINCT technology)::int AS technologies,
                  min(year)::int AS first_year,
                  max(year)::int AS last_year,
                  count(*) FILTER (WHERE hours=8784)::int AS leap_year_rows,
                  count(*) FILTER (WHERE hours NOT IN (8760,8784) OR jsonb_array_length(values_json)<>hours)::int AS invalid_rows
           FROM website_data.climate_vre_hourly`);
  const energyAssets = await query(`SELECT source, count(*)::int AS rows
           FROM website_data.energy_assets GROUP BY source ORDER BY rows DESC, source`);
  const renewablePotential = await query(`SELECT technology, count(*)::int AS rows,
                  min(source_year)::int AS first_year,
                  max(source_year)::int AS last_year
           FROM website_data.renewable_resource_potential
           GROUP BY technology ORDER BY technology`);
  const geoFeatures = await query(`SELECT dataset, count(*)::int AS rows
           FROM website_data.geo_features GROUP BY dataset ORDER BY rows DESC, dataset`);
  const vectorTiles = await query(`SELECT dataset, count(*)::int AS tiles, sum(octet_length(content))::bigint AS bytes
           FROM website_data.vector_tiles GROUP BY dataset ORDER BY tiles DESC, dataset`);
  const sourceFiles = await query(`SELECT dataset, count(*)::int AS files,
                  sum(size_bytes)::bigint AS registered_bytes,
                  sum(coalesce(record_count,0))::bigint AS registered_records,
                  array_agg(DISTINCT import_status ORDER BY import_status) AS statuses
           FROM website_data.source_files
           WHERE lower(path) ~ '(graced|vre_|gem-data|globalpowerplant|china-260517|cpvpd|14292571|chinapv|osm-power)'
              OR lower(dataset) ~ '(graced|vre|gem|wri|osm|photovoltaic|solar|光伏)'
           GROUP BY dataset ORDER BY dataset`);
  const selectedSourceFiles = await query(`SELECT path,dataset,size_bytes,import_status,record_count,
                  CASE WHEN sha256 IS NULL THEN false ELSE true END AS has_sha256
           FROM website_data.source_files
           WHERE dataset='power-source'
           ORDER BY path`);
  const catalog = await query(`SELECT dataset_key, earth_layer, name, provider, acquisition_status,
                  database_status, database_relation,
                  to_char(coverage_start,'YYYY-MM-DD') AS coverage_start,
                  to_char(coverage_end,'YYYY-MM-DD') AS coverage_end
           FROM website_data.dataset_catalog
           WHERE lower(dataset_key) ~ '(graced|vre|energy|osm|pv|solar|wind|power)'
              OR lower(name) ~ '(graced|vre|gem|wri|osm|photovoltaic|solar|光伏|能源设施)'
           ORDER BY earth_layer,dataset_key`);

  const output = {
    checkedAt: new Date().toISOString(),
    identity: identity[0],
    carbon,
    carbonIntegrity: carbonIntegrity[0],
    vre: vre[0],
    energyAssets,
    renewablePotential,
    geoFeatures,
    vectorTiles,
    sourceFiles,
    selectedSourceFiles,
    catalog,
  };
  const outputDirectory = path.join(path.dirname(repo), "outputs/20260904-pg-migration");
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "current-core-data-inventory.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  console.log(JSON.stringify(output, null, 2));
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}
