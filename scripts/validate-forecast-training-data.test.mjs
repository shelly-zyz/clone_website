import test from "node:test";
import assert from "node:assert/strict";

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { auditForecastWorkspace, parseCsv, validateForecastTrainingRows } from "./validate-forecast-training-data.mjs";

function row(overrides = {}) {
  return {
    entity_id: "wind-farm-001",
    entity_level: "plant",
    technology: "wind",
    entity_latitude: "41.12",
    entity_longitude: "111.84",
    observed_at: "2026-01-01T01:00:00+08:00",
    observed_power_mw: "42.5",
    observed_power_unit: "MW",
    nwp_issue_time: "2025-12-31T16:00:00Z",
    nwp_valid_time: "2025-12-31T17:00:00Z",
    nwp_wind_speed_mps: "8.4",
    installed_capacity_mw: "100",
    available_capacity_mw: "96",
    outage_flag: "0",
    curtailment_flag: "0",
    timezone: "Asia/Shanghai",
    quality_code: "valid",
    data_identity: "observed",
    observation_source: "authorized-scada-export",
    nwp_source: "NOAA GFS archive",
    data_license: "course-use-authorized",
    resolution_minutes: "15",
    ...overrides,
  };
}

test("15-minute observed power paired with issued NWP passes the ultra-short structural gate", () => {
  const result = validateForecastTrainingRows([row()], { minimumCoverageDays: 0 });
  assert.equal(result.valid, true);
  assert.equal(result.gatePassed, true);
  assert.equal(result.eligibility.ultraShortTerm, true);
  assert.equal(result.eligibility.hourlyBaseline, true);
});

