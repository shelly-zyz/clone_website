import { NextResponse } from "next/server";
import { publicUrlToDatabasePath } from "@/lib/database-data-path";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeoFeatureRow = {
  feature_id: string | null;
  geometry: unknown;
  properties: Record<string, unknown>;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const publicPath = url.searchParams.get("path");

    if (!publicPath) {
      return NextResponse.json({ error: "A data path is required." }, { status: 400 });
    }

    const sourcePath = publicUrlToDatabasePath(publicPath);
    const result = await queryDatabase<GeoFeatureRow>(
      `SELECT feature_id, geometry, properties
       FROM website_data.geo_features
       WHERE source_path = $1
       ORDER BY feature_index`,
      [sourcePath],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "GeoJSON dataset was not found." }, { status: 404 });
    }

    return NextResponse.json({
      type: "FeatureCollection",
      features: result.rows.map((row) => ({
        type: "Feature",
        ...(row.feature_id === null ? {} : { id: row.feature_id }),
        geometry: row.geometry,
        properties: row.properties,
      })),
    });
  } catch (error) {
    console.error("Database GeoJSON request failed.", error);
    return NextResponse.json({ error: "GeoJSON data is unavailable." }, { status: 503 });
  }
}
