#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const quiet = process.argv.includes("--quiet");
const outputDir = path.resolve(process.cwd(), ".weather-cache");
const gribPath = path.join(outputDir, "gfs-surface-latest.grib2");
const csvPath = path.join(outputDir, "gfs-surface-latest.csv");
const generatedAt = new Date().toISOString();
const forecastHour = 3;
const missingValue = 65535;

const metricDefinitions = {
  wind: {
    key: "wind",
    kind: "vector",
    variables: ["UGRD", "VGRD"],
    levelParams: ["lev_10_m_above_ground"],
    nativeLevelLabel: "10 m above ground",
    unit: "m/s",
    precision: 1,
    scale: 0.1,
    transform: (value) => value,
  },
  temperature: {
    key: "temperature",
    kind: "scalar",
    variables: ["TMP"],
    levelParams: ["lev_2_m_above_ground"],
    nativeLevelLabel: "2 m above ground",
    unit: "degC",
    precision: 1,
    scale: 0.1,
    transform: (value) => value - 273.15,
  },
  relativeHumidity: {
    key: "relativeHumidity",
    kind: "scalar",
    variables: ["RH"],
    levelParams: ["lev_2_m_above_ground"],
    nativeLevelLabel: "2 m above ground",
    unit: "%",
    precision: 0,
    scale: 1,
    transform: (value) => value,
  },
  cape: {
    key: "cape",
    kind: "scalar",
    variables: ["CAPE"],
    levelParams: ["lev_surface"],
    nativeLevelLabel: "surface",
    unit: "J/kg",
    precision: 0,
    scale: 1,
    transform: (value) => value,
  },
  mslp: {
    key: "mslp",
    kind: "scalar",
    variables: ["PRMSL"],
    levelParams: ["lev_mean_sea_level"],
    nativeLevelLabel: "mean sea level",
    unit: "hPa",
    precision: 0,
    scale: 0.1,
    transform: (value) => value / 100,
  },
  precipitableWater: {
    key: "precipitableWater",
    kind: "scalar",
    variables: ["PWAT"],
    levelParams: ["lev_entire_atmosphere_(considered_as_a_single_layer)"],
    nativeLevelLabel: "entire atmosphere (single layer)",
    unit: "kg/m2",
    precision: 1,
    scale: 0.1,
    transform: (value) => value,
  },
};

async function main() {
  await mkdir(outputDir, { recursive: true });

  const wgrib2 = spawnSync("wgrib2", ["-version"], { encoding: "utf8", windowsHide: true });
  if (wgrib2.error || wgrib2.status !== 0) {
    await writeFallbackManifest("wgrib2 is not installed or not available; showing the built-in sample weather field.");
    return;
  }

  try {
    const cycle = await downloadLatestAvailableGfs();
    runWgrib2Csv();
    const parsed = await parseCsvGrid();
    await writeWeatherFields(cycle, parsed);
    if (!quiet) {
      console.log(JSON.stringify({ ok: true, outputDir, cycle: cycle.runTimeUtc, forecastHour }, null, 2));
    }
  } catch (error) {
    await writeFallbackManifest(`GFS refresh failed: ${error instanceof Error ? error.message : String(error)}.`);
    if (!quiet) {
      console.error(error);
    }
  }
}

async function downloadLatestAvailableGfs() {
  const cycles = latestGfsRunTimes();
  let lastError = null;

  for (const runTime of cycles) {
    const url = buildNomadsUrl(runTime);
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "OpenGridWorks weather-earth updater",
        },
      });
      if (!response.ok || !response.body) {
        throw new Error(`NOMADS returned ${response.status} for ${runTime.toISOString()}`);
      }

      await pipeline(Readable.fromWeb(response.body), createWriteStream(gribPath));
      const downloaded = await stat(gribPath);
      if (downloaded.size < 10000) {
        throw new Error(`Downloaded GRIB2 is unexpectedly small (${downloaded.size} bytes).`);
      }

      return {
        runTime,
        runTimeUtc: runTime.toISOString(),
        validTimeUtc: new Date(runTime.getTime() + forecastHour * 60 * 60 * 1000).toISOString(),
        url,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No available GFS cycle found.");
}

