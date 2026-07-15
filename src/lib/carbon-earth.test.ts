import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires an explicit TypeScript extension.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildCarbonHeatCollection, type CarbonFrame } from "./carbon-earth.ts";

test("buildCarbonHeatCollection keeps non-zero cells on their exact grid coordinates", () => {
  const frame: CarbonFrame = {
    date: "2026-04-30",
    sector: "Power",
    unit: "kgC/h",
    grid: {
      width: 4,
      height: 2,
      longitudeMin: -179.5,
      latitudeMax: 89.5,
      dx: 90,
      dy: 90,
    },
    stats: {
      min: 10,
      max: 100,
      mean: 55,
      sumKgCPerHour: 110,
      nonzeroCount: 2,
      nonzeroPercent: 25,
      p50: 55,
      p90: 90,
      p95: 95,
      p99: 100,
      p999: 100,
    },
    sizeBytes: 32,
    endpoint: "/api/carbon-earth",
    values: new Float32Array([
      0, 10, 0, 100,
      0, 0, 0, 0,
    ]),
  };

  const collection = buildCarbonHeatCollection(frame);

  assert.deepEqual(
    collection.features.map((feature) => feature.geometry.coordinates),
    [
      [-89.5, 89.5],
      [90.5, 89.5],
    ],
  );
  assert.equal(collection.features[0]?.properties?.value, 10);
  assert.equal(collection.features[1]?.properties?.value, 100);
  assert.ok((collection.features[0]?.properties?.weight ?? 0) < (collection.features[1]?.properties?.weight ?? 0));
  assert.equal(collection.features[1]?.properties?.weight, 1);
});
