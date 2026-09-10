#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const EXPECTED_HEADER = "TurbID,Day,Tmstamp,Wspd,Wdir,Etmp,Itmp,Ndir,Pab1,Pab2,Pab3,Prtv,Patv";
const SOURCE_URL = "https://aistudio.baidu.com/competition/detail/152/0/introduction";
const RAW_SHA256 = "6CF7613A82C61BB5CF9FCBBF22E3F6C48165FA32021EB6F1905CB2B7AF4D7667";
const MODEL_LAGS = [1, 3, 6, 12, 36, 144];

function number(value) {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSdwpfLine(line) {
  const values = line.split(",");
  if (values.length !== 13) return null;
  const [turbineId, day, time, windSpeed, windDirection, externalTemperature, internalTemperature, nacelleDirection, blade1, blade2, blade3, reactivePower, activePower] = values;
  return {
    turbineId: number(turbineId), day: number(day), time,
    windSpeed: number(windSpeed), windDirection: number(windDirection),
    externalTemperature: number(externalTemperature), internalTemperature: number(internalTemperature),
    nacelleDirection: number(nacelleDirection), blade1: number(blade1), blade2: number(blade2), blade3: number(blade3),
    reactivePower: number(reactivePower), activePower: number(activePower),
  };
}

export function classifySdwpfRecord(record) {
  if (!record || Object.entries(record).some(([key, value]) => key !== "reactivePower" && (value === null || value === ""))) return "missing";
  if (record.windDirection < -180 || record.windDirection > 180 || record.nacelleDirection < -720 || record.nacelleDirection > 720) return "abnormal";
  if ((record.activePower <= 0 && record.windSpeed > 2.5) || record.blade1 > 89 || record.blade2 > 89 || record.blade3 > 89) return "unknown";
  return "valid";
}

function serialMinute(day, time) {
  const [hour, minute] = time.split(":").map(Number);
  return (day - 1) * 1_440 + hour * 60 + minute;
}

function rounded(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function persistenceMetrics(points, horizonSteps) {
  let count = 0;
  let absoluteError = 0;
  let squaredError = 0;
  for (let index = 0; index + horizonSteps < points.length; index += 1) {
    const source = points[index];
    const target = points[index + horizonSteps];
    if (source.day < 215 || !source.usable || !target.usable || target.serialMinute - source.serialMinute !== horizonSteps * 10) continue;
    const error = target.powerMw - source.powerMw;
    count += 1;
    absoluteError += Math.abs(error);
    squaredError += error * error;
  }
  return {
    horizonMinutes: horizonSteps * 10,
    samples: count,
    maeMw: count ? rounded(absoluteError / count) : null,
    rmseMw: count ? rounded(Math.sqrt(squaredError / count)) : null,
  };
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-12) throw new Error("Autoregressive ridge matrix is singular");
    for (let cell = column; cell <= size; cell += 1) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell <= size; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
    }
  }
  return augmented.map((row) => row[size]);
}

function regressionMetrics(actual, predicted) {
  if (!actual.length) return { samples: 0, maeMw: null, rmseMw: null };
  let absoluteError = 0;
  let squaredError = 0;
  actual.forEach((value, index) => {
    const error = value - predicted[index];
    absoluteError += Math.abs(error);
    squaredError += error * error;
  });
  return { samples: actual.length, maeMw: rounded(absoluteError / actual.length), rmseMw: rounded(Math.sqrt(squaredError / actual.length)) };
}

export function buildAutoregressiveComparison(points, horizonSteps, ridge = 1) {
  const examples = [];
  for (let index = MODEL_LAGS.at(-1); index + horizonSteps < points.length; index += 1) {
    const current = points[index];
    const target = points[index + horizonSteps];
    if (!current.usable || !target.usable || target.serialMinute - current.serialMinute !== horizonSteps * 10) continue;
    const lagPoints = MODEL_LAGS.map((lag) => points[index - lag]);
    if (lagPoints.some((point, lagIndex) => !point.usable || current.serialMinute - point.serialMinute !== MODEL_LAGS[lagIndex] * 10)) continue;
    const minuteOfDay = current.serialMinute % 1_440;
    examples.push({
      targetDay: target.day,
      target: target.powerMw,
      persistence: current.powerMw,
      features: [current.meanWindSpeedMps ?? 0, Math.sin(2 * Math.PI * minuteOfDay / 1_440), Math.cos(2 * Math.PI * minuteOfDay / 1_440), ...lagPoints.map((point) => point.powerMw)],
    });
  }
  const training = examples.filter((example) => example.targetDay <= 214);
  const holdout = examples.filter((example) => example.targetDay >= 215);
  if (!training.length || !holdout.length) return { horizonMinutes: horizonSteps * 10, samples: 0, model: null, persistence: null, beatsPersistence: false };
  const featureCount = training[0].features.length;
  const means = Array.from({ length: featureCount }, (_, feature) => training.reduce((sum, example) => sum + example.features[feature], 0) / training.length);
  const deviations = means.map((mean, feature) => Math.sqrt(training.reduce((sum, example) => sum + (example.features[feature] - mean) ** 2, 0) / training.length) || 1);
  const normalize = (features) => [1, ...features.map((value, index) => (value - means[index]) / deviations[index])];
  const dimension = featureCount + 1;
  const xtx = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const xty = Array(dimension).fill(0);
  training.forEach((example) => {
    const row = normalize(example.features);
    for (let left = 0; left < dimension; left += 1) {
      xty[left] += row[left] * example.target;
      for (let right = 0; right < dimension; right += 1) xtx[left][right] += row[left] * row[right];
    }
  });
  for (let index = 1; index < dimension; index += 1) xtx[index][index] += ridge;
  const coefficients = solveLinearSystem(xtx, xty);
  const predicted = holdout.map((example) => normalize(example.features).reduce((sum, value, index) => sum + value * coefficients[index], 0));
  const actual = holdout.map((example) => example.target);
  const persistencePredicted = holdout.map((example) => example.persistence);
  const model = regressionMetrics(actual, predicted);
  const persistence = regressionMetrics(actual, persistencePredicted);
  return {
    horizonMinutes: horizonSteps * 10,
    model,
    persistence,
    maeImprovementPct: rounded(100 * (persistence.maeMw - model.maeMw) / persistence.maeMw, 2),
    beatsPersistence: model.maeMw < persistence.maeMw,
  };
}

