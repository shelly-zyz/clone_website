import { NextResponse } from "next/server";
import { queryDatabase } from "@/lib/db";
import { mapJsonResponse } from "@/lib/map-json-response";

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

const assetPageSize = 1_024;
const energyAssetColumns = "id, name, technology, capacity_mw, status, country_code, region_id, source, latitude, longitude, properties";

async function readEnergyAssets(afterId: string | null) {
  const result = afterId
    ? await queryDatabase<EnergyAssetRow>(
      "SELECT " + energyAssetColumns + " FROM website_data.energy_assets WHERE id > $1 ORDER BY id LIMIT $2",
      [afterId, assetPageSize + 1],
    )
    : await queryDatabase<EnergyAssetRow>(
      "SELECT " + energyAssetColumns + " FROM website_data.energy_assets ORDER BY id LIMIT $1",
      [assetPageSize + 1],
    );
  const hasMore = result.rows.length > assetPageSize;
  const rows = result.rows.slice(0, assetPageSize);
  const nextCursor = hasMore ? rows.at(-1)?.id ?? null : null;
  if (hasMore && (!nextCursor || nextCursor === afterId)) {
    throw new Error("Energy asset pagination did not advance.");
  }
  return { rows, nextCursor };
}

export async function GET(request: Request) {
  try {
    const afterId = new URL(request.url).searchParams.get("after");
    if (afterId !== null && !/^[a-zA-Z0-9._:-]{1,128}$/.test(afterId)) {
      return NextResponse.json({ error: "Invalid map asset cursor." }, { status: 400 });
    }

    const [assets, centers] = await Promise.all([
      readEnergyAssets(afterId),
      afterId === null ? queryDatabase<DataCenterRow>(
        `SELECT id, name, kind, operator, country_code, region_id, source, latitude, longitude, properties
         FROM website_data.data_centers ORDER BY id`,
      ) : Promise.resolve({ rows: [] as DataCenterRow[] }),
    ]);

    return mapJsonResponse(request, {
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
      nextCursor: assets.nextCursor,
    });
  } catch (error) {
    console.error("Database map asset request failed.", error);
    return NextResponse.json({ error: "Map asset data is unavailable." }, { status: 503 });
  }
}
