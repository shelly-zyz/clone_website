#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const pid = Number(process.argv[2]);
if (!Number.isInteger(pid) || pid <= 0) throw new Error("A positive backend PID is required.");

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repo, ".env.local"), quiet: true });
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 15_000,
  application_name: "raw-transfer-registration-cleanup",
});

try {
  await client.connect();
  const session = (
    await client.query(
      `SELECT pid,usename,state,left(regexp_replace(query,E'[\\n\\r\\t]+',' ','g'),200) query
       FROM pg_stat_activity WHERE pid=$1 AND datname=current_database()`,
      [pid],
    )
  ).rows[0];
  if (
    !session ||
    session.usename !== "zyz" ||
    session.state !== "idle in transaction" ||
    !session.query.includes("INSERT INTO website_data.raw_file_assets")
  ) {
    throw new Error(`Refusing to terminate an unverified session: ${JSON.stringify(session)}`);
  }
  const terminated = (await client.query("SELECT pg_terminate_backend($1) terminated", [pid])).rows[0]
    .terminated;
  console.log(JSON.stringify({ pid, terminated, verifiedSession: session }, null, 2));
} finally {
  await client.end();
}
