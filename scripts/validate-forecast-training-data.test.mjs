import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv, validateForecastTrainingRows } from "./validate-forecast-training-data.mjs";

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
