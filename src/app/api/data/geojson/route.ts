import { promises as fs } from "node:fs";
import path from "node:path";
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
  let publicPath: string | null = null;
  try {
    const url = new URL(request.url);
    publicPath = url.searchParams.get("path");

    if (!publicPath) {
      return NextResponse.json({ error: "A data path is required." }, { status: 400 });
    }

    const localPreview = await readLocalTransmissionPreview(publicPath);
    if (localPreview) return localPreview;

    const sourcePath = publicUrlToDatabasePath(publicPath);
    const result = await queryDatabase<GeoFeatureRow>(
      `SELECT feature_id, geometry, properties
       FROM website_data.geo_features
       WHERE source_path = $1
       ORDER BY feature_index`,
      [sourcePath],
    );

    if (result.rows.length === 0) {
      const local = await readLocalGeoJson(publicPath);
      if (local) {
        return geoJsonResponse(local, "local-filesystem");
      }
      return NextResponse.json({ error: "GeoJSON dataset was not found." }, { status: 404 });
    }

    return geoJsonResponse({
      type: "FeatureCollection",
      features: result.rows.map((row) => ({
        type: "Feature",
        ...(row.feature_id === null ? {} : { id: row.feature_id }),
        geometry: row.geometry,
        properties: row.properties,
      })),
    }, "postgresql");
  } catch (error) {
    console.warn("Database GeoJSON request failed; trying the checked-in local source.", error);
    if (publicPath) {
      const local = await readLocalGeoJson(publicPath);
      if (local) {
        return geoJsonResponse(local, "local-filesystem");
      }
    }
    return NextResponse.json({ error: "GeoJSON data is unavailable." }, { status: 503 });
  }
}

function isLocalTransmissionPreview(publicPath: string) {
  return [
    "/data/osm-power/china-transmission-preview.geojson",
    "/data/osm-power/china-transmission-detail-preview.geojson",
  ].includes(publicPath);
}

type GeoJsonCollection = {
  type: "FeatureCollection";
  features: unknown[];
};

function geoJsonResponse(collection: GeoJsonCollection, source: "postgresql" | "local-filesystem") {
  return NextResponse.json(collection, {
    headers: {
      "Cache-Control": source === "local-filesystem" ? "public, max-age=300" : "public, max-age=60",
      "X-Data-Source": source,
    },
  });
}

function localGeoJsonPath(publicPath: string) {
  if (!publicPath.startsWith("/data/") || !publicPath.endsWith(".geojson") || publicPath.includes("..")) return null;
  const publicRoot = path.resolve(process.cwd(), "public");
  const candidate = path.resolve(publicRoot, publicPath.slice(1));
  if (!candidate.startsWith(publicRoot + path.sep)) return null;
  return candidate;
}

async function readLocalTransmissionPreview(publicPath: string): Promise<NextResponse | null> {
  if (!isLocalTransmissionPreview(publicPath)) return null;
  const candidate = localGeoJsonPath(publicPath);
  if (!candidate) return null;
  try {
    const content = await fs.readFile(candidate);
    return new NextResponse(new Uint8Array(content), {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": "application/geo+json",
        "X-Data-Source": "local-filesystem",
      },
    });
  } catch {
    return null;
  }
}

async function readLocalGeoJson(publicPath: string): Promise<GeoJsonCollection | null> {
  const candidate = localGeoJsonPath(publicPath);
  if (!candidate) return null;
  try {
    const value = JSON.parse(await fs.readFile(candidate, "utf8")) as Partial<GeoJsonCollection>;
    if (value.type !== "FeatureCollection" || !Array.isArray(value.features)) return null;
    return { type: "FeatureCollection", features: value.features };
  } catch {
    return null;
  }
}
