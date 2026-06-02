import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const failures = [];

function absolutePath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function readText(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function checkIncludes(text, needle, message) {
  check(text.includes(needle), `${message}: missing ${needle}`);
}

function isChinaCoordinate(asset) {
  return (
    typeof asset.lat === "number" &&
    typeof asset.lng === "number" &&
    asset.lat >= 18 &&
    asset.lat <= 54 &&
    asset.lng >= 73 &&
    asset.lng <= 136
  );
}

function walkJson(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkJson(entry, visit));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      visit(key, entry);
      walkJson(entry, visit);
    }
  }
}

function hasForbiddenCoordinateKey(value) {
  let found = false;
  walkJson(value, (key) => {
    if (key === "lat" || key === "lng" || key === "latitude" || key === "longitude") {
      found = true;
    }
  });
  return found;
}

function hasForbiddenPvCapacityField(value) {
  let found = false;
  walkJson(value, (key, entry) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "capacitypolicy") {
      return;
    }
    if ((lowerKey.includes("capacity") || lowerKey.endsWith("mw")) && typeof entry !== "string") {
      found = true;
    }
  });
  return found;
}

const mapShell = readText("src/components/opengridworks/MapAppShell.tsx");
const mockMapData = readText("src/lib/mock-map-data.ts");
const normalizedMockMapData = mockMapData.replace(/\r\n/g, "\n");
checkIncludes(mapShell, "/data/osm-power/tiles/china-260517-osm-z3-5-20260519-plants-generators/{z}/{x}/{y}.pbf", "local China OSM power tile URL");
checkIncludes(mapShell, "/data/osm-power/china-transmission-preview.geojson", "local China transmission preview GeoJSON URL");
checkIncludes(mapShell, "/data/osm-power/china-transmission-detail-preview.geojson", "local China transmission detail GeoJSON URL");
checkIncludes(mapShell, '"source-layer": "power_plant_point"', "local OSM plant layer");
checkIncludes(mapShell, "本地 OSM 电源项目", "local OSM asset legend");
checkIncludes(mapShell, 'badge: "LOCAL"', "local OSM layer card");
checkIncludes(mapShell, "Local China OSM extract", "SourcesPanel local OSM source");
checkIncludes(mapShell, "const defaultRegion = regions[0]", "Initial camera should keep the default global view");
checkIncludes(mapShell, "function promoteLocalOsmTransmissionLayers", "Local transmission lines should be promoted above fill overlays");
checkIncludes(mapShell, 'moveLayerBefore(map, layerId, "ne-land-outline-glow")', "Local transmission lines should render above heatmap and country fills");
checkIncludes(mapShell, "useState(hiddenLayerState)", "Initial view should keep business layers off until the user enables them");
checkIncludes(mapShell, "useState(hiddenVoltageState)", "Initial transmission voltage filters should stay off while transmission is off");
checkIncludes(mapShell, 'enablingLayer && key === "transmission"', "Transmission toggle should handle China local tile visibility");
checkIncludes(mapShell, "setVisibleVoltageClasses(voltageState())", "Turning on transmission should enable transmission voltage filters");
check(!mapShell.includes("Math.max(chinaTarget.zoom, 3.75)"), "Turning on transmission should not auto-zoom to China");
check(!mapShell.includes('activeRegion.id !== "china" || mapCamera.zoom < 3'), "Turning on transmission should keep the current map camera");
checkIncludes(mapShell, "minzoom: 1.4", "Transmission preview should be visible from the default global zoom");
checkIncludes(mapShell, "chinaTransmissionPreviewLoadedRef", "Turning on transmission should lazy-load a lightweight China line preview");
checkIncludes(mapShell, "chinaTransmissionDetailLoadedRef", "Turning on transmission should lazy-load detailed China line preview by zoom");
checkIncludes(mapShell, "map.getZoom() >= chinaTransmissionDetailMinZoom", "Detailed China transmission preview should wait for a useful zoom");
checkIncludes(mapShell, "china-transmission-detail-main", "Detailed China transmission layer should be rendered separately from trunk preview");
check(
  !mapShell.includes('"*",\n    ["interpolate", ["linear"], ["zoom"]') &&
    !mapShell.includes('"*",\n      ["interpolate", ["linear"], ["zoom"]'),
  "Transmission line-width expressions must keep zoom as the top-level interpolate expression"
);
check(
  normalizedMockMapData.includes("export const gridLines: GridLine[] = [\n  ...chinaGridLines,\n];"),
  "Default GeoJSON gridLines should only include real China grid lines"
);
for (const forbiddenLineToken of [
  'id: "tx-',
  "global-tx-",
  "global-interconnector-",
  "...globalMockInfrastructure.gridLines",
]) {
  check(!mockMapData.includes(forbiddenLineToken), `Mock transmission token should not be present: ${forbiddenLineToken}`);
}

const generated = readJson("src/lib/china-map-data.generated.json");
const energyAssets = Array.isArray(generated.energyAssets) ? generated.energyAssets : [];
const dataCenters = Array.isArray(generated.dataCenters) ? generated.dataCenters : [];
check(energyAssets.length > 0, "Generated China energy assets should be non-empty");
check(dataCenters.length > 0, "Generated China data centers should be non-empty");
check(energyAssets.every(isChinaCoordinate), "Every generated energy asset must have a China bbox coordinate");
check(dataCenters.every(isChinaCoordinate), "Every generated data center must have a China bbox coordinate");
check(
  dataCenters.every((asset) => asset.review_source && asset.reviewed_at && asset.coordinate_confidence),
  "Rendered data centers should keep review_source/reviewed_at/coordinate_confidence"
);

