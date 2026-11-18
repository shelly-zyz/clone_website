import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { csvParse } from "d3-dsv";
import pg from "pg";

const base = "https://sdmx.oecd.org/public/rest/data/OECD.STI.PIE,";
const edition = "2025";
const tradeFlow = "DSD_ICIO_GHG_TRADE_2025@DF_ICIO_GHG_TRADE_2025";
const mainFlow = "DSD_ICIO_GHG_MAIN_2025@DF_ICIO_GHG_MAIN_2025";
const range = "?startPeriod=1995&endPeriod=2022&format=csvfile";
const tradeUrl = base + tradeFlow + ",1.0/A.TRADE_GHG..._T.TTL.T_CO2E" + range;
const mainUrl = base + mainFlow + ",1.0/A.PROD_GHG+FD_GHG.._T.T_CO2E" + range;
const areas = new Set("AGO ARE ARG AUS AUT BEL BGD BGR BLR BRA BRN CAN CHE CHL CHN CIV CMR COD COL CRI CYP CZE DEU DNK EGY ESP EST FIN FRA GBR GRC HKG HRV HUN IDN IND IRL ISL ISR ITA JOR JPN KAZ KHM KOR LAO LTU LUX LVA MAR MEX MLT MMR MYS NGA NLD NOR NZL PAK PER PHL POL PRT ROU RUS SAU SEN SGP STP SVK SVN SWE THA TUN TUR TWN UKR USA VNM WXD ZAF".split(" "));
const years = Array.from({ length: 28 }, (_, index) => index + 1995);
const [tradePath, mainPath] = process.argv.slice(2);
const connectionString = process.env.CARBON_TRADE_IMPORT_DATABASE_URL;
if (!connectionString || process.argv.length > 4 || Boolean(tradePath) !== Boolean(mainPath)) {
  throw new Error("Set CARBON_TRADE_IMPORT_DATABASE_URL and pass both OECD SDMX CSV paths, or omit both to download from OECD.");
}

async function readCsv(path, url) {
  if (path) return readFile(path, "utf8");
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`OECD returned HTTP ${response.status} for ${url}`);
  return response.text();
}

function observation(row) {
  const year = Number(row.TIME_PERIOD);
  const amount = Number(row.OBS_VALUE);
  if (!years.includes(year) || row.FREQ !== "A" || row.ACTIVITY !== "_T" || row.UNIT_MEASURE !== "T_CO2E"
    || row.UNIT_MULT !== "6" || !row.OBS_VALUE?.trim() || !Number.isFinite(amount) || amount < 0) {
    throw new Error("Unexpected OECD observation or unit. Expected annual all-activity values in Mt CO2e.");
  }
  return { year, amount };
}

const [tradeCsv, mainCsv] = await Promise.all([readCsv(tradePath, tradeUrl), readCsv(mainPath, mainUrl)]);
const revision = createHash("sha256").update(tradeCsv).update("\0").update(mainCsv).digest("hex");
const bilateral = new Map();
for (const row of csvParse(tradeCsv)) {
  if (row.MEASURE !== "TRADE_GHG" || row.PRODUCT_CATEGORY !== "TTL") continue;
  if (!areas.has(row.EXPORTER) || !areas.has(row.IMPORTER) || row.EXPORTER === row.IMPORTER) continue;
  const { year, amount } = observation(row);
  const key = [year, row.EXPORTER, row.IMPORTER].join(":");
  if (bilateral.has(key)) throw new Error(`Duplicate OECD trade observation: ${key}`);
  bilateral.set(key, { year, exporter: row.EXPORTER, importer: row.IMPORTER, mt: amount });
}
const footprints = new Map();
for (const row of csvParse(mainCsv)) {
  if (row.MEASURE !== "PROD_GHG" && row.MEASURE !== "FD_GHG") continue;
  if (!areas.has(row.REF_AREA) && row.REF_AREA !== "W") continue;
  const { year, amount } = observation(row);
  const key = [year, row.REF_AREA, row.MEASURE].join(":");
  if (footprints.has(key)) throw new Error(`Duplicate OECD footprint observation: ${key}`);
  footprints.set(key, { year, economy: row.REF_AREA, measure: row.MEASURE, mt: amount });
}
if (bilateral.size !== years.length * areas.size * (areas.size - 1)
  || footprints.size !== years.length * (areas.size + 1) * 2) {
  throw new Error(`Incomplete OECD coverage: ${bilateral.size} bilateral and ${footprints.size} footprint records.`);
}

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(603197212)");
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS carbon_trade;
    CREATE TABLE IF NOT EXISTS carbon_trade.release (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      edition text NOT NULL, revision text NOT NULL, trade_url text NOT NULL, footprint_url text NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS carbon_trade.bilateral (
      year smallint NOT NULL, exporter text NOT NULL, importer text NOT NULL CHECK (importer <> exporter),
      mt double precision NOT NULL CHECK (mt >= 0), PRIMARY KEY (year, exporter, importer)
    );
    CREATE TABLE IF NOT EXISTS carbon_trade.footprint (
      year smallint NOT NULL, economy text NOT NULL, measure text NOT NULL CHECK (measure IN ('PROD_GHG', 'FD_GHG')),
      mt double precision NOT NULL CHECK (mt >= 0), PRIMARY KEY (year, economy, measure)
    )
  `);
  await client.query("DELETE FROM carbon_trade.bilateral");
  await client.query("DELETE FROM carbon_trade.footprint");
  const rows = [...bilateral.values()];
  for (let index = 0; index < rows.length; index += 10_000) {
    await client.query(`
      INSERT INTO carbon_trade.bilateral (year, exporter, importer, mt)
      SELECT year, exporter, importer, mt
      FROM jsonb_to_recordset($1::jsonb) AS input(year smallint, exporter text, importer text, mt double precision)
    `, [JSON.stringify(rows.slice(index, index + 10_000))]);
  }
  await client.query(`
    INSERT INTO carbon_trade.footprint (year, economy, measure, mt)
    SELECT year, economy, measure, mt
    FROM jsonb_to_recordset($1::jsonb) AS input(year smallint, economy text, measure text, mt double precision)
  `, [JSON.stringify([...footprints.values()])]);
  await client.query(`
    INSERT INTO carbon_trade.release (edition, revision, trade_url, footprint_url) VALUES ($1, $2, $3, $4)
    ON CONFLICT (singleton) DO UPDATE SET edition = EXCLUDED.edition, revision = EXCLUDED.revision,
      trade_url = EXCLUDED.trade_url, footprint_url = EXCLUDED.footprint_url, imported_at = CURRENT_TIMESTAMP
  `, [edition, revision, tradeUrl, mainUrl]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ edition, revision, years: [years[0], years.at(-1)], trade: bilateral.size, footprints: footprints.size }));
} finally {
  await client.end();
}
