import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const defaultArchive = new URL("../public/data/weather-replay/us-southeast-2026-09-26-db39d036.json", import.meta.url);
const migration = new URL("./v11-weather-replay-payload.sql", import.meta.url);

async function withDatabase(variable, run) {
  const connectionString = process.env[variable]?.trim();
  if (!connectionString) throw new Error(`Missing ${variable}`);
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15_000,
  });
  try {
    await client.connect();
    const result = await client.query("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "zyz") throw new Error("Expected the zyz database");
    return await run(client);
  } finally {
    await client.end();
  }
}

async function backfill(client, archives) {
  const stored = [];
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE green_agent_ingest; SET LOCAL search_path = pg_catalog");
    for (const path of archives) {
      const body = await readFile(path);
      if (!body.length || body.length > 2_000_000) throw new Error("Invalid replay archive size");
      const { id } = JSON.parse(body.toString("utf8"));
      if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error("Invalid replay archive ID");
      const sha256 = createHash("sha256").update(body).digest("hex");
      const registered = await client.query(`SELECT version
        FROM catalog.published_weather_replay WHERE id=$1 AND sha256=$2 AND size_bytes=$3`,
      [id, sha256, body.length]);
      if (!registered.rowCount) throw new Error(`Archive does not match a published replay: ${id}`);
      await client.query(`INSERT INTO catalog.weather_replay_payload (sha256, body)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sha256, body]);
      const result = await client.query(`SELECT version FROM catalog.published_weather_replay_payload
        WHERE id=$1 AND sha256=$2 AND body=$3`, [id, sha256, body]);
      if (result.rowCount !== registered.rowCount) throw new Error(`Stored bytes did not verify: ${id}`);
      stored.push({ id, sha256, bytes: body.length, versions: result.rows.map(row => row.version) });
    }
    await client.query("COMMIT");
    return stored;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

try {
  const args = process.argv.slice(2);
  const applyMigration = args[0] === "--migrate";
  const paths = applyMigration ? args.slice(1) : args;
  if (paths.some(path => path.startsWith("--"))) throw new Error("Usage: backfill-weather-replay.mjs [--migrate] [archive.json ...]");
  if (!process.env.DATA_AGENT_INGEST_DATABASE_URL?.trim()) throw new Error("Missing DATA_AGENT_INGEST_DATABASE_URL");
  if (applyMigration) {
    const sql = await readFile(migration, "utf8");
    await withDatabase("WEATHER_REPLAY_MIGRATION_DATABASE_URL", client => client.query(sql));
  }
  const stored = await withDatabase("DATA_AGENT_INGEST_DATABASE_URL", client =>
    backfill(client, paths.length ? paths : [defaultArchive]));
  console.log(JSON.stringify(stored, null, 2));
} catch (error) {
  // PostgreSQL errors can contain connection or row details.
  const detail = typeof error?.code === "string" ? `(${error.code})`
    : error instanceof SyntaxError ? "invalid archive JSON"
    : error instanceof Error && /^(Missing |Expected |Invalid |Archive does |Stored bytes |Usage:)/.test(error.message)
      ? error.message : "database connection or write failed";
  console.error("Weather replay backfill failed: " + detail);
  process.exitCode = 1;
}
