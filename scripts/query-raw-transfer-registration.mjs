#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 15_000,
  application_name: "raw-transfer-registration-audit",
});

try {
  await client.connect();
  const assets = (
    await client.query(`
      SELECT count(*)::int files,coalesce(sum(size_bytes),0)::bigint bytes,
             count(*) FILTER (WHERE storage_status='planned')::int planned,
             count(*) FILTER (WHERE storage_status='verified')::int verified
      FROM website_data.raw_file_assets
    `)
  ).rows[0];
  const sessions = (
    await client.query(`
      SELECT pid,application_name,state,wait_event_type,wait_event,
             age(clock_timestamp(),query_start)::text query_age,
             left(regexp_replace(query,E'[\\n\\r\\t]+',' ','g'),160) query
      FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid()
      ORDER BY query_start
    `)
  ).rows;
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), assets, sessions }, null, 2));
} finally {
  await client.end();
}
