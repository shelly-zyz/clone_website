#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(
  path.dirname(repo),
  "outputs/20260904-climate-model-selection",
);
dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

const verification = JSON.parse(
  await fs.readFile(path.join(outputDirectory, "full-import-verification.json"), "utf8"),
);
if (!verification.passed || verification.aggregate?.frames !== 73_050) {
  throw new Error("Full import verification evidence is absent or failed.");
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
});

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('opengridworks-climate-finalize'))");
  const live = (
    await client.query(`
      SELECT count(*)::int AS sources,
             sum(imported_days)::int AS frames,
             count(*) FILTER (WHERE import_status='imported')::int AS imported,
             count(*) FILTER (WHERE download_status='verified')::int AS verified,
             count(*) FILTER (WHERE error IS NOT NULL)::int AS errors
      FROM website_data.climate_projection_sources
      WHERE zenodo_record_id=20501729
    `)
  ).rows[0];
  if (
    Number(live.sources) !== 20 ||
    Number(live.frames) !== 73_050 ||
    Number(live.imported) !== 20 ||
    Number(live.verified) !== 20 ||
    Number(live.errors) !== 0
  ) {
    throw new Error(`Live climate state is not final: ${JSON.stringify(live)}`);
  }
  const result = await client.query(`
    UPDATE website_data.dataset_catalog
    SET database_status='imported',
        notes='服务器20个NetCDF已完成大小与官方MD5校验；当前新PG已导入73,050个日帧并完成逐文件日期、日数、网格和帧格式终验。属于长期模型情景，不是观测或天气预报。',
        metadata=metadata || $1::jsonb,
        updated_at=now()
    WHERE dataset_key='zenodo-gfdl-esm4-ssp126-hourly-climate'
    RETURNING dataset_key,database_status,updated_at
  `, [JSON.stringify({
    importedSources: 20,
    importedDailyFrames: 73_050,
    verificationCheckedAt: verification.checkedAt,
    originalsPreservedOnServer: true,
  })]);
  if (result.rowCount !== 1) throw new Error("Climate catalog row was not found.");
  await client.query("COMMIT");
  const output = { finalized: true, live, catalog: result.rows[0] };
  await fs.writeFile(
    path.join(outputDirectory, "catalog-finalization.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}
