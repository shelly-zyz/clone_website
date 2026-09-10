import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function requireFile(relativePath) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    failures.push(`Missing ${relativePath}`);
  }
}

for (const file of [
  "src/app/china/page.tsx",
  "src/components/china-dashboard/ChinaDashboardShell.tsx",
  "src/components/china-dashboard/ChinaMapScene.tsx",
  "src/components/china-dashboard/LayerControlStrip.tsx",
  "src/components/china-dashboard/OsmPowerTileOverlay.tsx",
  "src/components/china-dashboard/LeftAnalysisRail.tsx",
  "src/components/china-dashboard/PredictionWorkflowRail.tsx",
  "src/components/china-dashboard/DataQualityPanel.tsx",
  "src/app/api/china-dashboard/overview/route.ts",
  "src/app/api/china-dashboard/layers/route.ts",
  "src/app/api/china-dashboard/quality/route.ts",
  "src/app/api/data/vector-tiles/[...slug]/route.ts",
  "src/lib/china-layer-styles.ts",
  "public/data/china-dashboard/provinces.geojson",
  "public/data/china-dashboard/terrain.jpg",
  "public/data/china-dashboard/relief.jpg",
]) {
  requireFile(file);
}

const contract = read("src/lib/china-dashboard.ts");
const workflow = fs.existsSync(path.join(repoRoot, "src/components/china-dashboard/PredictionWorkflowRail.tsx"))
  ? read("src/components/china-dashboard/PredictionWorkflowRail.tsx")
  : "";
const mapScene = read("src/components/china-dashboard/ChinaMapScene.tsx");
const tileOverlay = read("src/components/china-dashboard/OsmPowerTileOverlay.tsx");
const tileStyles = read("src/lib/china-layer-styles.ts");
const tileRoute = read("src/app/api/data/vector-tiles/[...slug]/route.ts");

for (const token of ["official-statistic", "mapped-asset-sample", "interface-only", "output: null"]) {
  if (!contract.includes(token)) failures.push(`Dashboard contract missing ${token}`);
}
for (const token of ["像素", "尚未接入", "workProduct"]) {
  if (!workflow.includes(token)) failures.push(`Prediction workflow missing ${token}`);
}
for (const token of ["/api/data/vector-tiles/", "power_line", "power_generator_point", "minzoom: 5"]) {
  if (!`${tileOverlay}\n${tileStyles}`.includes(token)) failures.push(`Dense tile implementation missing ${token}`);
}
for (const token of ["local-filesystem", "local-filesystem-empty-tile", "status: 204"]) {
  if (!tileRoute.includes(token)) failures.push(`Vector tile route missing ${token}`);
}
if (mapScene.includes("flowLines") || mapScene.includes("M150 240")) failures.push("Map scene still contains decorative fake grid paths");

if (failures.length) {
  console.error("China dashboard validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("China dashboard validation passed.");
