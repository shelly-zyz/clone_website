import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(repoRoot, ".env.local");
const env = await fs.readFile(envPath, "utf8");
for (const line of env.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator <= 0) continue;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  if (process.env[key] === undefined) process.env[key] = value;
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30_000,
});

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    ALTER TABLE website_data.climate_vre_hourly
      ADD COLUMN IF NOT EXISTS gcm text,
      ADD COLUMN IF NOT EXISTS scenario text;
    UPDATE website_data.climate_vre_hourly
    SET gcm = COALESCE(NULLIF(gcm, ''), NULLIF(metadata->>'gcm', ''), 'gfdl-esm4'),
        scenario = COALESCE(NULLIF(scenario, ''), NULLIF(metadata->>'scenario', ''), 'ssp126')
    WHERE gcm IS NULL OR scenario IS NULL OR gcm = '' OR scenario = '';
    ALTER TABLE website_data.climate_vre_hourly
      ALTER COLUMN gcm SET NOT NULL,
      ALTER COLUMN scenario SET NOT NULL;
  `);

  const primaryKey = await client.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid='website_data.climate_vre_hourly'::regclass AND contype='p'
  `);
  if (primaryKey.rows[0] && primaryKey.rows[0].conname !== "climate_vre_hourly_model_scenario_pkey") {
    await client.query(`ALTER TABLE website_data.climate_vre_hourly DROP CONSTRAINT ${JSON.stringify(primaryKey.rows[0].conname).slice(1, -1)}`);
  }
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='website_data.climate_vre_hourly'::regclass
          AND conname='climate_vre_hourly_model_scenario_pkey'
      ) THEN
        ALTER TABLE website_data.climate_vre_hourly
          ADD CONSTRAINT climate_vre_hourly_model_scenario_pkey
          PRIMARY KEY (gcm, scenario, region_id, year, technology);
      END IF;
    END
    $$;
    CREATE INDEX IF NOT EXISTS climate_vre_hourly_model_scenario_idx
      ON website_data.climate_vre_hourly (gcm, scenario, year, technology);
    CREATE TABLE IF NOT EXISTS website_data.climate_vre_sources (
      gcm text NOT NULL,
      scenario text NOT NULL,
      file_name text NOT NULL UNIQUE,
      source_path text NOT NULL,
      expected_size_bytes bigint NOT NULL,
      md5 text NOT NULL,
      period_start date NOT NULL,
      period_end date NOT NULL,
      download_status text NOT NULL DEFAULT 'verified',
      import_status text NOT NULL DEFAULT 'pending',
      imported_rows integer NOT NULL DEFAULT 0,
      source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
      error text,
      imported_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (gcm, scenario)
    );
  `);
  await client.query("COMMIT");
  const result = await client.query(`
    SELECT gcm, scenario, count(*)::int AS rows,
           count(DISTINCT region_id)::int AS regions,
           min(year)::int AS first_year, max(year)::int AS last_year
    FROM website_data.climate_vre_hourly
    GROUP BY gcm, scenario ORDER BY gcm, scenario
  `);
  console.log(JSON.stringify({ ok: true, dimensions: result.rows }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