test("hourly data passes only the hourly baseline gate", () => {
  const result = validateForecastTrainingRows([row({ resolution_minutes: "60" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, true);
  assert.equal(result.eligibility.hourlyBaseline, true);
  assert.equal(result.eligibility.ultraShortTerm, false);
});

test("climate scenarios cannot be used as observed power labels", () => {
  const result = validateForecastTrainingRows([row({ data_identity: "model_scenario" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /observed/);
});

test("NWP without issue time is rejected to prevent future leakage", () => {
  const result = validateForecastTrainingRows([row({ nwp_issue_time: "" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /nwp_issue_time/);
});

test("unknown timezones are rejected", () => {
  const result = validateForecastTrainingRows([row({ timezone: "China/Unknown" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /timezone/);
});

test("technology-specific NWP predictors are required", () => {
  const result = validateForecastTrainingRows([row({ nwp_wind_speed_mps: "" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /nwp_wind_speed_mps/);
});

test("the default coverage gate keeps short files locked", () => {
  const result = validateForecastTrainingRows([row()]);
  assert.equal(result.valid, true);
  assert.equal(result.gatePassed, false);
  assert.equal(result.eligibility.ultraShortTerm, false);
  assert.match(result.blockers.join("\n"), /90/);
});

test("available capacity cannot exceed installed capacity", () => {
  const result = validateForecastTrainingRows([row({ available_capacity_mw: "101" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /available_capacity_mw/);
});

test("CSV parsing preserves quoted source labels", () => {
  const parsed = parseCsv('entity_id,observation_source\nplant-1,"operator, authorized export"\n');
  assert.deepEqual(parsed, [{ entity_id: "plant-1", observation_source: "operator, authorized export" }]);
});

test("UTC is accepted as an explicit IANA timezone", () => {
  const result = validateForecastTrainingRows([row({ timezone: "UTC" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, true);
});

test("exactly 90 days of complete 15-minute rows meets the coverage gate", () => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const rows = Array.from({ length: 90 * 24 * 4 }, (_, index) => {
    const validTime = start + index * 15 * 60_000;
    return row({
      observed_at: new Date(validTime).toISOString(),
      nwp_valid_time: new Date(validTime).toISOString(),
      nwp_issue_time: new Date(validTime - 3 * 60 * 60_000).toISOString(),
      timezone: "UTC",
    });
  });
  const result = validateForecastTrainingRows(rows);
  assert.equal(result.valid, true);
  assert.equal(result.entities[0].coverageDays, 90);
  assert.equal(result.eligibility.ultraShortTerm, true);
});

test("coordinates outside geographic bounds are rejected", () => {
  const result = validateForecastTrainingRows([row({ entity_latitude: "91" })], { minimumCoverageDays: 0 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /entity_latitude/);
});

test("workspace audit reports a pinned source without pretending it was acquired", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forecast-audit-"));
  const manifestDirectory = path.join(root, "docs/project-management/forecast-sources");
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(path.join(manifestDirectory, "hill-of-towie.json"), JSON.stringify({
    id: "hill-of-towie-v2", name: "Hill of Towie", doi: "10.5281/zenodo.20204946", license: "CC-BY-4.0", sourceResolutionMinutes: 10,
  }));
  const audit = await auditForecastWorkspace(root);
  assert.equal(audit.status, "blocked-source-download-pending");
  assert.equal(audit.found.observedWindSolarPower, false);
  assert.equal(audit.sourceCandidates[0].manifestPinned, true);
  assert.match(audit.blockers.join("\n"), /no annual SCADA archive/i);
});

test("workspace audit reports verified local NWP and preserves the training-quality lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forecast-audit-ready-"));
  const manifestDirectory = path.join(root, "docs/project-management/forecast-sources");
  const scadaDirectory = path.join(root, ".forecast-data/hill-of-towie");
  const nwpDirectory = path.join(root, ".forecast-data/noaa-gfs/hill-of-towie-2025");
  await mkdir(manifestDirectory, { recursive: true });
  await mkdir(scadaDirectory, { recursive: true });
  await mkdir(nwpDirectory, { recursive: true });
  await writeFile(path.join(manifestDirectory, "hill-of-towie.json"), JSON.stringify({
    id: "hill-of-towie-v2", name: "Hill of Towie", doi: "10.5281/zenodo.20204946", license: "CC-BY-4.0", sourceResolutionMinutes: 10,
  }));
  await writeFile(path.join(manifestDirectory, "noaa-gfs-historical.json"), JSON.stringify({
    id: "noaa-gfs", name: "NOAA GFS", datasetId: "DSI 6182", localStatus: "historical-wind-point-values-verified", dataIdentity: "historical-issued-forecast",
  }));
  await writeFile(path.join(scadaDirectory, "acquisition-status.json"), JSON.stringify({ acquisition: { status: "verified", files: [{ name: "2025.zip", status: "verified-md5" }] } }));
  await writeFile(path.join(nwpDirectory, "acquisition-status.json"), JSON.stringify({ acquisition: { status: "point-values-verified" } }));
  await writeFile(path.join(nwpDirectory, "hill-of-towie-2025-gfs-100m.ndjson"), "{}\n");
  await writeFile(path.join(nwpDirectory, "hill-of-towie-2025-training-pairs.ndjson"), "{}\n");
  await writeFile(path.join(nwpDirectory, "pairing-audit.json"), JSON.stringify({
    status: "blocked-observation-quality",
    counts: { excludedInvalidPowerHours: 2155, completeHourlyCandidates: 8760, trainingPairRows: 6605 },
    cleanWindow: { best90DayCompleteness: 0.8583, eligible: false },
  }));

  const audit = await auditForecastWorkspace(root);
  assert.equal(audit.status, "blocked-training-data-quality");
  assert.equal(audit.found.historicalNwpArchive, true);
  assert.equal(audit.found.pairedTrainingFile, true);
  assert.equal(audit.qualityGate.cleanWindowEligible, false);
  assert.equal(audit.qualityGate.best90DayCompleteness, 0.8583);
  assert.match(audit.blockers.join("\n"), /negative or invalid generation labels/i);
  assert.match(audit.blockers.join("\n"), /95% temporal completeness/i);
});
