import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// @ts-expect-error direct Node type-stripping test import
import { createRegionMatcher, geometryBounds, normalizeRegionName, pointInGeometry, type RegionGeometry } from "./geometry.ts";

const square: RegionGeometry = { type: "Polygon", coordinates: [[[100, 20], [110, 20], [110, 30], [100, 30], [100, 20]]] };

test("normalizes province names without changing ordinary names", () => {
  assert.equal(normalizeRegionName("新疆维吾尔自治区"), "新疆");
  assert.equal(normalizeRegionName("北京市"), "北京");
  assert.equal(normalizeRegionName("全国"), "全国");
});

test("point containment and bounds support deterministic region filtering", () => {
  assert.equal(pointInGeometry([105, 25], square), true);
  assert.equal(pointInGeometry([115, 25], square), false);
  assert.deepEqual(geometryBounds(square), { minLng: 100, maxLng: 110, minLat: 20, maxLat: 30 });
});

test("prepared region preserves holes, islands and boundary behavior", () => {
  const geometry: RegionGeometry = { type: "MultiPolygon", coordinates: [
    [square.coordinates[0] as [number, number][], [[102, 22], [108, 22], [108, 28], [102, 28], [102, 22]]],
    [[[120, 20], [121, 20], [121, 21], [120, 21], [120, 20]]],
  ] };
  const contains = createRegionMatcher([geometry]);
  for (const [lng, lat] of [[101, 21], [105, 25], [120.5, 20.5], [100, 20], [110, 30], [115, 25]]) {
    assert.equal(contains(lng, lat), pointInGeometry([lng, lat], geometry));
  }
  assert.equal(createRegionMatcher([])(105, 25), false);
});

test("region preparation is reused instead of traversing geometry coordinates per point", () => {
  let reads = 0;
  const geometry: RegionGeometry = { type: "Polygon", get coordinates() { reads += 1; return square.coordinates as [number, number][][]; } };
  const contains = createRegionMatcher([geometry]);
  const preparedReads = reads;
  for (let i = 0; i < 1_000; i += 1) assert.equal(contains(105, 25), true);
  assert.equal(reads, preparedReads);
});

test("all local China facilities retain the same province membership", () => {
  const collection = JSON.parse(readFileSync(new URL("../../../public/data/china-dashboard/provinces.geojson", import.meta.url), "utf8")) as { features: { geometry: RegionGeometry }[] };
  const { energyAssets } = JSON.parse(readFileSync(new URL("../china-map-data.generated.json", import.meta.url), "utf8")) as { energyAssets: { id: string; lng: number; lat: number }[] };
  const geometries = collection.features.map((feature) => feature.geometry);
  const contains = createRegionMatcher(geometries);
  const expected = energyAssets.filter((asset) => geometries.some((geometry) => pointInGeometry([asset.lng, asset.lat], geometry))).map((asset) => asset.id);
  assert.deepEqual(energyAssets.filter((asset) => contains(asset.lng, asset.lat)).map((asset) => asset.id), expected);
});
