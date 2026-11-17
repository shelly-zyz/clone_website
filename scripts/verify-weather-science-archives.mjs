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

for (const hour of [6, 9, 12, 15, 18]) {
  const stamp = String(hour).padStart(2, "0");
  const wave = JSON.parse(readFileSync(new URL(`../public/earth/data/waves/20220322-${stamp}.json`, import.meta.url)));
  assert.deepEqual([wave.header.lo1, wave.header.la1, wave.header.dx, wave.header.dy, wave.header.nx, wave.header.ny],
    [0, 90, 1, 1, 360, 181]);
  assert.equal(wave.header.forecastTime, hour);
  assert.equal(new Date(wave.header.refTime).toISOString(), "2022-03-22T00:00:00.000Z");
  assert.match(wave.source, new RegExp(`noaa-gfs-bdp-pds.+f0${stamp}\\.grib2$`));
  const packed = ["period", "direction", "height"].map(key => unpack(wave[key]));
  assert(packed.every(field => field.length === 360 * 181 * 2));
  let masked = 0, water = 0;
  for (let offset = 0; offset < packed[0].length; offset += 2) {
    const [period, direction, height] = packed.map(field => field.readInt16LE(offset));
    if (period === -32768 || direction === -32768 || height === -32768) masked++;
    else {
      assert(period > 0 && direction >= 0 && direction <= 3600 && height >= 0);
      water++;
    }
  }
  assert(water > 25000 && masked > 10000, "GFS-Wave includes an ocean field and a real land mask");
}

console.log("PASS: paired ERA5/GFS valid times, GFS-Wave archive and masks");
