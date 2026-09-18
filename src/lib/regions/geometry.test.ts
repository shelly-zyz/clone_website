import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error direct Node type-stripping test import
import { geometryBounds, normalizeRegionName, pointInGeometry, type RegionGeometry } from "./geometry.ts";

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
