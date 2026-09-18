import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildChinaLayerCatalog } from "@/lib/china-dashboard";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OsmSummary = { counts?: { tiles?: number } };

export async function GET() {
  const publicRoot = path.join(process.cwd(), "public");
  const [terrainAvailable, provinceGeometryAvailable, weatherCacheAvailable, osmSummary, pvFootprintSummaryAvailable, vreScenarioAvailable, databaseLayers] = await Promise.all([
    exists(path.join(publicRoot, "data", "china-dashboard", "terrain.jpg")),
    exists(path.join(publicRoot, "data", "china-dashboard", "provinces.geojson")),
    exists(path.join(process.cwd(), ".weather-cache", "manifest.json")),
    readJson<OsmSummary>(path.join(publicRoot, "data", "osm-power", "summary.json")),
    exists(path.join(publicRoot, "data", "china-pv", "solar-footprints-summary.json")),
    exists(path.join(publicRoot, "data", "climate-vre", "manifest.json")),
    readDatabaseLayerAvailability(),
  ]);

  return NextResponse.json(buildChinaLayerCatalog({
    terrainAvailable,
    provinceGeometryAvailable,
    weatherAvailable: weatherCacheAvailable && databaseLayers.weatherAvailable,
    osmTileCount: osmSummary?.counts?.tiles ?? 0,
    osmSnapshotDate: "2026-05-17",
    pvFootprintSummaryAvailable,
    gracedAvailable: databaseLayers.gracedAvailable,
    vreScenarioAvailable,
  }));
}

async function readDatabaseLayerAvailability() {
  const [weatherAvailable, gracedAvailable] = await Promise.all([
    hasRows("SELECT count(*)::text AS count FROM website_data.weather_forecast_fields WHERE source='GFS'"),
    hasRows("SELECT count(*)::text AS count FROM website_data.carbon_emission_frames WHERE sector='Power'"),
  ]);
  return { weatherAvailable, gracedAvailable };
}

async function hasRows(sql: string) {
  try {
    const result = await queryDatabase<{ count: string }>(sql);
    return Number(result.rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
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
