import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

const analysis = new URL("../src/lib/topic-analysis/", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith(analysis.href)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return nextLoad(url, url.startsWith(analysis.href) && url.endsWith(".json") ? { ...context, importAttributes: { type: "json" } } : context);
  },
});

const { buildPowerAnalysis, powerExplorer, powerYears } = await import("../src/lib/topic-analysis/power.ts");
const { powerStory } = await import("../src/lib/topic-analysis/power-insights.ts");

test("年末装机的分项、净增量和文字使用同一年度公报", () => {
  const { charts, metrics } = buildPowerAnalysis("2025");
  assert.deepEqual(metrics.map(item => item.value), ["3,891.34", "542.72", "47.33"]);
  const composition = charts.find(spec => spec.id === "capacity-mix");
  assert.equal(composition.kind, "donut");
  assert.equal(composition.series[0].values.reduce((a, b) => a + b, 0).toFixed(2), "3891.34");
  assert.equal(composition.sources[0].href.endsWith("t20260228_1962662.html"), true);
  assert.match(powerStory("capacity-mix", "2024", "wind-power").highlights[0].text, /2024.+风电.+520.68 GW/);
  assert.match(powerStory("capacity-waterfall", "2025", "solar-power").highlights[1].text, /太阳能.+315.07 GW/);
  assert.match(powerStory("renewable-capacity-share", "2025").sections[1].text, /47.33%.+百分点/);
});

test("各年度净增量等于增量流入扣除减少项，起始年度无需补值", () => {
  for (const year of powerYears.slice(0, -1)) {
    const spec = buildPowerAnalysis(year).charts.find(chart => chart.id === "capacity-waterfall");
    assert.equal(spec.kind, "sankey");
    assert.ok(spec.links.every(item => item.value > 0));
    const arrived = spec.links.filter(item => item.target === "净增量").reduce((sum, item) => sum + item.value, 0);
    assert.equal(arrived.toFixed(2), spec.series[0].values.at(-1).toFixed(2));
  }
  const first = buildPowerAnalysis("2020");
  assert.ok(first.charts.find(spec => spec.id === "capacity-waterfall").series[0].values.every(value => value === null));
  assert.match(powerStory("capacity-waterfall", "2020").highlights[0].text, /缺少上一年度数据/);
  assert.match(powerStory("generation-by-source", "2020", "wind-power").highlights[0].text, /未单列风电/);
  const matrix = powerExplorer("generation", "2020", "风电");
  assert.equal(matrix.series.find(series => series.name === "风电").values[0], null);
  assert.ok(!matrix.labels.includes("2026"));
});
