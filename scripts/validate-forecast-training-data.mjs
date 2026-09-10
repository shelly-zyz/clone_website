#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const REQUIRED_FORECAST_FIELDS = [
  "entity_id",
  "entity_level",
  "technology",
  "entity_latitude",
  "entity_longitude",
  "observed_at",
  "observed_power_mw",
  "observed_power_unit",
  "nwp_issue_time",
  "nwp_valid_time",
  "installed_capacity_mw",
  "available_capacity_mw",
  "outage_flag",
  "curtailment_flag",
  "timezone",
  "quality_code",
  "data_identity",
  "observation_source",
  "nwp_source",
  "data_license",
  "resolution_minutes",
];

const allowedEntityLevels = new Set(["plant", "province"]);
const allowedTechnologies = new Set(["wind", "solar"]);
const allowedQualityCodes = new Set(["valid", "suspect", "missing", "invalid"]);

function finiteNumber(value) {
  const number = Number(value);
  return value !== "" && value !== null && value !== undefined && Number.isFinite(number) ? number : null;
}

function validBoolean(value) {
  return ["0", "1", "true", "false", 0, 1, true, false].includes(value);
}

function timestamp(value) {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function validTimezone(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function addError(errors, rowNumber, message) {
  errors.add(`row ${rowNumber}: ${message}`);
}

export function validateForecastTrainingRows(rows, options = {}) {
  const minimumCoverageDays = Number.isFinite(options.minimumCoverageDays) ? options.minimumCoverageDays : 90;
  const errors = new Set();
  const warnings = new Set();
  const validRows = [];
  const quarantinedRows = [];
  const seenKeys = new Set();
  const entityStats = new Map();

  if (minimumCoverageDays < 0) {
    throw new RangeError("minimumCoverageDays must be a non-negative number");
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      valid: false,
      gatePassed: false,
      status: "invalid",
      rowCount: 0,
      validRowCount: 0,
      quarantinedRowCount: 0,
      errors: ["training data contains no rows"],
      warnings: [],
      blockers: ["No source-backed training rows were supplied."],
      eligibility: { hourlyBaseline: false, ultraShortTerm: false },
      entities: [],
    };
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      addError(errors, rowNumber, "row must be an object");
      return;
    }
    for (const field of REQUIRED_FORECAST_FIELDS) {
      if (row[field] === undefined || row[field] === null || String(row[field]).trim() === "") {
        addError(errors, rowNumber, `missing required field ${field}`);
      }
    }

    const entityId = String(row.entity_id ?? "").trim();
    const entityLevel = String(row.entity_level ?? "").trim();
    const technology = String(row.technology ?? "").trim();
    const entityLatitude = finiteNumber(row.entity_latitude);
    const entityLongitude = finiteNumber(row.entity_longitude);
    const identity = String(row.data_identity ?? "").trim();
    const qualityCode = String(row.quality_code ?? "").trim();
    const observedAt = timestamp(row.observed_at);
    const issueTime = timestamp(row.nwp_issue_time);
    const validTime = timestamp(row.nwp_valid_time);
    const observedPower = finiteNumber(row.observed_power_mw);
    const installedCapacity = finiteNumber(row.installed_capacity_mw);
    const availableCapacity = finiteNumber(row.available_capacity_mw);
    const resolution = finiteNumber(row.resolution_minutes);

    if (!allowedEntityLevels.has(entityLevel)) addError(errors, rowNumber, "entity_level must be plant or province");
    if (!allowedTechnologies.has(technology)) addError(errors, rowNumber, "technology must be wind or solar");
    if (entityLatitude === null || entityLatitude < -90 || entityLatitude > 90) addError(errors, rowNumber, "entity_latitude must be between -90 and 90");
    if (entityLongitude === null || entityLongitude < -180 || entityLongitude > 180) addError(errors, rowNumber, "entity_longitude must be between -180 and 180");
    if (identity !== "observed") addError(errors, rowNumber, "data_identity must be observed; forecasts, research estimates, and model scenarios cannot be power labels");
    if (!allowedQualityCodes.has(qualityCode)) addError(errors, rowNumber, "quality_code must be valid, suspect, missing, or invalid");
    if (!validTimezone(row.timezone)) addError(errors, rowNumber, "timezone must be a valid IANA timezone such as Asia/Shanghai");
    if (row.observed_power_unit !== "MW") addError(errors, rowNumber, "observed_power_unit must be MW");
    if (observedAt === null) addError(errors, rowNumber, "observed_at must be ISO 8601 with an explicit offset");
    if (issueTime === null) addError(errors, rowNumber, "nwp_issue_time must be ISO 8601 with an explicit offset");
    if (validTime === null) addError(errors, rowNumber, "nwp_valid_time must be ISO 8601 with an explicit offset");
    if (issueTime !== null && validTime !== null && issueTime >= validTime) addError(errors, rowNumber, "nwp_issue_time must precede nwp_valid_time to prevent future leakage");
    if (observedAt !== null && validTime !== null && observedAt !== validTime) addError(errors, rowNumber, "observed_at must represent the same instant as nwp_valid_time");
    if (observedPower === null || observedPower < 0) addError(errors, rowNumber, "observed_power_mw must be a non-negative number");
    if (installedCapacity === null || installedCapacity <= 0) addError(errors, rowNumber, "installed_capacity_mw must be positive");
    if (availableCapacity === null || availableCapacity < 0) addError(errors, rowNumber, "available_capacity_mw must be non-negative");
    if (installedCapacity !== null && availableCapacity !== null && availableCapacity > installedCapacity) addError(errors, rowNumber, "available_capacity_mw cannot exceed installed_capacity_mw");
    if (installedCapacity !== null && observedPower !== null && observedPower > installedCapacity * 1.05) addError(errors, rowNumber, "observed_power_mw exceeds installed capacity by more than 5%");
    if (!validBoolean(row.outage_flag)) addError(errors, rowNumber, "outage_flag must be boolean or 0/1");
    if (!validBoolean(row.curtailment_flag)) addError(errors, rowNumber, "curtailment_flag must be boolean or 0/1");
    if (![15, 60].includes(resolution)) addError(errors, rowNumber, "resolution_minutes must be 15 or 60");
    if (technology === "wind" && (finiteNumber(row.nwp_wind_speed_mps) ?? -1) < 0) addError(errors, rowNumber, "wind rows require non-negative nwp_wind_speed_mps");
    if (technology === "solar" && (finiteNumber(row.nwp_surface_solar_radiation_wm2) ?? -1) < 0) addError(errors, rowNumber, "solar rows require non-negative nwp_surface_solar_radiation_wm2");

    const key = `${entityId}|${observedAt}`;
    if (seenKeys.has(key)) addError(errors, rowNumber, "duplicate entity_id and observed_at");
    seenKeys.add(key);

    if (qualityCode !== "valid") {
      quarantinedRows.push(rowNumber);
      return;
    }
    validRows.push(row);
    if (entityId && observedAt !== null && [15, 60].includes(resolution)) {
      const stats = entityStats.get(entityId) ?? { entityId, start: observedAt, end: observedAt, rows: 0, resolutions: new Set(), technology };
      stats.start = Math.min(stats.start, observedAt);
      stats.end = Math.max(stats.end, observedAt);
      stats.rows += 1;
      stats.resolutions.add(resolution);
      entityStats.set(entityId, stats);
    }
  });

  const entities = Array.from(entityStats.values()).map((stats) => {
    const resolutionMinutes = stats.resolutions.size === 1 ? Array.from(stats.resolutions)[0] : null;
    if (stats.resolutions.size > 1) errors.add(`entity ${stats.entityId}: mixed resolution_minutes values are not allowed`);
    const spanMinutes = (stats.end - stats.start) / 60_000;
    const coverageDays = resolutionMinutes ? (spanMinutes + resolutionMinutes) / 1_440 : 0;
    const expectedRows = resolutionMinutes ? Math.floor(spanMinutes / resolutionMinutes) + 1 : 0;
    const completeness = expectedRows > 0 ? Math.min(1, stats.rows / expectedRows) : 0;
    return {
      entityId: stats.entityId,
      technology: stats.technology,
      resolutionMinutes,
      rows: stats.rows,
      coverageDays: Number(coverageDays.toFixed(2)),
      completeness: Number(completeness.toFixed(4)),
    };
  });

  const structuralValid = errors.size === 0;
  const coverageReady = entities.length > 0 && entities.every((entity) => entity.coverageDays >= minimumCoverageDays && entity.completeness >= 0.95);
  const validRatio = validRows.length / rows.length;
  if (quarantinedRows.length) warnings.add(`${quarantinedRows.length} rows were quarantined because quality_code was not valid`);
  if (validRatio < 0.95) warnings.add("fewer than 95% of rows have quality_code=valid");

  const blockers = [];
  if (!structuralValid) blockers.push("Structural validation failed; correct every reported row error.");
  if (structuralValid && !coverageReady) blockers.push(`Each entity needs at least ${minimumCoverageDays} days with at least 95% temporal completeness.`);
  if (structuralValid && validRatio < 0.95) blockers.push("At least 95% of supplied rows must pass the source quality flag.");

  const resolutions = new Set(entities.map((entity) => entity.resolutionMinutes));
  const commonReady = structuralValid && coverageReady && validRatio >= 0.95;
  const ultraShortTerm = commonReady && resolutions.size === 1 && resolutions.has(15);
  const hourlyBaseline = commonReady && Array.from(resolutions).every((value) => value === 15 || value === 60);
  const status = !structuralValid
    ? "invalid"
    : ultraShortTerm
      ? "eligible-ultra-short-term"
      : hourlyBaseline
        ? "eligible-hourly-baseline"
        : "locked-insufficient-coverage";

  return {
    valid: structuralValid,
    gatePassed: commonReady,
    status,
    rowCount: rows.length,
    validRowCount: validRows.length,
    quarantinedRowCount: quarantinedRows.length,
    errors: Array.from(errors),
    warnings: Array.from(warnings),
    blockers,
    eligibility: { hourlyBaseline, ultraShortTerm },
    entities,
  };
}

