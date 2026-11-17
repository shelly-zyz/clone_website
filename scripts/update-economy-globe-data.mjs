import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const api = "https://api.worldbank.org/v2/";
const indicators = ["NY.GDP.MKTP.CD", "NY.GDP.PCAP.CD", "NE.EXP.GNFS.CD"];
const years = Array.from({ length: 10 }, (_, index) => 2015 + index);
const publicRoot = new URL("../public/", import.meta.url);
const run = promisify(execFile);

async function readApi(path, params) {
  const url = new URL(path, api);
  url.search = new URLSearchParams({ format: "json", per_page: "5000", ...params }).toString();
  const { stdout } = await run("curl", ["-fsSL", "--connect-timeout", "8", "--max-time", "25", "--retry", "2", url.href],
    { maxBuffer: 4 * 1024 * 1024 });
  const payload = JSON.parse(stdout);
  if (!Array.isArray(payload) || payload[0]?.pages !== 1 || !Array.isArray(payload[1]) || payload[1].length !== payload[0].total) {
    throw new Error(`Unexpected World Bank API response for ${path}`);
  }
  return payload;
}

const [geography, [, economies], ...series] = await Promise.all([
  readFile(new URL("data/natural-earth/ne_50m_admin_0_countries.geojson", publicRoot), "utf8").then(JSON.parse),
  readApi("country"),
  ...indicators.map((indicator) => readApi(`country/all/indicator/${indicator}`, { source: "2", date: `${years[0]}:${years.at(-1)}` })),
]);

const reportingEconomies = new Map(economies.filter(({ region }) => region.id !== "NA").map(({ id, name }) => [id, name]));
const countries = new Map();

for (const { properties } of geography.features) {
  const { ISO_A3, ISO_A3_EH, ADM0_A3_WB, ADM0_A3, NAME_ZH, LABEL_X, LABEL_Y } = properties;
  const code = [ISO_A3, ISO_A3_EH, ADM0_A3_WB, ADM0_A3].find((candidate) => reportingEconomies.has(candidate));
  if (!code || !Number.isFinite(LABEL_X) || !Number.isFinite(LABEL_Y)) continue;
  if (countries.has(code) && ADM0_A3 !== code) continue;

  countries.set(code, {
    code,
    mapId: ADM0_A3,
    label: code === "CHN" ? "中国" : NAME_ZH || reportingEconomies.get(code),
    coordinates: [LABEL_X, LABEL_Y],
    values: Object.fromEntries(indicators.map((id) => [id, years.map(() => null)])),
  });
}

const updateDates = {};
for (const [index, [meta, rows]] of series.entries()) {
  const indicator = indicators[index];
  updateDates[indicator] = meta.lastupdated;
  let count = 0;
  for (const row of rows) {
    const country = countries.get(row.countryiso3code);
    const yearIndex = years.indexOf(Number(row.date));
    if (!country || yearIndex < 0 || typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
    country.values[indicator][yearIndex] = row.value;
    count += 1;
  }
  if (!count || typeof meta.lastupdated !== "string") throw new Error(`No dated WDI observations found for ${indicator}`);
  console.log(`${indicator}: ${count} values, WDI updated ${meta.lastupdated}`);
}

const snapshot = {
  source: "World Bank, World Development Indicators",
  updateDates,
  years,
  countries: [...countries.values()].sort((a, b) => a.code.localeCompare(b.code, "en")),
};
const directory = new URL("data/economy/", publicRoot);
const destination = new URL("wdi.json", directory);
const temporary = new URL(`wdi-${process.pid}.tmp`, directory);
await mkdir(directory, { recursive: true });
await writeFile(temporary, `${JSON.stringify(snapshot)}\n`);
await rename(temporary, destination);
console.log(`Saved ${snapshot.countries.length} map economies to ${fileURLToPath(destination)}`);