const sourceSummaries = Array.isArray(generated.meta?.sources) ? generated.meta.sources : [];
check(sourceSummaries.length > 0, "Generated data should include meta.sources");
for (const source of sourceSummaries) {
  for (const key of ["rows_read", "rows_used", "rows_enriched", "rows_rejected"]) {
    check(Object.hasOwn(source, key), `Source summary ${source.name ?? "(unknown)"} missing ${key}`);
  }
}

check(
  energyAssets.some((asset) => String(asset.source).startsWith("Global Power Plant Database") && asset.owner),
  "WRI assets should preserve at least one owner"
);
check(
  energyAssets.some((asset) => String(asset.source).startsWith("Global Energy Monitor") && (asset.owner || asset.operator || asset.sourceId)),
  "GEM assets should preserve owner/operator/sourceId enrichment"
);

const manualReviewHeader = readText("docs/research/opengridworks/peeringdb-cn-manual-review.csv").split(/\r?\n/, 1)[0];
for (const key of ["review_source", "reviewed_at", "coordinate_confidence"]) {
  check(manualReviewHeader.split(",").includes(key), `PeeringDB manual review CSV missing ${key}`);
}

const osmSummary = readJson("public/data/osm-power/summary.json");
const chinaTransmissionPreview = readJson("public/data/osm-power/china-transmission-preview.geojson");
const chinaTransmissionDetailPreview = readJson("public/data/osm-power/china-transmission-detail-preview.geojson");
const chinaTransmissionPreviewSize = fs.statSync(absolutePath("public/data/osm-power/china-transmission-preview.geojson")).size;
const chinaTransmissionDetailPreviewSize = fs.statSync(absolutePath("public/data/osm-power/china-transmission-detail-preview.geojson")).size;

function geoJsonClasses(collection) {
  return new Set(
    Array.isArray(collection.features)
      ? collection.features.map((feature) => String(feature.properties?.voltageClass ?? ""))
      : [],
  );
}

function maxMultiLineParts(collection) {
  return Math.max(
    0,
    ...(Array.isArray(collection.features)
      ? collection.features.map((feature) => {
        const coordinates = feature.geometry?.coordinates;
        return feature.geometry?.type === "MultiLineString" && Array.isArray(coordinates) ? coordinates.length : 1;
      })
      : []),
  );
}

check(osmSummary.counts?.lines >= 199001, "Local OSM line count regressed below the 199,001 baseline");
check(osmSummary.counts?.substations >= 37069, "Local OSM substation count regressed below the 37,069 baseline");
check(
  Array.isArray(chinaTransmissionPreview.features) && chinaTransmissionPreview.features.length > 0,
  "Local China transmission preview should contain renderable line features"
);
check(
  Array.isArray(chinaTransmissionDetailPreview.features) && chinaTransmissionDetailPreview.features.length > 0,
  "Detailed China transmission preview should contain renderable line features"
);
const trunkClasses = geoJsonClasses(chinaTransmissionPreview);
const detailClasses = geoJsonClasses(chinaTransmissionDetailPreview);
for (const expectedClass of ["1000", "750"]) {
  check(trunkClasses.has(expectedClass), `China transmission trunk preview missing ${expectedClass}`);
}
for (const expectedClass of ["500", "220", "110", "35", "low"]) {
  check(detailClasses.has(expectedClass), `China transmission detail preview missing ${expectedClass}`);
}
check(chinaTransmissionPreviewSize < 3 * 1024 * 1024, "China transmission trunk preview should stay lightweight");
check(chinaTransmissionDetailPreviewSize < 10 * 1024 * 1024, "China transmission detail preview should stay lightweight");
check(maxMultiLineParts(chinaTransmissionPreview) <= 900, "China transmission trunk preview should avoid giant MultiLineString features");
check(maxMultiLineParts(chinaTransmissionDetailPreview) <= 900, "China transmission detail preview should avoid giant MultiLineString features");
check(Number.isFinite(osmSummary.counts?.plants), "Local OSM summary should include plant counts");
check(Number.isFinite(osmSummary.counts?.generators), "Local OSM summary should include generator counts");
if (osmSummary.counts?.plants === 0) {
  check(typeof osmSummary.stats?.plant_features_missing_reason === "string", "Zero local OSM plants requires an explicit reason");
}
if (osmSummary.counts?.generators === 0) {
  check(typeof osmSummary.stats?.generator_features_missing_reason === "string", "Zero local OSM generators requires an explicit reason");
}

const pvSummary = readJson("public/data/china-pv/solar-footprints-summary.json");
const pvSources = Array.isArray(pvSummary.sources) ? pvSummary.sources : [];
check(pvSources.some((source) => String(source.name).includes("CPVPD-2024")), "PV summary should include CPVPD-2024");
check(pvSources.some((source) => String(source.name).includes("ChinaPV")), "PV summary should include ChinaPV");
check(!hasForbiddenPvCapacityField(pvSummary), "PV footprint summary must not include numeric capacity fields");

const officialTotals = readJson("public/data/china-validation/official-totals.json");
const coverageSummary = readJson("public/data/china-validation/coverage-summary.json");
check(!hasForbiddenCoordinateKey(officialTotals), "Official totals must not contain coordinate fields");
check(!hasForbiddenCoordinateKey(coverageSummary), "Coverage summary must not contain coordinate fields");
check(Array.isArray(coverageSummary.installedCapacityCoverage), "Coverage summary should include installedCapacityCoverage");
check(
  coverageSummary.nonGisAssertion?.officialTotalsUsedAsGisSource === false,
  "Official totals should be marked as non-GIS validation data"
);

const riskCandidate = readJson("public/data/china-validation/coastal-risk-candidate.json");
check(riskCandidate.renderByDefault === false, "Coastal risk candidate must not render by default");

if (failures.length > 0) {
  console.error("China data validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("China data validation passed.");
