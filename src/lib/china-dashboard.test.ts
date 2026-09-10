import assert from "node:assert/strict";
import test from "node:test";

// Node's type-stripping test runner requires an explicit TypeScript extension.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildChinaDashboardOverview, buildChinaDashboardQuality, buildChinaLayerCatalog, type ChinaOfficialTotals } from "./china-dashboard.ts";
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { buildChinaOsmLayerDefinitions, buildVoltageFilter, CHINA_OSM_TILE_SOURCE } from "./china-layer-styles.ts";

const officialTotals: ChinaOfficialTotals = {
  year: 2024,
  installedCapacityMw: {
    source: "National Energy Administration",
    sourceUrl: "https://example.test/nea",
    total: 3_348_620,
    hydro: 435_950,
    thermal: 1_444_450,
    nuclear: 60_830,
    wind: 520_680,
    solar: 886_660,
  },
  generationGwh: {
    source: "National Bureau of Statistics",
    sourceUrl: "https://example.test/nbs",
    total: 10_086_880,
    thermal: 6_374_260,
    hydro: 1_425_680,
    nuclear: 450_850,
    wind: 997_040,
    solar: 839_040,
    cleanEnergy: 3_712_600,
  },
};

test("overview keeps official totals separate from mapped asset samples", () => {
  const overview = buildChinaDashboardOverview({
    officialTotals,
    mappedSample: {
      count: 9_143,
      capacityMw: 3_992_160.7,
      sourceCount: 5,
    },
  });

  assert.equal(overview.official.identity, "official-statistic");
  assert.equal(overview.official.installedCapacityMw.total, 3_348_620);
  assert.equal(overview.mappedSample.identity, "mapped-asset-sample");
  assert.equal(overview.mappedSample.count, 9_143);
  assert.notEqual(overview.mappedSample.capacityMw, overview.official.installedCapacityMw.total);
  assert.match(overview.mappedSample.note, /样本|坐标/);
});

test("overview exposes an unavailable mapped sample without turning it into an official zero", () => {
  const overview = buildChinaDashboardOverview({
    officialTotals,
    mappedSample: null,
  });

  assert.equal(overview.official.status, "available");
  assert.equal(overview.mappedSample.status, "unavailable");
  assert.equal(overview.mappedSample.count, null);
  assert.equal(overview.mappedSample.capacityMw, null);
  assert.match(overview.mappedSample.reason ?? "", /数据库|不可用/);
});

test("prediction workflow remains interface-only and never returns fabricated output", () => {
  const overview = buildChinaDashboardOverview({ officialTotals, mappedSample: null });

  assert.equal(overview.prediction.identity, "interface-only");
  assert.equal(overview.prediction.status, "unavailable");
  assert.equal(overview.prediction.output, null);
  assert.match(overview.prediction.reason, /未接入|不生成/);
});

test("layer catalog identifies terrain, geometry, tile, and live-field sources", () => {
  const layers = buildChinaLayerCatalog({
    terrainAvailable: true,
    provinceGeometryAvailable: true,
    osmTileCount: 53,
    osmSnapshotDate: "2026-05-17",
    weatherAvailable: false,
    pvFootprintSummaryAvailable: true,
    gracedAvailable: false,
    vreScenarioAvailable: true,
  });

  assert.deepEqual(
    layers.layers.map((layer) => [layer.id, layer.identity, layer.status]),
    [
      ["terrain", "geometry", "available"],
      ["provinces", "geometry", "available"],
      ["osm-power", "mapped-asset-sample", "available"],
      ["pv-footprint", "research-estimate", "partial"],
      ["gfs-weather", "live-field", "unavailable"],
      ["graced-power", "research-estimate", "unavailable"],
      ["vre-scenario", "model-scenario", "available"],
    ],
  );
});

test("quality ledger records official sources as non-GIS evidence", () => {
  const quality = buildChinaDashboardQuality({ officialTotals, mappedSourceCount: 5 });
  const official = quality.sources.find((source) => source.identity === "official-statistic");

  assert.equal(official?.usedAsGeometry, false);
  assert.match(official?.scope ?? "", /总量校验/);
  assert.equal(quality.predictionReady, false);
  const osm = quality.sources.find((source) => source.id === "osm-power-tiles");
  assert.equal(osm?.timeRange, "2026-05-17 snapshot");
  assert.match(osm?.limitation ?? "", /调度拓扑/);
});

test("dense OSM layers use bounded vector tiles with progressive zoom thresholds", () => {
  const definitions = buildChinaOsmLayerDefinitions();

  assert.match(CHINA_OSM_TILE_SOURCE.tiles[0] ?? "", /^\/api\/data\/vector-tiles\//);
  assert.equal(CHINA_OSM_TILE_SOURCE.minzoom, 3);
  assert.equal(CHINA_OSM_TILE_SOURCE.maxzoom, 5);
  assert.deepEqual(definitions.map((layer) => [layer.id, layer.sourceLayer, layer.minzoom]), [
    ["china-osm-line-glow", "power_line", 3],
    ["china-osm-line-main", "power_line", 3],
    ["china-osm-plant", "power_plant_point", 4],
    ["china-osm-substation", "power_substation_point", 4.4],
    ["china-osm-generator", "power_generator_point", 5],
  ]);
});

test("voltage filters are deterministic and an empty selection hides all line classes", () => {
  assert.deepEqual(buildVoltageFilter([]), ["==", 1, 0]);
  const filter = buildVoltageFilter(["1000", "500"]);
  assert.equal(filter[0], "in");
  assert.deepEqual(filter.slice(-2), ["1000", "500"]);
});
