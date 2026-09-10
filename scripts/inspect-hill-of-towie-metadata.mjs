#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { parseCsv } from "./validate-forecast-training-data.mjs";

const defaultInputDir = path.resolve(".forecast-data/hill-of-towie");
const defaultOutputPath = path.join(defaultInputDir, "site-profile.json");

function numeric(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric ${field}: ${value}`);
  return parsed;
}

function rounded(value, digits = 6) {
  return Number(value.toFixed(digits));
}

export function buildSiteProfile(turbines, turbineFields, gridFields) {
  if (!turbines.length) throw new Error("Turbine metadata is empty");
  const normalized = turbines.map((row) => ({
    turbineId: row["Turbine Name"],
    stationId: row["Station ID"],
    latitude: numeric(row.Latitude, "latitude"),
    longitude: numeric(row.Longitude, "longitude"),
    ratedPowerKw: numeric(row["Rated power (kW)"], "rated power"),
    model: row.Model,
    hubHeightM: numeric(row["Hub Height (m)"], "hub height"),
    rotorDiameterM: numeric(row["Rotor Diameter (m)"], "rotor diameter"),
  }));
  const latitudes = normalized.map((item) => item.latitude);
  const longitudes = normalized.map((item) => item.longitude);
  const fieldByDescription = new Map(turbineFields.map((row) => [row["Field Description"], row]));
  const gridPower = gridFields.find((row) => row["Field Description"] === "Active Power");
  const requiredDescriptions = ["Active power", "Time running in period", "Time ready to operate in period", "Time turbine error active in period"];
  const missingFields = requiredDescriptions.filter((description) => !fieldByDescription.has(description));
  if (missingFields.length) throw new Error(`Missing required source fields: ${missingFields.join(", ")}`);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceId: "hill-of-towie-v2",
    entity: {
      id: "hill-of-towie",
      name: turbines[0]["Wind Farm"],
      country: turbines[0].Country,
      timezone: "UTC",
      technology: "wind",
      turbineCount: normalized.length,
      installedCapacityMw: rounded(normalized.reduce((sum, item) => sum + item.ratedPowerKw, 0) / 1_000, 3),
      centroid: {
        latitude: rounded(latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length),
        longitude: rounded(longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length),
      },
      bounds: {
        north: Math.max(...latitudes), south: Math.min(...latitudes),
        east: Math.max(...longitudes), west: Math.min(...longitudes),
      },
      turbines: normalized,
    },
    sourceResolutionMinutes: 10,
    timestampPolicy: "UTC end-of-period; subtract 10 minutes only when a start-of-period timestamp is explicitly required",
    observedPower: {
      turbineField: fieldByDescription.get("Active power")["Manufacturer Name"],
      turbineUnit: fieldByDescription.get("Active power").Unit,
      gridField: gridPower?.["Manufacturer Name"] ?? null,
      gridUnit: gridPower?.Unit ?? null,
    },
    availabilityEvidence: {
      runningSecondsField: fieldByDescription.get("Time running in period")["Manufacturer Name"],
      readySecondsField: fieldByDescription.get("Time ready to operate in period")["Manufacturer Name"],
      errorSecondsField: fieldByDescription.get("Time turbine error active in period")["Manufacturer Name"],
      curtailmentField: null,
      warning: "Availability fields support auditable outage classification; the 2025 archive also exposes source-reported PowerRed/PowerRef evidence, but no authoritative grid-curtailment label."
    },
    recommendedWindow: {
      year: 2025,
      reason: "Complete year inside the approximate NCEI two-year online GFS forecast window and outside the documented 2024 TuneUp and 2026 Dynamic Yaw campaigns.",
      status: "recommended-source-window"
    },
    reviewFlags: [
      "Inspect the annual archive schema before mapping active power because the README and field dictionary name different source tables for wtc_ActPower_mean.",
      "Aggregate six contiguous 10-minute periods to the 60-minute training contract; do not label the result as 15-minute ultra-short-term data.",
      "Keep grid curtailment unknown unless an independent authoritative label is obtained; retain PowerRed/PowerRef as separate source evidence."
    ]
  };
}

export async function inspectMetadata(inputDir = defaultInputDir, outputPath = defaultOutputPath) {
  const [turbines, turbineFields, gridFields] = await Promise.all([
    readFile(path.join(inputDir, "Hill_of_Towie_turbine_metadata.csv"), "utf8").then(parseCsv),
    readFile(path.join(inputDir, "Hill_of_Towie_turbine_fields_description.csv"), "utf8").then(parseCsv),
    readFile(path.join(inputDir, "Hill_of_Towie_grid_fields_description.csv"), "utf8").then(parseCsv),
  ]);
  const profile = buildSiteProfile(turbines, turbineFields, gridFields);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profile;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  inspectMetadata().then((profile) => console.log(JSON.stringify(profile, null, 2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
