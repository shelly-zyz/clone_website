import { NextResponse } from "next/server";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnergyAssetRow = {
  id: string;
  name: string;
  technology: string;
  capacity_mw: number;
  status: string;
  country_code: string;
  region_id: string | null;
  source: string;
  latitude: number;
  longitude: number;
  properties: Record<string, unknown>;
};

type DataCenterRow = {
  id: string;
  name: string;
  kind: string;
  operator: string | null;
  country_code: string;
  region_id: string | null;
  source: string;
  latitude: number;
  longitude: number;
  properties: Record<string, unknown>;
};

export async function GET() {
  try {
    const [assets, centers] = await Promise.all([
      queryDatabase<EnergyAssetRow>(
        `SELECT * FROM website_data.energy_assets ORDER BY id`,
      ),
      queryDatabase<DataCenterRow>(
        `SELECT * FROM website_data.data_centers ORDER BY id`,
      ),
    ]);

    return NextResponse.json({
      energyAssets: assets.rows.map((row) => ({
        id: row.id,
        name: row.name,
        technology: row.technology,
        capacityMw: row.capacity_mw,
        status: row.status,
        countryCode: row.country_code,
        regionId: row.region_id,
        source: row.source,
        lat: row.latitude,
        lng: row.longitude,
        ...row.properties,
      })),
      dataCenters: centers.rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        operator: row.operator,
        countryCode: row.country_code,
        regionId: row.region_id,
        source: row.source,
        lat: row.latitude,
        lng: row.longitude,
        ...row.properties,
      })),
    });
  } catch (error) {
    console.error("Database map asset request failed.", error);
    return NextResponse.json({ error: "Map asset data is unavailable." }, { status: 503 });
  }
}