export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (quoted) {
      if (character === '"' && normalized[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  record.push(field.replace(/\r$/, ""));
  if (record.some((value) => value !== "")) records.push(record);
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (records.length < 2) return [];
  const headers = records[0].map((value) => value.trim());
  return records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function loadRows(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".csv") return parseCsv(text);
  if (extension === ".ndjson" || extension === ".jsonl") {
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  if (extension === ".json") {
    const payload = JSON.parse(text);
    return Array.isArray(payload) ? payload : payload.rows;
  }
  throw new Error("Supported input formats are CSV, JSON, NDJSON, and JSONL.");
}

export async function auditForecastWorkspace(root = process.cwd()) {
  const sourceManifestPath = path.join(root, "docs/project-management/forecast-sources/hill-of-towie.json");
  const nwpManifestPath = path.join(root, "docs/project-management/forecast-sources/noaa-gfs-historical.json");
  const acquisitionStatusPath = path.join(root, ".forecast-data/hill-of-towie/acquisition-status.json");
  const nwpAcquisitionStatusPath = path.join(root, ".forecast-data/noaa-gfs/hill-of-towie-2025/acquisition-status.json");
  const nwpPointFilePath = path.join(root, ".forecast-data/noaa-gfs/hill-of-towie-2025/hill-of-towie-2025-gfs-100m.ndjson");
  const pairingAuditPath = path.join(root, ".forecast-data/noaa-gfs/hill-of-towie-2025/pairing-audit.json");
  const pairedTrainingFilePath = path.join(root, ".forecast-data/noaa-gfs/hill-of-towie-2025/hill-of-towie-2025-training-pairs.ndjson");
  const sourceManifest = await fs.readFile(sourceManifestPath, "utf8").then(JSON.parse).catch(() => null);
  const nwpManifest = await fs.readFile(nwpManifestPath, "utf8").then(JSON.parse).catch(() => null);
  const acquisitionStatus = await fs.readFile(acquisitionStatusPath, "utf8").then(JSON.parse).catch(() => null);
  const nwpAcquisitionStatus = await fs.readFile(nwpAcquisitionStatusPath, "utf8").then(JSON.parse).catch(() => null);
  const pairingAudit = await fs.readFile(pairingAuditPath, "utf8").then(JSON.parse).catch(() => null);
  const acquiredFiles = acquisitionStatus?.acquisition?.files ?? [];
  const annualScadaVerified = acquiredFiles.some((file) => file.name?.match(/^20\d{2}\.zip$/) && file.status?.includes("verified"));
  const nwpPointFileFound = await fs.stat(nwpPointFilePath).then(() => true).catch(() => false);
  const pairedTrainingFileFound = await fs.stat(pairedTrainingFilePath).then(() => true).catch(() => false);
  const historicalNwpVerified = nwpPointFileFound && nwpAcquisitionStatus?.acquisition?.status === "point-values-verified";
  const invalidPowerHours = Number(pairingAudit?.counts?.excludedInvalidPowerHours ?? 0);
  const completeHourlyCandidates = Number(pairingAudit?.counts?.completeHourlyCandidates ?? 0);
  const trainingPairRows = Number(pairingAudit?.counts?.trainingPairRows ?? 0);
  const pairingCompleteness = completeHourlyCandidates > 0 ? trainingPairRows / completeHourlyCandidates : 0;
  const cleanWindow = pairingAudit?.cleanWindow ?? null;
  const cleanWindowBlocked = pairedTrainingFileFound && cleanWindow?.eligible === false;
  const qualityBlocked = invalidPowerHours > 0 || (pairedTrainingFileFound && pairingCompleteness < 0.95) || cleanWindowBlocked;

  let status = "blocked-source-download-pending";
  if (annualScadaVerified && !historicalNwpVerified) status = "blocked-historical-nwp-pending";
  if (annualScadaVerified && historicalNwpVerified && !pairedTrainingFileFound) status = "blocked-pairing-pending";
  if (annualScadaVerified && historicalNwpVerified && pairedTrainingFileFound && qualityBlocked) status = "blocked-training-data-quality";
  if (annualScadaVerified && historicalNwpVerified && pairedTrainingFileFound && !qualityBlocked) status = "blocked-curtailment-unknown";

  return {
    checkedAt: new Date().toISOString(),
    predictionUnlocked: false,
    status,
    found: {
      currentGfsForecast: true,
      historicalNwpArchive: historicalNwpVerified,
      observedWindSolarPower: annualScadaVerified,
      pairedTrainingFile: pairedTrainingFileFound,
    },
    qualityGate: {
      status: qualityBlocked ? "blocked" : "passed",
      completeHourlyCandidates,
      trainingPairRows,
      pairingCompleteness: Number(pairingCompleteness.toFixed(4)),
      invalidPowerHours,
      best90DayCompleteness: cleanWindow?.best90DayCompleteness ?? null,
      cleanWindowEligible: cleanWindow?.eligible ?? null,
    },
    sourceCandidates: [...(sourceManifest ? [{
      id: sourceManifest.id,
      name: sourceManifest.name,
      doi: sourceManifest.doi,
      license: sourceManifest.license,
      manifestPinned: true,
      localAcquisitionStatus: acquisitionStatus?.acquisition?.status ?? "download-pending",
      nativeResolutionMinutes: sourceManifest.sourceResolutionMinutes,
    }] : []), ...(nwpManifest ? [{
      id: nwpManifest.id,
      name: nwpManifest.name,
      datasetId: nwpManifest.datasetId,
      manifestPinned: true,
      localAcquisitionStatus: nwpManifest.localStatus,
      localPointFileStatus: historicalNwpVerified ? "point-values-verified" : "download-pending",
      localPairingStatus: pairingAudit?.status ?? "pairing-pending",
      identity: nwpManifest.dataIdentity,
    }] : [])],
    blockers: [
      ...(annualScadaVerified ? [] : ["The selected official wind-farm source is pinned, but no annual SCADA archive has been acquired and verified locally."]),
      ...(historicalNwpVerified ? [] : ["No source-backed historical NWP point file has completed local verification."]),
      ...(pairedTrainingFileFound ? [] : ["No local training pair file built from issue_time and valid_time is present."]),
      ...(invalidPowerHours ? [`${invalidPowerHours} complete hourly windows contain negative or invalid generation labels and were excluded; source-quality remediation is required.`] : []),
      ...(pairedTrainingFileFound && pairingCompleteness < 0.95 ? [`The local 60-minute pair file retains ${trainingPairRows} of ${completeHourlyCandidates} complete hourly candidates (${(pairingCompleteness * 100).toFixed(1)}%), below the 95% temporal completeness gate.`] : []),
      ...(cleanWindowBlocked ? [`The best 90-day clean window reaches ${((cleanWindow.best90DayCompleteness ?? 0) * 100).toFixed(2)}% completeness, below the 95% temporal completeness gate.`] : []),
      "Grid curtailment remains unknown; source-reported PowerRed/PowerRef reduction evidence and shutdown duration cannot be promoted to a curtailment label without an authoritative mapping.",
      ...(pairedTrainingFileFound ? [] : ["No validated 60-minute training pair is present; native 10-minute data does not unlock the 15-minute gate."]),
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--audit-workspace")) {
    console.log(JSON.stringify(await auditForecastWorkspace(), null, 2));
    return;
  }

  const filePath = args.find((argument) => !argument.startsWith("--"));
  if (!filePath) {
    console.error("Usage: node scripts/validate-forecast-training-data.mjs <training.csv|json|ndjson> [--minimum-days N]");
    process.exitCode = 1;
    return;
  }
  const minimumDaysIndex = args.indexOf("--minimum-days");
  const minimumCoverageDays = minimumDaysIndex >= 0 ? Number(args[minimumDaysIndex + 1]) : 90;
  if (!Number.isFinite(minimumCoverageDays) || minimumCoverageDays < 0) {
    throw new RangeError("--minimum-days must be a non-negative number");
  }
  const rows = await loadRows(path.resolve(filePath));
  const result = validateForecastTrainingRows(rows, { minimumCoverageDays });
  console.log(JSON.stringify({ file: path.resolve(filePath), ...result }, null, 2));
  if (!result.gatePassed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
