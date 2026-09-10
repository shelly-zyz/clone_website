#!/usr/bin/env node

import process from "node:process";

import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
  application_name: "hill-of-towie-preflight",
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      inet_server_addr()::text AS server_address,
      current_setting('server_version') AS server_version,
      pg_database_size(current_database())::bigint AS database_size_bytes,
      pg_size_pretty(pg_database_size(current_database())) AS database_size,
      has_schema_privilege(current_user, 'website_data', 'USAGE') AS website_data_usage,
      has_schema_privilege(current_user, 'website_data', 'CREATE') AS website_data_create,
      to_regclass('website_data.forecast_scada_sources')::text AS existing_source_table,
      to_regclass('website_data.forecast_scada_observations')::text AS existing_observation_table
  `);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result.rows[0] }, null, 2));
} finally {
  await client.end();
}
