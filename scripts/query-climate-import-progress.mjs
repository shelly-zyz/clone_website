#!/usr/bin/env node

import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const client = new pg.Client({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
  connectionTimeoutMillis: 8_000,
  query_timeout: 15_000,
  statement_timeout: 15_000,
});

try {
  await client.connect();
  const sourceResult = await client.query(`
      SELECT s.file_name,
             s.variable,
             s.import_status,
             count(d.valid_date)::int AS frames,
             ((s.period_end - s.period_start) + 1)::int AS expected_days,
             max(d.valid_date) AS max_date
      FROM website_data.climate_projection_sources s
      LEFT JOIN website_data.climate_projection_daily d ON d.source_id=s.id
      GROUP BY s.id, s.file_name, s.variable, s.import_status,
               s.period_start, s.period_end
      ORDER BY s.variable, s.period_start
    `);
  const sizeResult = await client.query(
    "SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size",
  );
  const frames = sourceResult.rows.reduce(
    (sum, source) => sum + Number(source.frames),
    0,
  );
  const statuses = ["imported", "importing", "pending", "failed"];
  const files = Object.fromEntries(
    statuses.map((status) => [
      status === "imported" ? "completed" : status,
      sourceResult.rows.filter((source) => source.import_status === status).length,
    ]),
  );

  console.log(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      expectedFrames: 73_050,
      frames,
      percent: Math.round((frames / 73_050) * 1_000) / 10,
      database_size: sizeResult.rows[0].database_size,
      files,
      active: sourceResult.rows.filter((source) =>
        ["importing", "failed"].includes(source.import_status),
      ),
    }),
  );
} finally {
  await Promise.race([
    client.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  client.connection?.stream?.destroy();
}
