import assert from "node:assert/strict";
import test from "node:test";

import { buildSiteProfile } from "./inspect-hill-of-towie-metadata.mjs";

const turbine = (id, lat, lon) => ({
  "Wind Farm": "Hill of Towie", "Turbine Name": id, Latitude: String(lat), Longitude: String(lon),
  "Station ID": `station-${id}`, Model: "SWT-2.3-VS-82", "Rated power (kW)": "2300",
  "Hub Height (m)": "59", "Rotor Diameter (m)": "82", Country: "UK",
});
const turbineFields = [
  ["Active power", "wtc_ActPower_mean", "kW"],
  ["Time running in period", "wtc_ScInOper_timeon", "seconds"],
  ["Time ready to operate in period", "wtc_ScReToOp_timeon", "seconds"],
  ["Time turbine error active in period", "wtc_ScTurSto_timeon", "seconds"],
].map(([description, name, unit]) => ({ "Field Description": description, "Manufacturer Name": name, Unit: unit }));

test("builds capacity, centroid, power and availability mappings from verified metadata", () => {
  const profile = buildSiteProfile(
    [turbine("T01", 57.5, -3.1), turbine("T02", 57.6, -3.0)],
    turbineFields,
    [{ "Field Description": "Active Power", "Manufacturer Name": "ActivePowerMean", Unit: "MW" }],
  );
  assert.equal(profile.entity.turbineCount, 2);
  assert.equal(profile.entity.installedCapacityMw, 4.6);
  assert.deepEqual(profile.entity.centroid, { latitude: 57.55, longitude: -3.05 });
  assert.equal(profile.observedPower.turbineField, "wtc_ActPower_mean");
  assert.equal(profile.availabilityEvidence.curtailmentField, null);
  assert.equal(profile.recommendedWindow.year, 2025);
  assert.equal(profile.recommendedWindow.status, "recommended-source-window");
});

test("rejects metadata without the availability evidence needed by the gate", () => {
  assert.throws(() => buildSiteProfile([turbine("T01", 57.5, -3.1)], turbineFields.slice(0, 1), []), /Missing required source fields/);
});
