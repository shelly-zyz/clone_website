#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const outputRoot = path.join(
  repoRoot,
  "output",
  "course_carbon_power_prediction_lite_v2_corrected_20260730",
);
const mainName =
  "03_china_grid_daily_power_carbon_climate_0p5deg_2021_2026.csv";
const mainPath = path.join(outputRoot, mainName);

const input = createReadStream(mainPath, { encoding: "utf8" });
const lines = readline.createInterface({ input, crlfDelay: Infinity });
let lineNumber = 0;
let dataRows = 0;
let malformedRows = 0;
let invalidNumbers = 0;
let conversionMismatches = 0;
let firstDate = null;
let lastDate = null;
let currentDate = null;
let currentDateRows = 0;
let dates = 0;
let invalidDateRowCounts = 0;
let tasCMin = Number.POSITIVE_INFINITY;
let tasCMax = Number.NEGATIVE_INFINITY;
let windMin = Number.POSITIVE_INFINITY;
let windMax = Number.NEGATIVE_INFINITY;
let powerMin = Number.POSITIVE_INFINITY;
let powerMax = Number.NEGATIVE_INFINITY;

for await (const line of lines) {
  lineNumber += 1;
  if (lineNumber === 1) {
    if (line.split(",").length !== 14) {
      throw new Error("Unexpected main-table header.");
    }
    continue;
  }
  if (!line) continue;
  const cells = line.split(",");
  if (cells.length !== 14) {
    malformedRows += 1;
    continue;
  }
  const date = cells[0];
  if (firstDate === null) firstDate = date;
  lastDate = date;
  if (date !== currentDate) {
    if (currentDate !== null) {
      dates += 1;
      if (currentDateRows !== 3848) invalidDateRowCounts += 1;
    }
    currentDate = date;
    currentDateRows = 0;
  }
  currentDateRows += 1;
  dataRows += 1;

  const powerKgc = Number(cells[4]);
  const powerTco2 = Number(cells[5]);
  const tasK = Number(cells[6]);
  const tasC = Number(cells[7]);
  const wind = Number(cells[8]);
  const numericValues = [powerKgc, powerTco2, tasK, tasC, wind];
  if (numericValues.some((value) => !Number.isFinite(value))) {
    invalidNumbers += 1;
    continue;
  }
  const expectedTco2 = (powerKgc * 24 * 44) / 12 / 1_000;
  if (Math.abs(expectedTco2 - powerTco2) > 0.00002) {
    conversionMismatches += 1;
  }
  if (Math.abs(tasK - (tasC + 273.15)) > 0.00002) {
    conversionMismatches += 1;
  }
  tasCMin = Math.min(tasCMin, tasC);
  tasCMax = Math.max(tasCMax, tasC);
  windMin = Math.min(windMin, wind);
  windMax = Math.max(windMax, wind);
  powerMin = Math.min(powerMin, powerTco2);
  powerMax = Math.max(powerMax, powerTco2);
}
if (currentDate !== null) {
  dates += 1;
  if (currentDateRows !== 3848) invalidDateRowCounts += 1;
}

const expectedRows = 7_488_208;
const checks = {
  expectedRows: dataRows === expectedRows,
  expectedDates: dates === 1946,
  expectedFirstDate: firstDate === "2021-01-01",
  expectedLastDate: lastDate === "2026-04-30",
  everyDateHas3848Rows: invalidDateRowCounts === 0,
  noMalformedRows: malformedRows === 0,
  noInvalidNumbers: invalidNumbers === 0,
  conversionsConsistent: conversionMismatches === 0,
  plausibleTasC: tasCMin > -80 && tasCMax < 70,
  nonnegativeWind: windMin >= 0,
  nonnegativePower: powerMin >= 0,
};
const passed = Object.values(checks).every(Boolean);

const report = {
  validatedAt: new Date().toISOString(),
  passed,
  file: mainName,
  sizeBytes: (await stat(mainPath)).size,
  sha256: await sha256File(mainPath),
  observations: {
    dataRows,
    dates,
    gridPointsPerDate: 3848,
    firstDate,
    lastDate,
  },
  qualityCounts: {
    malformedRows,
    invalidNumbers,
    conversionMismatches,
    invalidDateRowCounts,
  },
  ranges: {
    tasC: [tasCMin, tasCMax],
    windMPerS: [windMin, windMax],
    powerTco2PerDay: [powerMin, powerMax],
  },
  checks,
};
await writeFile(
  path.join(outputRoot, "VALIDATION_REPORT.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

const manifestPath = path.join(outputRoot, "MANIFEST.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
for (const fileName of [
  "09_交接给论文写作者的资料说明.md",
  "VALIDATION_REPORT.json",
]) {
  const filePath = path.join(outputRoot, fileName);
  const info = await stat(filePath);
  const entry = {
    fileName,
    rows: null,
    sizeBytes: info.size,
    sha256: await sha256File(filePath),
  };
  const index = manifest.files.findIndex((item) => item.fileName === fileName);
  if (index >= 0) manifest.files[index] = entry;
  else manifest.files.push(entry);
}
manifest.validationPassed = passed;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;

async function sha256File(filePath) {
  const digest = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}
