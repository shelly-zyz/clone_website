import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { compileEnergyQuestion, compileEnergyIR } from "./compiler.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { executeEnergyPlan } from "./executor.server.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { validateEnergyResult } from "./validation.ts";

type Fixture = {
  question: string;
  expected: "planned" | "clarification" | "unavailable" | "refused";
  metric?: string;
  context?: { selectedProvince?: string; selectedLayer?: string };
};

const fixtures = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures.zh.json", import.meta.url)),
  "utf8",
)) as Fixture[];

test("40 gold questions keep their allowed, unavailable, ambiguous, and refused outcomes", () => {
  assert.equal(fixtures.length, 40);
  for (const fixture of fixtures) {
    const result = compileEnergyQuestion(fixture.question, fixture.context);
    assert.equal(result.status, fixture.expected, fixture.question);
    if (fixture.metric && result.status === "planned") {
      assert.equal(result.ir.metric, fixture.metric, fixture.question);
    }
  }
});

test("grounds Guangdong and solar into a deterministic mapped-sample plan", () => {
  const result = compileEnergyQuestion("广东有多少已映射光伏设施");
  assert.equal(result.status, "planned");
  if (result.status !== "planned") return;
  assert.equal(result.ir.entities.province, "广东");
  assert.equal(result.ir.entities.technology, "solar");
  assert.equal(result.plan.tool, "mapped-assets");
  assert.equal(result.plan.readOnly, true);
  assert.equal(result.plan.sql, null);
});

test("uses dashboard context for deictic province and layer questions", () => {
  const province = compileEnergyQuestion("该省有多少风电设施", { selectedProvince: "山东" });
  const layer = compileEnergyQuestion("这个图层现在可用吗", { selectedLayer: "osm-power" });
  assert.equal(province.status, "planned");
  assert.equal(layer.status, "planned");
  if (province.status === "planned") assert.equal(province.ir.entities.province, "山东");
  if (layer.status === "planned") assert.equal(layer.ir.entities.dataset, "osm");
});

test("never compiles a caller-supplied write operation or SQL", () => {
  const result = compileEnergyIR({
    schemaVersion: 1,
    operation: "delete",
    intent: "mapped_asset_count",
    metric: "mapped_asset_count",
    entities: { country: "CN" },
    time: { mode: "none" },
    groupBy: [],
    visualization: "number",
    availabilityRequired: true,
  });
  assert.equal(result.ok, false);
});

test("result validation requires unit and traceable provenance before explanation", () => {
  const invalid = validateEnergyResult({
    status: "answered",
    summary: "广东映射光伏设施为 10 个。",
    facts: [{ label: "设施数", value: 10, unit: "" }],
    provenance: [],
    limitations: [],
  });
  assert.equal(invalid.ok, false);

  const valid = validateEnergyResult({
    status: "answered",
    summary: "当前映射样本返回 10 个，不代表官方统计。",
    facts: [{ label: "映射设施数", value: 10, unit: "个" }],
    provenance: [{
      source: "本地能源设施构建快照",
      identity: "mapped-asset-sample",
      timeRange: "当前构建快照",
      unit: "个",
      freshness: "未记录生成时刻",
      limitation: "映射样本不等于官方统计。",
    }],
    limitations: ["映射样本不等于官方统计。"],
  });
  assert.equal(valid.ok, true);
});

test("filters asset-reader records by Guangdong boundary with PostgreSQL provenance", async () => {
  const compiled = compileEnergyQuestion("广东有多少已映射光伏设施");
  assert.equal(compiled.status, "planned");
  if (compiled.status !== "planned") return;
  const result = await executeEnergyPlan(compiled.plan, process.cwd(), async technology => {
    assert.equal(technology, "solar");
    return [{ name: "boundary test", technology: "solar", capacityMw: 12, source: "test fixture", lat: 23.13, lng: 113.26 }];
  });
  assert.equal(result.status, "answered");
  assert.equal(typeof result.facts[0]?.value, "number");
  assert.ok(Number(result.facts[0]?.value) > 0);
  assert.equal(result.provenance[0]?.identity, "mapped-asset-sample");
  assert.match(result.provenance[0]?.source ?? "", /PostgreSQL/);
  assert.match(result.summary, /不是官方统计/);
  assert.equal(validateEnergyResult(result).ok, true);
});

test("database failure does not silently fall back to a file snapshot", async () => {
  const compiled = compileEnergyQuestion("广东有多少已映射光伏设施");
  if (compiled.status !== "planned") throw new Error("Expected read plan");
  await assert.rejects(executeEnergyPlan(compiled.plan, process.cwd(), async () => { throw new Error("database unavailable"); }), /database unavailable/);
});