export async function buildSdwpfPilot(inputPath, outputPath, aggregatePath = path.join(path.dirname(outputPath), "farm-aggregate.csv")) {
  const quality = { valid: 0, missing: 0, unknown: 0, abnormal: 0 };
  const aggregates = new Map();
  const turbines = new Set();
  let rawRows = 0;
  const reader = readline.createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
  let headerSeen = false;

  for await (const line of reader) {
    if (!headerSeen) {
      if (line.replace(/^\uFEFF/, "") !== EXPECTED_HEADER) throw new Error("SDWPF header does not match the official schema");
      headerSeen = true;
      continue;
    }
    rawRows += 1;
    const record = parseSdwpfLine(line);
    const classification = classifySdwpfRecord(record);
    quality[classification] += 1;
    if (!record?.turbineId || !record.day || !record.time) continue;
    turbines.add(record.turbineId);
    const key = `${record.day}|${record.time}`;
    const aggregate = aggregates.get(key) ?? { day: record.day, time: record.time, serialMinute: serialMinute(record.day, record.time), powerMw: 0, windSpeedTotal: 0, validTurbines: 0 };
    if (classification === "valid") {
      aggregate.powerMw += Math.max(0, record.activePower) / 1_000;
      aggregate.windSpeedTotal += record.windSpeed;
      aggregate.validTurbines += 1;
    }
    aggregates.set(key, aggregate);
  }

  const turbineCount = turbines.size;
  const points = Array.from(aggregates.values()).sort((left, right) => left.serialMinute - right.serialMinute).map((point) => ({
    ...point,
    powerMw: rounded(point.powerMw),
    meanWindSpeedMps: point.validTurbines ? rounded(point.windSpeedTotal / point.validTurbines) : null,
    coverage: turbineCount ? rounded(point.validTurbines / turbineCount, 4) : 0,
    usable: turbineCount > 0 && point.validTurbines / turbineCount >= 0.95,
  }));
  const usablePoints = points.filter((point) => point.usable);
  const horizons = [1, 3, 6, 36, 144].map((steps) => persistenceMetrics(points, steps));
  const comparisons = [1, 3, 6].map((steps) => buildAutoregressiveComparison(points, steps));
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "historical-backtest-only",
    source: {
      name: "SDWPF · Baidu KDD Cup 2022",
      url: SOURCE_URL,
      identity: "real-world-scada",
      operator: "Longyuan Power Group Corp. Ltd.",
      rawSha256: RAW_SHA256,
      redistributionLicense: "not-stated-on-official-download-page",
    },
    limitations: [
      "The release uses relative turbine coordinates and anonymous day indices; it cannot be placed at a precise map location.",
      "No historical NWP issue/valid-time archive is included, so this does not unlock the NWP production gate.",
      "Results are a historical holdout replay, not a live forecast.",
    ],
    dataset: {
      rawRows,
      turbineCount,
      dayCount: points.length ? Math.max(...points.map((point) => point.day)) : 0,
      intervalMinutes: 10,
      aggregatePoints: points.length,
      usableAggregatePoints: usablePoints.length,
      usableRatio: points.length ? rounded(usablePoints.length / points.length, 4) : 0,
      quality,
    },
    baseline: {
      model: "persistence",
      trainDays: "1-214",
      holdoutDays: "215-245",
      horizons,
    },
    modelComparison: {
      name: "autoregressive-ridge",
      status: comparisons.some((item) => item.beatsPersistence) ? "candidate" : "rejected-no-baseline-gain",
      featurePolicy: "past SCADA and current observed wind only; no future meteorology",
      split: { trainDays: "1-214", holdoutDays: "215-245" },
      comparisons,
    },
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const aggregateHeader = "day,time,serial_minute,power_mw,mean_wind_speed_mps,valid_turbines,coverage,usable";
  const aggregateLines = points.map((point) => [
    point.day, point.time, point.serialMinute, point.powerMw, point.meanWindSpeedMps ?? "",
    point.validTurbines, point.coverage, point.usable ? 1 : 0,
  ].join(","));
  await fs.writeFile(aggregatePath, `${aggregateHeader}\n${aggregateLines.join("\n")}\n`, "utf8");
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? ".forecast-data/sdwpf/sdwpf-official.csv");
  const outputPath = path.resolve(process.argv[3] ?? ".forecast-data/sdwpf/pilot-summary.json");
  const aggregatePath = path.resolve(process.argv[4] ?? ".forecast-data/sdwpf/farm-aggregate.csv");
  const result = await buildSdwpfPilot(inputPath, outputPath, aggregatePath);
  console.log(JSON.stringify({ outputPath, aggregatePath, ...result }, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
