#!/usr/bin/env node

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      s.file_name,
      s.gcm,
      s.scenario,
      s.variable AS source_variable,
      s.download_status,
      s.import_status,
      s.imported_days,
      s.md5 AS source_md5,
      s.expected_size_bytes,
      to_char(d.valid_date, 'YYYY-MM-DD') AS valid_date,
      d.variable,
      d.unit,
      d.hours,
      d.point_count,
      d.missing_count,
      d.data_type,
      d.byte_order,
      d.dimension_order,
      d.compression,
      d.frame_sha256,
      d.frame_data,
      g.grid_hash,
      g.coordinate_sha256,
      g.point_count AS grid_point_count,
      g.longitude_min,
      g.longitude_max,
      g.latitude_min,
      g.latitude_max
    FROM website_data.climate_projection_sources s
    JOIN website_data.climate_projection_daily d ON d.source_id = s.id
    JOIN website_data.climate_projection_grids g ON g.id = d.grid_id
    WHERE s.file_name = 'gfdl-esm4_ssp126_rsds_2021_2030.nc'
    ORDER BY d.valid_date
  `);

  if (result.rowCount !== 1) {
    throw new Error(`Expected exactly one canary frame; found ${result.rowCount}.`);
  }

  const row = result.rows[0];
  const compressed = row.frame_data;
  const frameSha256Actual = createHash("sha256").update(compressed).digest("hex");
  const uncompressed = gunzipSync(compressed);
  const expectedUncompressedBytes = Number(row.hours) * Number(row.point_count) * 4;
  const checks = {
    exactCanaryRow: result.rowCount === 1,
    expectedDate: row.valid_date === "2021-01-01",
    expectedModel: row.gcm.toLowerCase() === "gfdl-esm4",
    expectedScenario: row.scenario.toLowerCase() === "ssp126",
    sourceAndFrameVariableMatch: row.source_variable === row.variable,
    sourceVerified: row.download_status === "verified",
    sourcePartialOneDay: row.import_status === "partial" && Number(row.imported_days) === 1,
    expectedHours: Number(row.hours) === 24,
    gridAndFramePointCountsMatch:
      Number(row.grid_point_count) === Number(row.point_count),
    frameHashMatches: frameSha256Actual === row.frame_sha256,
    payloadSizeMatchesShape: uncompressed.length === expectedUncompressedBytes,
    supportedEncoding:
      row.data_type === "float32" &&
      row.byte_order === "little-endian" &&
      row.dimension_order === "hour,location" &&
      row.compression === "gzip",
  };

  const output = {
    checkedAt: new Date().toISOString(),
    passed: Object.values(checks).every(Boolean),
    checks,
    source: {
      fileName: row.file_name,
      model: row.gcm,
      scenario: row.scenario,
      variable: row.variable,
      sourceMd5: row.source_md5,
      expectedSizeBytes: Number(row.expected_size_bytes),
      downloadStatus: row.download_status,
      importStatus: row.import_status,
      importedDays: Number(row.imported_days),
    },
    frame: {
      validDate: row.valid_date,
      unit: row.unit,
      hours: Number(row.hours),
      pointCount: Number(row.point_count),
      missingCount: Number(row.missing_count),
      compressedBytes: compressed.length,
      uncompressedBytes: uncompressed.length,
      expectedUncompressedBytes,
      frameSha256: row.frame_sha256,
    },
    grid: {
      gridHash: row.grid_hash,
      coordinateSha256: row.coordinate_sha256,
      pointCount: Number(row.grid_point_count),
      longitudeRange: [row.longitude_min, row.longitude_max],
      latitudeRange: [row.latitude_min, row.latitude_max],
    },
  };

  console.log(JSON.stringify(output, null, 2));
  if (!output.passed) process.exitCode = 1;
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}
