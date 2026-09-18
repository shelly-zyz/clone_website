import assert from "node:assert/strict";
import test from "node:test";
// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { validateEnergyIR } from "./schema.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { publishSemanticCatalog } from "./semantic-catalog.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { instantiateRecipe } from "./recipes.ts";

const validIr = {
  schemaVersion: 1,
  operation: "read",
  intent: "mapped_asset_count",
  metric: "mapped_asset_count",
  entities: { country: "CN", province: "广东", technology: "solar" },
  time: { mode: "none" },
  groupBy: [],
  visualization: "number",
  availabilityRequired: true,
};

test("accepts a grounded, read-only EnergyIR document", () => {
  const result = validateEnergyIR(validIr);
  assert.equal(result.ok, true);
});

test("rejects unknown metrics before compilation", () => {
  const result = validateEnergyIR({ ...validIr, metric: "invented_capacity" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /metric/);
});

test("rejects write, update, and delete operations", () => {
  for (const operation of ["write", "update", "delete"]) {
    const result = validateEnergyIR({ ...validIr, operation });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /read-only/);
  }
});

test("does not publish unreviewed semantic candidates", () => {
  assert.throws(() => publishSemanticCatalog([{
    id: "candidate.metric",
    label: "模型猜测指标",
    kind: "metric",
    source: "model proposal",
    unit: "unknown",
    identity: "mapped-asset-sample",
    version: "0.1.0",
    reviewStatus: "candidate",
    supportedTools: [],
    limitation: "尚未审核",
  }]), /reviewed/);
});

test("reuses a reviewed recipe without changing its metric semantics", () => {
  const guangdong = instantiateRecipe("mapped-solar-assets-by-province", { province: "广东" });
  const shandong = instantiateRecipe("mapped-solar-assets-by-province", { province: "山东" });
  assert.equal(guangdong.ir.metric, "mapped_asset_count");
  assert.equal(shandong.ir.metric, guangdong.ir.metric);
  assert.equal(shandong.ir.entities.technology, "solar");
  assert.equal(shandong.ir.visualization, guangdong.ir.visualization);
  assert.notEqual(shandong.ir.entities.province, guangdong.ir.entities.province);
});
