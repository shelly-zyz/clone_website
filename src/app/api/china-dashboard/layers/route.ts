import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildChinaLayerCatalog } from "@/lib/china-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OsmSummary = { counts?: { tiles?: number } };

export async function GET() {
  const publicRoot = path.join(process.cwd(), "public");
  const [terrainAvailable, provinceGeometryAvailable, weatherAvailable, osmSummary, pvFootprintSummaryAvailable, vreScenarioAvailable, gracedAvailable] = await Promise.all([
    exists(path.join(publicRoot, "data", "china-dashboard", "terrain.jpg")),
    exists(path.join(publicRoot, "data", "china-dashboard", "provinces.geojson")),
    exists(path.join(process.cwd(), ".weather-cache", "manifest.json")),
    readJson<OsmSummary>(path.join(publicRoot, "data", "osm-power", "summary.json")),
    exists(path.join(publicRoot, "data", "china-pv", "solar-footprints-summary.json")),
    exists(path.join(publicRoot, "data", "climate-vre", "manifest.json")),
    exists(path.join(publicRoot, "data", "carbon-earth", "manifest.json")),
  ]);

  return NextResponse.json(buildChinaLayerCatalog({
    terrainAvailable,
    provinceGeometryAvailable,
    weatherAvailable,
    osmTileCount: osmSummary?.counts?.tiles ?? 0,
    osmSnapshotDate: "2026-05-17",
    pvFootprintSummaryAvailable,
    gracedAvailable,
    vreScenarioAvailable,
  }));
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}
