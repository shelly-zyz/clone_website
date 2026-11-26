import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  file: { type: "string" }, start: { type: "string" }, end: { type: "string" }, "dry-run": { type: "boolean" },
} });
if (!values.file || !values.start || !values.end) {
  throw new Error("Usage: node scripts/import-era5-history.mjs --file <JSON> --start YYYY-MM-DD --end YYYY-MM-DD [--dry-run]");
}

function utcDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use ISO dates for the requested coverage.");
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid coverage date.");
  return date.getTime();
}
const hour = 3_600_000;
const first = utcDay(values.start);
const count = (utcDay(values.end) - first) / hour + 24;
if (count < 24) throw new Error("Coverage dates are reversed.");

const requested = { latitude: 31.22222, longitude: 121.45806 };
const names = ["temperature_2m", "wind_speed_10m", "precipitation"];
const raw = readFileSync(values.file);
const sample = JSON.parse(raw);
if (!["UTC", "GMT"].includes(sample.timezone) || sample.utc_offset_seconds !== 0 ||
  !Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude) ||
  Math.abs(sample.latitude - requested.latitude) > 0.25 || Math.abs(sample.longitude - requested.longitude) > 0.25) {
  throw new Error("Expected a UTC ERA5 response for the Shanghai grid.");
}
const units = { time: "iso8601", temperature_2m: "°C", wind_speed_10m: "m/s", precipitation: "mm" };
for (const [field, unit] of Object.entries(units)) {
  if (sample.hourly_units?.[field] !== unit || !Array.isArray(sample.hourly?.[field]) || sample.hourly[field].length !== count) {
    throw new Error(`Unexpected unit or number of hours for ${field}.`);
  }
}
const hours = sample.hourly.time.map((time, index) => {
  const iso = new Date(first + index * hour).toISOString().slice(0, 16);
  if (time !== iso) throw new Error(`Expected consecutive UTC hours. First mismatch at row ${index + 1}.`);
  const readings = names.map(name => {
    const value = sample.hourly[name][index];
    if (value !== null && (!Number.isFinite(value) || (name !== "temperature_2m" && value < 0))) {
      throw new Error(`Invalid ${name} at ${iso} UTC.`);
    }
    return value;
  });
  return { time: iso + ":00Z", readings };
});
if (names.some((_, index) => hours.every(row => row.readings[index] === null))) throw new Error("A requested variable is wholly missing.");

const request = new URL("https://archive-api.open-meteo.com/v1/archive");
request.search = new URLSearchParams({
  latitude: String(requested.latitude), longitude: String(requested.longitude),
  start_date: values.start, end_date: values.end, hourly: names.join(","),
  models: "era5", wind_speed_unit: "ms", timezone: "UTC",
}).toString();
const manifest = {
  url: request.href,
  requested_latitude: requested.latitude, requested_longitude: requested.longitude,
  grid_latitude: sample.latitude, grid_longitude: sample.longitude,
  first: hours[0].time, last: hours.at(-1).time, count,
};
// Supply data as encoded SQL literals; the migration itself is static.
const bytes = value => `decode('${value.toString("hex")}','hex')`;
const json = value => `convert_from(${bytes(Buffer.from(JSON.stringify(value)))},'UTF8')::jsonb`;
const publication = readFileSync(new URL("./v11-era5-history.sql", import.meta.url), "utf8");
process.stdout.write(`BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL timezone = 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE green_ddl;
CREATE TEMP TABLE era5_import ON COMMIT DROP AS
SELECT ${bytes(raw)} AS payload, ${json(manifest)} AS manifest, ${json(hours)} AS hours;
${publication}
${values["dry-run"] ? "ROLLBACK" : "COMMIT"};
`);
