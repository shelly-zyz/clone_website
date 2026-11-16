import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = name => JSON.parse(readFileSync(new URL("../public/data/weather-replay/" + name, import.meta.url), "utf8"));
const unpack = bytes => Buffer.from(bytes, "base64");

const global = data("global-20220322.json");
assert.equal(global.schema, 1);
assert.deepEqual([global.cols, global.rows, global.step], [120, 61, 3]);
assert.equal(global.frames.length, 4);
for (const [i, frame] of global.frames.entries()) {
  assert.equal(Date.parse(frame.time) - Date.parse(global.run), (i + 1) * 6 * 3600000);
  assert.match(frame.forecastSource, /noaa-gfs-bdp-pds/);
  assert.deepEqual(Object.keys(frame.fields), ["t2m", "u10", "z500", "t850", "v10"]);
  assert.equal(frame.fields.v10.quantum, frame.fields.u10.quantum);
  assert.equal(frame.fields.v10.unit, "m/s");
  for (const source of ["analysis", "forecast"]) {
    const meridional = unpack(frame.fields.v10[source]);
    assert(!meridional.equals(unpack(frame.fields.u10[source])), "the wind streams use both components");
    const values = Array.from({ length: meridional.length / 2 }, (_, i) => meridional.readInt16LE(i * 2))
      .filter(value => value !== -32768);
    assert(values.some(value => value > 50) && values.some(value => value < -50), "winds have northward and southward components");
  }
  for (const field of Object.values(frame.fields)) {
    const a = unpack(field.analysis), b = unpack(field.forecast);
    assert.equal(a.length, global.cols * global.rows * 2);
    assert.equal(b.length, a.length);
    assert(!a.equals(b), "analysis and forecast preserve distinct inputs");
  }
}

const radar = data("radar-khgx-20220322.json");
assert.match(radar.sha256, /^[a-f0-9]{64}$/);
assert.deepEqual([radar.x.length, radar.y.length, radar.z.length], [91, 91, 19]);
const reflectivity = unpack(radar.values);
assert.equal(reflectivity.length, 91 * 91 * 19);
assert(reflectivity.includes(128), "radar has a real missing mask");
assert(reflectivity.some(value => value > 50 && value < 90), "radar has strong observed echoes");
assert.deepEqual(radar.meshes.map(mesh => mesh.dbz), [20, 35, 50]);
for (const mesh of radar.meshes) {
  const vertices = unpack(mesh.vertices), faces = unpack(mesh.faces);
  assert.equal(vertices.length % 6, 0);
  assert.equal(faces.length % 12, 0);
  assert(vertices.length > 0 && faces.length > 0);
  for (let i = 0; i < faces.length; i += 4) assert(faces.readUInt32LE(i) < vertices.length / 6);
}

const wind = data("wind-wrf-20050828.json");
assert.match(wind.sha256, /^[a-f0-9]{64}$/);
assert.equal(wind.x.length, wind.y.length);
assert(wind.x.at(-1) - wind.x[0] >= 400, "horizontal coordinates are in km");
assert.equal(wind.frames.length, 4);
for (const frame of wind.frames) {
  const vectors = unpack(frame.vectors);
  assert.equal(vectors.length, wind.x.length * wind.levels.length * 8);
  const vertical = Array.from({ length: vectors.length / 8 }, (_, i) => vectors.readInt16LE(i * 8 + 4))
    .filter(value => value !== -32768);
  assert(vertical.some(value => value > 20) && vertical.some(value => value < -20), "archive resolves both vertical directions");
  assert(frame.surfaceMean >= 10 && frame.surfaceMean <= 20);
}
console.log("PASS: paired ERA5/GFS valid times, NEXRAD masks and mesh topology, WRF U/V/W and km coordinates");