function buildNomadsUrl(runTime) {
  const date = [
    runTime.getUTCFullYear(),
    String(runTime.getUTCMonth() + 1).padStart(2, "0"),
    String(runTime.getUTCDate()).padStart(2, "0"),
  ].join("");
  const cycle = String(runTime.getUTCHours()).padStart(2, "0");
  const params = new URLSearchParams();

  params.set("file", `gfs.t${cycle}z.pgrb2full.0p50.f${String(forecastHour).padStart(3, "0")}`);
  for (const metric of Object.values(metricDefinitions)) {
    for (const variable of metric.variables) {
      params.set(`var_${variable}`, "on");
    }
    for (const level of metric.levelParams) {
      params.set(level, "on");
    }
  }
  params.set("dir", `/gfs.${date}/${cycle}/atmos`);

  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p50.pl?${params.toString()}`;
}

function runWgrib2Csv() {
  const result = spawnSync("wgrib2", [gribPath, "-csv", csvPath], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || `wgrib2 exited with ${result.status}`);
  }
}

async function parseCsvGrid() {
  const csv = await readFile(csvPath, "utf8");
  const lons = new Set();
  const lats = new Set();
  const values = {
    UGRD: new Map(),
    VGRD: new Map(),
    TMP: new Map(),
    RH: new Map(),
    CAPE: new Map(),
    PRMSL: new Map(),
    PWAT: new Map(),
  };

  for (const line of csv.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    const columns = parseCsvLine(line);
    const variable = columns.find((column) => values[column]);
    if (!variable) {
      continue;
    }

    const value = Number(columns.at(-1));
    const lat = Number(columns.at(-2));
    const lon = normalizeLongitude(Number(columns.at(-3)));
    if (!Number.isFinite(value) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const lonKey = coordinateKey(lon);
    const latKey = coordinateKey(lat);
    lons.add(lonKey);
    lats.add(latKey);
    values[variable].set(`${lonKey},${latKey}`, value);
  }

  const sortedLons = [...lons].map(Number).sort((a, b) => a - b);
  const sortedLats = [...lats].map(Number).sort((a, b) => b - a);
  if (sortedLons.length < 2 || sortedLats.length < 2) {
    throw new Error("wgrib2 CSV did not contain a usable global grid.");
  }

  return {
    header: {
      lo1: sortedLons[0],
      la1: sortedLats[0],
      dx: roundStep(sortedLons[1] - sortedLons[0]),
      dy: roundStep(sortedLats[0] - sortedLats[1]),
      nx: sortedLons.length,
      ny: sortedLats.length,
    },
    lons: sortedLons,
    lats: sortedLats,
    values,
  };
}

async function writeWeatherFields(cycle, parsed) {
  const manifestMetrics = [];
  const header = {
    ...parsed.header,
    refTime: cycle.runTimeUtc,
    forecastTime: forecastHour,
  };

  for (const metric of Object.values(metricDefinitions)) {
    manifestMetrics.push({
      key: metric.key,
      unit: metric.unit,
      precision: metric.precision,
      endpoint: `/api/weather-earth?metric=${metric.key}`,
      kind: metric.kind,
      nativeLevelLabel: metric.nativeLevelLabel,
    });

    if (metric.kind === "vector") {
      const u = gridValues(parsed, "UGRD", metric.transform);
      const v = gridValues(parsed, "VGRD", metric.transform);
      const stats = statsFor(u.map((value, index) => (
        Number.isFinite(value) && Number.isFinite(v[index]) ? Math.hypot(value, v[index]) : null
      )));
      await writeField(metric.key, {
        key: metric.key,
        generatedAt,
        validTimeUtc: cycle.validTimeUtc,
        source: "GFS",
        header,
        encoding: { kind: "linear", offset: 0, scale: metric.scale, missingValue },
        stats,
        kind: "vector",
        u: encodeValues(u, metric.scale),
        v: encodeValues(v, metric.scale),
      });
      continue;
    }

    const variable = metric.variables[0];
    const values = gridValues(parsed, variable, metric.transform);
    await writeField(metric.key, {
      key: metric.key,
      generatedAt,
      validTimeUtc: cycle.validTimeUtc,
      source: "GFS",
      header,
      encoding: { kind: "linear", offset: 0, scale: metric.scale, missingValue },
      stats: statsFor(values),
      kind: "scalar",
      values: encodeValues(values, metric.scale),
    });
  }

  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({
    generatedAt,
    source: "GFS",
    runTimeUtc: cycle.runTimeUtc,
    forecastHour,
    validTimeUtc: cycle.validTimeUtc,
    stale: false,
    refreshStatus: "live",
    metrics: manifestMetrics,
  })}\n`, "utf8");
}

