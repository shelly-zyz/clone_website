import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import pg from "pg";
import { z } from "zod";
import { weatherFileOutputSchema, weatherImportSchema } from "../src/lib/weather-model-forecast.ts";

const readerPath = fileURLToPath(new URL("read-weather-forecast.py", import.meta.url));
const run = promisify(execFile);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" }, manifest: { type: "string" }, reader: { type: "string" },
    "cdo-crop": { type: "boolean" }, "grid-step": { type: "string" },
    batch: { type: "string" }, decision: { type: "string" }, note: { type: "string" },
  },
});

async function transaction(role, connectionString, execute) {
  if (!connectionString?.trim()) throw new Error("Missing the database URL for this operation.");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(role === "ingest" ? "SET LOCAL ROLE green_agent_ingest" : "SET LOCAL ROLE green_agent_review");
    await client.query("SET LOCAL search_path = pg_catalog; SET LOCAL statement_timeout = '20s'");
    const value = await execute(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function extract() {
  if (!values.file || !values.manifest) throw new Error("--file and --manifest are required.");
  const manifest = weatherImportSchema.parse(JSON.parse(await readFile(values.manifest, "utf8")));
  const reader = z.enum(["netcdf4", "iris", "pygrib", "earthkit-data"]).parse(values.reader ??
    (manifest.model === "wrf" ? "netcdf4" : "iris"));
  if (reader === "netcdf4" && manifest.model !== "wrf") throw new Error("Native wrfout requires the WRF model.");
  const options = ["--reader", reader, "--issue", manifest.issue_time, "--bounds", ...manifest.bounds.map(String)];
  if (values["cdo-crop"]) options.push("--cdo-crop");
  if (values["grid-step"] !== undefined) {
    const step = z.coerce.number().positive().max(180).parse(values["grid-step"]);
    options.push("--grid-step", String(step));
  }
  const { stdout } = await run(process.env.OGW_WEATHER_PYTHON?.trim() || "python3",
    [readerPath, ...options, "--", values.file], { maxBuffer: 1024 * 1024, timeout: 300_000 });
  const result = weatherFileOutputSchema.parse(JSON.parse(stdout));
  const version = createHash("sha256").update(JSON.stringify({ manifest, ...result })).digest("hex");
  return { manifest, version, ...result };
}

async function main() {
  if (positionals.length !== 1) throw new Error("Use inspect, stage, or review. See docs/weather-model-forecast.md.");
  if (positionals[0] === "review") {
    const batch = z.uuid().parse(values.batch);
    const publish = z.enum(["publish", "reject"]).parse(values.decision) === "publish";
    const note = z.string().trim().min(1).max(500).parse(values.note);
    return transaction("review", process.env.DATA_AGENT_REVIEW_DATABASE_URL, async client => {
      const { rows } = await client.query("SELECT catalog.review_weather_model_batch($1, $2, $3) AS status", [batch, publish, note]);
      return { id: batch, ...rows[0] };
    });
  }
  if (!["inspect", "stage"].includes(positionals[0])) throw new Error("Expected inspect, stage, or review.");
  const { manifest, version, file_sha256, file_metadata, points } = await extract();
  if (positionals[0] === "inspect") return { manifest, version, file_sha256, file_metadata };
  return transaction("ingest", process.env.DATA_AGENT_INGEST_DATABASE_URL, async client => {
    const entry = await client.query(`INSERT INTO staging.weather_model_batch
      (version, model, model_version, region_code, region_name, bounds, issue_time, source_uri, file_sha256, file_metadata, points)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11::jsonb)
      ON CONFLICT (version) DO NOTHING RETURNING id, status`,
    [version, manifest.model, manifest.model_version, manifest.region_code, manifest.region_name, JSON.stringify(manifest.bounds),
      manifest.issue_time, manifest.source_uri, file_sha256, JSON.stringify(file_metadata), JSON.stringify(points)]);
    const row = entry.rows[0] ?? (await client.query(
      "SELECT id, status FROM staging.weather_model_batch WHERE version = $1", [version])).rows[0];
    return { ...row, version, file_metadata };
  });
}

main().then(value => console.log(JSON.stringify(value))).catch(error => {
  const detail = error.stderr?.trim().split("\n").at(-1) || error.message;
  console.error(detail);
  process.exitCode = 1;
});
