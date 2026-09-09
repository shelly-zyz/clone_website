#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  path.dirname(repo),
  "outputs/20260904-climate-model-selection/download-manifest.json",
);
const manifest = JSON.parse((await fs.readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
const officialFiles = new Map(
  manifest.files
    .filter((file) => file.filename.endsWith(".nc"))
    .map((file) => [file.filename, file]),
);

const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 120_000,
  statement_timeout: 120_000,
});

try {
  await client.connect();
  const sourceResult = await client.query(`
    SELECT s.file_name,s.gcm,s.scenario,s.variable,
           to_char(s.period_start,'YYYY-MM-DD') AS period_start,
           to_char(s.period_end,'YYYY-MM-DD') AS period_end,
           s.expected_size_bytes,s.md5,s.download_status,s.import_status,s.imported_days,
           count(d.source_id)::int AS frames,
           to_char(min(d.valid_date),'YYYY-MM-DD') AS first_date,
           to_char(max(d.valid_date),'YYYY-MM-DD') AS last_date,
           count(*) FILTER (
             WHERE d.source_id IS NOT NULL AND (
               d.frame_data IS NULL OR
               d.frame_sha256 !~ '^[0-9a-f]{64}$' OR
               d.hours<>24 OR d.point_count<>3848 OR
               d.data_type<>'float32' OR d.byte_order<>'little-endian' OR
               d.dimension_order<>'hour,location' OR d.compression<>'gzip'
             )
           )::int AS invalid_frames,
           count(DISTINCT d.grid_id)::int AS grids
    FROM website_data.climate_projection_sources s
    LEFT JOIN website_data.climate_projection_daily d ON d.source_id=s.id
    WHERE s.zenodo_record_id=20501729
    GROUP BY s.id ORDER BY s.variable,s.period_start
  `);
  const aggregateResult = await client.query(`
    SELECT count(*)::int AS frames,
           count(DISTINCT source_id)::int AS sources,
           count(DISTINCT grid_id)::int AS grids,
           count(DISTINCT variable)::int AS variables,
           to_char(min(valid_date),'YYYY-MM-DD') AS first_date,
           to_char(max(valid_date),'YYYY-MM-DD') AS last_date,
           count(*) FILTER (WHERE missing_count>0)::int AS frames_with_missing_values
    FROM website_data.climate_projection_daily
  `);
  const variableResult = await client.query(`
    SELECT variable,count(*)::int AS frames,
           to_char(min(valid_date),'YYYY-MM-DD') AS first_date,
           to_char(max(valid_date),'YYYY-MM-DD') AS last_date,
           min(unit) AS unit_min,max(unit) AS unit_max
    FROM website_data.climate_projection_daily
    GROUP BY variable ORDER BY variable
  `);
  const gridResult = await client.query(`
    SELECT count(*)::int AS grids,
           min(point_count)::int AS min_points,max(point_count)::int AS max_points,
           min(longitude_min) AS longitude_min,max(longitude_max) AS longitude_max,
           min(latitude_min) AS latitude_min,max(latitude_max) AS latitude_max,
           count(*) FILTER (WHERE coordinate_sha256 !~ '^[0-9a-f]{64}$' OR coordinate_data IS NULL)::int AS invalid_grids
    FROM website_data.climate_projection_grids
  `);

  const sources = sourceResult.rows.map((row) => {
    const official = officialFiles.get(row.file_name);
    const expectedDays =
      (Date.parse(`${row.period_end}T00:00:00Z`) - Date.parse(`${row.period_start}T00:00:00Z`)) /
        86_400_000 +
      1;
    const expectedMd5 = official?.checksum?.replace(/^md5:/, "");
    const checks = {
      officialManifestEntry: Boolean(official),
      officialSizeMatches: Number(row.expected_size_bytes) === Number(official?.bytes),
      officialMd5Matches: row.md5 === expectedMd5,
      verifiedAndImported:
        row.download_status === "verified" && row.import_status === "imported",
      exactDays:
        Number(row.imported_days) === expectedDays && Number(row.frames) === expectedDays,
      exactRange: row.first_date === row.period_start && row.last_date === row.period_end,
      validFrames: Number(row.invalid_frames) === 0,
      singleGrid: Number(row.grids) === 1,
    };
    return {
      fileName: row.file_name,
      variable: row.variable,
      period: [row.period_start, row.period_end],
      frames: Number(row.frames),
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  });

  const aggregate = aggregateResult.rows[0];
  const grid = gridResult.rows[0];
  const checks = {
    officialManifestHas20Files: officialFiles.size === 20,
    databaseHas20Sources: sources.length === 20,
    everySourcePassed: sources.every((source) => source.passed),
    exactTotalFrames: Number(aggregate.frames) === 73_050,
    exactSourceCount: Number(aggregate.sources) === 20,
    exactVariableCount: Number(aggregate.variables) === 5,
    exactDateRange:
      aggregate.first_date === "2021-01-01" && aggregate.last_date === "2060-12-31",
    singleValidGrid:
      Number(aggregate.grids) === 1 &&
      Number(grid.grids) === 1 &&
      Number(grid.min_points) === 3848 &&
      Number(grid.max_points) === 3848 &&
      Number(grid.invalid_grids) === 0,
  };

  const output = {
    checkedAt: new Date().toISOString(),
    passed: Object.values(checks).every(Boolean),
    checks,
    aggregate: {
      ...aggregate,
      frames: Number(aggregate.frames),
      sources: Number(aggregate.sources),
      grids: Number(aggregate.grids),
      variables: Number(aggregate.variables),
      frames_with_missing_values: Number(aggregate.frames_with_missing_values),
    },
    grid: {
      ...grid,
      grids: Number(grid.grids),
      min_points: Number(grid.min_points),
      max_points: Number(grid.max_points),
      invalid_grids: Number(grid.invalid_grids),
    },
    variables: variableResult.rows.map((row) => ({ ...row, frames: Number(row.frames) })),
    sources,
  };
  const outputPath = path.join(
    path.dirname(repo),
    "outputs/20260904-climate-model-selection/full-import-verification.json",
  );
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
  if (!output.passed) process.exitCode = 1;
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}