async function writeField(metric, field) {
  await writeFile(path.join(outputDir, `${metric}.json`), `${JSON.stringify(field)}\n`, "utf8");
}

async function writeFallbackManifest(message) {
  const runTime = latestGfsRunTimes()[0];
  const validTimeUtc = new Date(runTime.getTime() + forecastHour * 60 * 60 * 1000).toISOString();
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({
    generatedAt,
    source: "GFS",
    runTimeUtc: runTime.toISOString(),
    forecastHour,
    validTimeUtc,
    stale: true,
    refreshStatus: "sample-fallback",
    message,
    metrics: Object.values(metricDefinitions).map((metric) => ({
      key: metric.key,
      unit: metric.unit,
      precision: metric.precision,
      endpoint: `/api/weather-earth?metric=${metric.key}`,
      kind: metric.kind,
      nativeLevelLabel: metric.nativeLevelLabel,
    })),
  })}\n`, "utf8");

  if (!quiet) {
    console.log(JSON.stringify({ ok: true, outputDir, message }, null, 2));
  }
}

function gridValues(parsed, variable, transform) {
  const source = parsed.values[variable];
  const values = [];
  for (const lat of parsed.lats) {
    for (const lon of parsed.lons) {
      const raw = source.get(`${coordinateKey(lon)},${coordinateKey(lat)}`);
      values.push(raw === undefined ? null : transform(raw));
    }
  }
  return values;
}

function encodeValues(values, scale) {
  return values.map((value) => (
    Number.isFinite(value) ? Math.round(value / scale) : missingValue
  ));
}

function statsFor(values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    count += 1;
  }
  return {
    min: count ? roundStat(min) : 0,
    max: count ? roundStat(max) : 0,
    mean: count ? roundStat(sum / count) : 0,
  };
}

function parseCsvLine(line) {
  const columns = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      columns.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  columns.push(current);
  return columns.map((column) => column.trim());
}

function latestGfsRunTimes(now = new Date()) {
  const runTimes = [];
  const baseHour = Math.max(0, Math.floor((now.getUTCHours() - 5) / 6) * 6);
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), baseHour, 0, 0));
  if (now.getUTCHours() < 5) {
    base.setUTCDate(base.getUTCDate() - 1);
    base.setUTCHours(18);
  }
  for (let index = 0; index < 6; index += 1) {
    runTimes.push(new Date(base.getTime() - index * 6 * 60 * 60 * 1000));
  }
  return runTimes;
}

function normalizeLongitude(lon) {
  const normalized = ((lon % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

function coordinateKey(value) {
  return value.toFixed(3);
}

function roundStep(value) {
  return Number(value.toFixed(3));
}

function roundStat(value) {
  return Number(value.toFixed(3));
}

main().catch((error) => {
  if (!quiet) {
    console.error(error);
  }
  process.exitCode = 1;
});
