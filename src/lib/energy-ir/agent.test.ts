import assert from "node:assert/strict";
import test from "node:test";
// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { runEnergyDataAgent } from "./agent.server.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { ResponsesEnergyPlanner, createConfiguredEnergyPlanner, readEnergyAgentConfig } from "./openai-planner.server.ts";
import type { EnergyIR, EnergyResult } from "./schema";

const validIr: EnergyIR = {
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

const validatedResult: EnergyResult = {
  status: "answered",
  summary: "广东映射样本命中188个；不是官方统计。",
  facts: [{ label: "映射设施数", value: 188, unit: "个" }],
  provenance: [{ source: "local snapshot", identity: "mapped-asset-sample", timeRange: "snapshot", unit: "个", freshness: "unknown", limitation: "不是官方统计。" }],
  limitations: ["不是官方统计。"],
};

test("agent plans with a model, executes one deterministic tool, and validates before answering", async () => {
  let executions = 0;
  const response = await runEnergyDataAgent({ question: "广东有多少已映射光伏设施" }, {
    planner: { id: "fake-model", model: "test", async plan() { return { kind: "query", ir: validIr, message: null, reasonCode: null }; } },
    async execute(plan) {
      executions += 1;
      assert.equal(plan.sql, null);
      assert.equal(plan.readOnly, true);
      return validatedResult;
    },
  });
  assert.equal(executions, 1);
  assert.equal(response.status, "answered");
  assert.equal(response.trace.planner, "fake-model");
  assert.equal(response.trace.validatedBeforeExplanation, true);
  assert.deepEqual(response.result, validatedResult);
});

test("agent blocks a model-proposed write IR before any tool executes", async () => {
  let executed = false;
  const response = await runEnergyDataAgent({ question: "删除设施" }, {
    planner: { id: "fake-model", model: "test", async plan() { return { kind: "query", ir: { ...validIr, operation: "delete" }, message: null, reasonCode: null }; } },
    async execute() { executed = true; return validatedResult; },
  });
  assert.equal(executed, false);
  assert.equal(response.status, "refused");
  assert.equal(response.reasonCode, "invalid-model-ir");
});

test("agent returns model clarification without invoking a tool", async () => {
  let executed = false;
  const response = await runEnergyDataAgent({ question: "这个数据怎么样" }, {
    planner: { id: "fake-model", model: "test", async plan() { return { kind: "clarification", ir: null, message: "请说明数据集。", reasonCode: "dataset-required" }; } },
    async execute() { executed = true; return validatedResult; },
  });
  assert.equal(executed, false);
  assert.equal(response.status, "clarification");
});

test("OpenAI planner is unconfigured unless both key and model are explicit", () => {
  const config = readEnergyAgentConfig({ OPENAI_API_KEY: "", ENERGY_AGENT_MODEL: "" });
  assert.equal(config.configured, false);
  assert.match(config.reason ?? "", /OPENAI_API_KEY/);
});

test("DeepSeek configuration uses its own key, provider label, model, and base URL", () => {
  const environment = {
    ENERGY_AGENT_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "test-deepseek-key",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com/",
    ENERGY_AGENT_MODEL: "deepseek-flash",
  };
  const config = readEnergyAgentConfig(environment);
  assert.equal(config.configured, true);
  assert.equal(config.provider, "deepseek");
  assert.equal(config.model, "deepseek-flash");
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  const configured = createConfiguredEnergyPlanner(environment, async () => new Response(null, { status: 500 }));
  assert.equal(configured.planner?.id, "deepseek-responses-energy-planner");
});

test("DeepSeek configuration never falls back to an OpenAI key", () => {
  const config = readEnergyAgentConfig({
    ENERGY_AGENT_PROVIDER: "deepseek",
    OPENAI_API_KEY: "wrong-provider-key",
    ENERGY_AGENT_MODEL: "deepseek-flash",
  });
  assert.equal(config.configured, false);
  assert.match(config.reason ?? "", /DEEPSEEK_API_KEY/);
});

test("Responses planner requests strict EnergyIR structured output and parses the response", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let requestUrl = "";
  const planner = new ResponsesEnergyPlanner({ provider: "deepseek", apiKey: "test-key", model: "deepseek-flash", baseUrl: "https://api.deepseek.com", timeoutMs: 1000 }, async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "resp_test", output_text: JSON.stringify({ kind: "query", ir: { ...validIr, entities: { ...validIr.entities, province: "广东省", dataset: null, facility: null } }, message: null, reasonCode: null }) }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const decision = await planner.plan({ question: "广东有多少已映射光伏设施", context: {}, history: [] });
  assert.equal(decision.kind, "query");
  assert.equal(decision.ir && typeof decision.ir === "object" ? (decision.ir as EnergyIR).entities.province : null, "广东");
  assert.equal(planner.id, "deepseek-responses-energy-planner");
  assert.equal(requestUrl, "https://api.deepseek.com/responses");
  assert.equal(requestBody?.model, "deepseek-flash");
  assert.equal(requestBody?.store, false);
  assert.equal((requestBody?.reasoning as { effort?: string }).effort, "none");
  assert.equal((requestBody?.text as { format?: { type?: string; strict?: boolean } }).format?.type, "json_schema");
  assert.equal((requestBody?.text as { format?: { type?: string; strict?: boolean } }).format?.strict, true);
  assert.equal("tools" in (requestBody ?? {}), false);
});

test("Responses planner rejects an invalid decision envelope", async () => {
  const planner = new ResponsesEnergyPlanner({ provider: "openai", apiKey: "test-key", model: "test-model", baseUrl: "https://api.test/v1", timeoutMs: 1000 }, async () => {
    return new Response(JSON.stringify({ output_text: JSON.stringify({ kind: "query", ir: null, message: null, reasonCode: null }) }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  await assert.rejects(
    planner.plan({ question: "广东有多少已映射光伏设施", context: {}, history: [] }),
    /query without EnergyIR/,
  );
});
