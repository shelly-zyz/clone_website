import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envText = await fs.readFile(path.join(repo, ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
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

const scenarios = [
  ["ssp245", "https://doi.org/10.5281/zenodo.17437774", "VRE_gfdl-esm4_ssp245_2021_2060.mat", 5840992882, "aa988c4c114a57c9124d7bf4edbfaca1"],
  ["ssp370", "https://doi.org/10.5281/zenodo.15851824", "VRE_gfdl-esm4_ssp370_2021_2060.mat", 5813482821, "19c9d265a3ea4058ddc7e7b0a54fca40"],
  ["ssp585", "https://doi.org/10.5281/zenodo.15871433", "VRE_gfdl-esm4_ssp585_2021_2060.mat", 5843204918, "f56e56c836294511e98010284f073d53"],
];

await client.connect();
try {
  await client.query("BEGIN");
  for (const [scenario, sourceUrl, fileName, bytes, md5] of scenarios) {
    const key = `climate-vre-gfdl-${scenario}`;
    await client.query(
      `INSERT INTO website_data.dataset_catalog (
         dataset_key, earth_layer, name, provider, source_url, data_type,
         spatial_scope, temporal_resolution, coverage_start, coverage_end,
         access_method, auth_required, license, acquisition_status,
         database_status, database_relation, priority, notes, metadata
       ) VALUES ($1,'电力地球',$2,'Ruijie Chen et al.',$3,'hourly renewable generation scenario',
         '中国32区域','hourly','2021-01-01','2060-12-31','local verified MAT',false,'CC-BY-4.0',
         'downloaded','imported','website_data.climate_vre_hourly','high',
         'GFDL-ESM4 VRE 情景；数据库以 gcm + scenario + region_id + year + technology 唯一标识。',
         $4::jsonb)
       ON CONFLICT (dataset_key) DO UPDATE SET
         name=EXCLUDED.name, provider=EXCLUDED.provider, source_url=EXCLUDED.source_url,
         data_type=EXCLUDED.data_type, spatial_scope=EXCLUDED.spatial_scope,
         temporal_resolution=EXCLUDED.temporal_resolution, coverage_start=EXCLUDED.coverage_start,
         coverage_end=EXCLUDED.coverage_end, acquisition_status=EXCLUDED.acquisition_status,
         database_status=EXCLUDED.database_status, database_relation=EXCLUDED.database_relation,
         notes=EXCLUDED.notes, metadata=EXCLUDED.metadata, updated_at=now()`,
      [
        key,
        `2021—2060 GFDL-ESM4 ${scenario.toUpperCase()} 风光容量因子情景`,
        sourceUrl,
        JSON.stringify({ gcm: "gfdl-esm4", scenario, fileName, expectedSizeBytes: bytes, md5, rowCount: 2560, technology: ["wind", "solar"] }),
      ],
    );
  }
  await client.query("COMMIT");
  const result = await client.query(`
    SELECT dataset_key,database_status,database_relation,coverage_start::text,coverage_end::text
    FROM website_data.dataset_catalog
    WHERE dataset_key IN ('climate-vre-gfdl-ssp245','climate-vre-gfdl-ssp370','climate-vre-gfdl-ssp585')
    ORDER BY dataset_key
  `);
  console.log(JSON.stringify({ ok: true, rows: result.rows }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
