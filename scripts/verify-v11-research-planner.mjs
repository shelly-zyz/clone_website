import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../src/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    const url = specifier.startsWith("@/") ? new URL(specifier.slice(2), root)
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL) : null;
    if (url?.href.startsWith(root) && existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    return next(specifier, context);
  },
});

const { planFigure } = await import("../src/lib/visualization-agent/research/planner.ts");

const iso = (day) => "2026-04-" + String(day).padStart(2, "0") + "T00:00:00.000Z";
const stamp = (value, i, region = "CN-TEST") => ({
  timestamp: iso(i + 1), label: String(i + 1), region_id: region, value, quality_flag: Number(value === null),
});
function evidence(domain, title, unit, values, extra = {}) {
  const rows = values.map((value, i) => stamp(value, i));
  const data = {
    dataset_id: "verification-fixture", metric_id: title, series_id: title, title, domain, source_id: "fixture",
    dimensions: { shape: "time", time_grain: "day" }, time_zone: "UTC", unit, data_type: "observation",
    source_url: ["https://example.test/data"], source_version: "a".repeat(64), observation_time: { start: iso(1), end: iso(values.length) },
    publication_time: null, retrieved_at: iso(1), last_updated_at: null, is_forecast: false, model_id: null, model_version: null,
    forecast_origin: null, forecast_horizon: null, interval_method: null, transform_history: [], aggregation_method: "fixture",
    sample_count: values.length, validation_status: "valid", truncated: false, rows, missing_mask: rows.map(row => row.value === null),
    quality_flags: rows.map(row => row.quality_flag), ...extra,
  };
  return { data, profile: { ...data, missing: values.filter(value => value === null).length,
    min: Math.min(...values.filter(value => value !== null)), max: Math.max(...values.filter(value => value !== null)),
    digest: title, query: { kind: "approved", id: title } } };
}
const draw = (items, configuration = {}) => planFigure({ task_id: "unit-test",
  configuration: { datasets: items.map(item => item.profile.query), ...configuration } }, items, ["echarts", "flint", "matplotlib"]);

test("axis uses a null break for absent periods, preserving both zero and explicit missing values", () => {
  const source = evidence("electricity", "Series", "MW", [0, null, -5, 9],
    { rows: [stamp(0, 0), stamp(null, 1), stamp(-5, 3), stamp(9, 4)] });
  const trend = draw([source], { kind: "trend" });
  assert.deepEqual(trend.model.panels[0].x, [1, 2, 3, 4, 5].map(iso));
  assert.deepEqual(trend.model.panels[0].series[0].data, [0, null, null, -5, 9]);
});

test("scoped alignment activates the two domain skills and excludes incomplete pairings", () => {
  const electricity = evidence("electricity", "Load", "MW", [1, 2, null, 4, 5, 6]);
  const meteorology = evidence("meteorology", "Temperature", "°C", [2, 4, 6, 8, 10, 12]);
  const result = draw([electricity, meteorology], { kind: "correlation" });
  assert.ok(result.plan.skills.includes("electricity-visualization"));
  assert.ok(result.plan.skills.includes("meteorology-visualization"));
  assert.equal(new Set(result.plan.skills).size, result.plan.skills.length);
  assert.equal(result.statistics["配对样本"], 5);
  assert.equal(result.statistics.pearson_r, 1);
  assert.equal(result.insights.at(-1).label, "相关分析");
  meteorology.data.rows[0].region_id = "GLOBAL";
  assert.throws(() => draw([electricity, meteorology], { kind: "scatter" }), { code: "INCOMPATIBLE" });
});

test("confirmed prediction intervals and paired errors produce three units-consistent panels", () => {
  const observations = [10, 13, 11, 15, 17, 16];
  const project = evidence("carbon", "Rate", "kgC/h", observations);
  const forecast = evidence("carbon", "Rate", "kgC/h", [9, 15, 11, 16, 14, 17], {
    forecast_origin: iso(1), forecast_horizon: { start: iso(1), end: iso(6) }, interval_method: "fixture P10-P90", model_id: "fixture",
    is_forecast: true, data_type: "forecast", rows: [9, 15, 11, 16, 14, 17].map((number, i) =>
      ({ ...stamp(number,i), actual: observations[i], bounds: [number - 1, number + 2] })),
  });
  forecast.profile.query = { kind: "forecast-job", job_id: "fixture" };
  const chart = draw([project, forecast], { kind: "forecast-diagnostics" });
  assert.deepEqual(chart.model.panels.map(p => p.kind), ["forecast", "columns", "box"]);
  assert.deepEqual(chart.model.panels[0].series[1].interval[0], [8, 11]);
  assert.deepEqual(chart.model.panels[1].series[0].data, [-1, 2, 0, 1, -3, 1]);
  assert.equal(chart.statistics["MAE fixture"], 1.3333333333);
  assert.throws(() => draw([project, forecast], { kind: "forecast-diagnostics", engine: "flint" }), { code: "INCOMPATIBLE" });
});

test("market price distributions and disabled renderers produce explicit choices", () => {
  const source = evidence("electricity", "Market settlement", "元/MWh", [0, -10, 5, 20, 15, 14, 9, 12, 1, 25]);
  assert.equal(draw([source], { kind: "violin" }).plan.renderer, "matplotlib");
  assert.equal(draw([source], { kind: "box" }).model.panels[0].series[0].data[1], -10);
  assert.throws(() => draw([source], { kind: "box", mode: "paper", style: { theme: "dark-analytics" } }), { code: "INCOMPATIBLE" });
  assert.throws(() => draw([source], { kind: "surface" }), { code: "ENGINE_UNAVAILABLE" });
});

test("flow requires conserved intermediate nodes and grid preserves masked values", () => {
  const source = evidence("carbon", "Flow", "tCO2", [6, 6], {
    dimensions: { shape: "flow", time_grain: "none" }, rows: [{ ...stamp(6, 0), label: "A", target: "B" }, { ...stamp(6, 1), label: "B", target: "C" }],
  });
  assert.equal(draw([source]).model.panels[0].links.length, 2);
  source.data.rows[1].value = 4;
  assert.throws(() => draw([source]), { code: "INCOMPATIBLE" });
  const grid = evidence("meteorology", "Rain", "mm/h", [0, null, 2, 1], {
    dimensions: { shape: "grid", time_grain: "frame", coordinates: "EPSG:4326" }, grid: { lon: [15, 16], lat: [52, 51] },
    rows: [0, null, 2, 1].map((value, i) => ({ ...stamp(value, 0), coordinates: [15 + i % 2, 52 - Math.floor(i / 2)] })),
  });
  assert.deepEqual(draw([grid]).model.panels[0].cells, [[0, 0, 0], [0, 1, 2], [1, 1, 1]]);
});
