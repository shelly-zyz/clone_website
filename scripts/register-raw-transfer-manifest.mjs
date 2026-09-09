#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(path.dirname(repo), "outputs/20260908-raw-archive-transfer");
const manifest = JSON.parse(
  await fs.readFile(path.join(outputDirectory, "raw-transfer-manifest.json"), "utf8"),
);
dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
if (
  manifest.targetRoot !== "D:/energy-platform-data/raw" ||
  manifest.totals.files !== manifest.items.length ||
  manifest.totals.missingHashes !== 0 ||
  manifest.totals.sizeMismatches !== 0 ||
  manifest.totals.duplicateTargets !== 0
) {
  throw new Error("Transfer manifest has not passed local validation.");
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 300_000,
  statement_timeout: 300_000,
  application_name: "raw-transfer-registration",
});
const batch = `raw-transfer-${manifest.generatedAt.replaceAll(/[^0-9TZ]/g, "")}`;

try {
  await client.connect();
  const table = (
    await client.query("SELECT to_regclass('website_data.raw_file_assets')::text relation")
  ).rows[0].relation;
  if (table !== "website_data.raw_file_assets") throw new Error("Raw asset table is absent.");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('opengridworks-raw-transfer-register'))");
  const records = manifest.items.map((item) => {
    if (
      !item.serverPath.startsWith(`${manifest.targetRoot}/`) ||
      !/^[0-9a-f]{64}$/i.test(item.sha256) ||
      item.sizeBytes < 0
    ) {
      throw new Error(`Untrusted manifest item: ${item.assetKey}`);
    }
    return {
      asset_key: item.assetKey,
      earth_layer: item.earthLayer,
      dataset_group: item.group,
      source_name: item.sourceName,
      source_url: item.sourceUrl,
      local_source_path: item.localRelativePath,
      server_path: item.serverPath.replaceAll("/", "\\"),
      file_name: item.fileName,
      media_type: item.mediaType,
      size_bytes: item.sizeBytes,
      sha256: item.sha256.toLowerCase(),
      database_relations: item.databaseRelations,
      truth_status: item.truthStatus,
      compatible_earths: item.compatibleEarths ?? [],
    };
  });
  await client.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
           asset_key text,earth_layer text,dataset_group text,source_name text,source_url text,
           local_source_path text,server_path text,file_name text,media_type text,size_bytes bigint,
           sha256 text,database_relations text[],truth_status text,compatible_earths text[]
         )
       )
       INSERT INTO website_data.raw_file_assets (
         asset_key,transfer_batch,earth_layer,dataset_group,source_name,source_url,
         local_source_path,server_path,file_name,media_type,size_bytes,sha256,
         storage_status,database_relations,truth_status,compatible_earths,metadata
       )
       SELECT asset_key,$1,earth_layer,dataset_group,source_name,source_url,
              local_source_path,server_path,file_name,media_type,size_bytes,sha256,
              'planned',database_relations,truth_status,compatible_earths,
              jsonb_build_object('sourceComputer',$3::text,'copyOnly',true)
       FROM incoming
       ON CONFLICT (asset_key) DO UPDATE SET
         transfer_batch=EXCLUDED.transfer_batch,
         source_name=EXCLUDED.source_name,source_url=EXCLUDED.source_url,
         local_source_path=EXCLUDED.local_source_path,
         server_path=EXCLUDED.server_path,file_name=EXCLUDED.file_name,
         media_type=EXCLUDED.media_type,size_bytes=EXCLUDED.size_bytes,
         sha256=EXCLUDED.sha256,database_relations=EXCLUDED.database_relations,
         truth_status=EXCLUDED.truth_status,compatible_earths=EXCLUDED.compatible_earths,
         storage_status=CASE
           WHEN website_data.raw_file_assets.storage_status='verified'
            AND website_data.raw_file_assets.size_bytes=EXCLUDED.size_bytes
            AND website_data.raw_file_assets.sha256=EXCLUDED.sha256
           THEN 'verified' ELSE 'planned' END,
         error=NULL,metadata=website_data.raw_file_assets.metadata||EXCLUDED.metadata,
         updated_at=now()`,
      [batch, JSON.stringify(records), manifest.sourceComputer],
    );
  const counts = (
    await client.query(
      `SELECT count(*)::int AS files,sum(size_bytes)::bigint AS bytes,
              count(*) FILTER (WHERE storage_status='planned')::int AS planned,
              count(*) FILTER (WHERE storage_status='verified')::int AS verified,
              count(*) FILTER (WHERE sha256 !~ '^[0-9a-f]{64}$')::int AS invalid_hashes
       FROM website_data.raw_file_assets WHERE transfer_batch=$1`,
      [batch],
    )
  ).rows[0];
  if (
    Number(counts.files) !== manifest.totals.files ||
    Number(counts.bytes) !== manifest.totals.bytes ||
    Number(counts.invalid_hashes) !== 0
  ) {
    throw new Error(`Registered totals differ: ${JSON.stringify(counts)}`);
  }
  await client.query("COMMIT");
  const result = { registeredAt: new Date().toISOString(), batch, counts };
  await fs.writeFile(
    path.join(outputDirectory, "raw-transfer-registration.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
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
