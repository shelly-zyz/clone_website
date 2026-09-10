import { promises as fs } from "node:fs";
import path from "node:path";
import { CHINA_OSM_TILESET_VERSION } from "@/lib/china-layer-styles";
import { vectorTileSlugToDatabasePath } from "@/lib/database-data-path";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VectorTileRow = {
  content: Buffer;
  content_encoding: string | null;
};

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/data/vector-tiles/[...slug]">,
) {
  const { slug } = await params;
  const localTile = await readLocalVectorTile(slug);
  if (localTile) {
    return tileResponse(localTile.content, localTile.contentEncoding, "local-filesystem", "public, max-age=31536000, immutable");
  }
  if (slug[0] === CHINA_OSM_TILESET_VERSION) {
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Data-Source": "local-filesystem-empty-tile",
      },
    });
  }

  try {
    const tilePath = vectorTileSlugToDatabasePath(slug);
    const result = await queryDatabase<VectorTileRow>(
      `SELECT content, content_encoding
       FROM website_data.vector_tiles
       WHERE path = $1`,
      [tilePath],
    );
    const tile = result.rows[0];

    if (!tile) {
      return new Response("Vector tile not found.", { status: 404 });
    }

    return tileResponse(tile.content, tile.content_encoding, "postgresql", "public, max-age=3600, stale-while-revalidate=86400");
  } catch (error) {
    console.error("Database vector tile request failed.", error);
    return new Response("Vector tile data is unavailable.", { status: 503 });
  }
}

async function readLocalVectorTile(slug: string[]) {
  vectorTileSlugToDatabasePath(slug);
  const tilesRoot = path.resolve(process.cwd(), "public", "data", "osm-power", "tiles");
  const candidate = path.resolve(tilesRoot, ...slug);
  if (!candidate.startsWith(`${tilesRoot}${path.sep}`) || path.extname(candidate).toLowerCase() !== ".pbf") {
    return null;
  }

  try {
    const content = await fs.readFile(candidate);
    const contentEncoding = content[0] === 0x1f && content[1] === 0x8b ? "gzip" : null;
    return { content, contentEncoding };
  } catch {
    return null;
  }
}

function tileResponse(content: Uint8Array, contentEncoding: string | null, dataSource: string, cacheControl: string) {
  const headers = new Headers({
    "Content-Type": "application/vnd.mapbox-vector-tile",
    "Cache-Control": cacheControl,
    "X-Data-Source": dataSource,
  });
  if (contentEncoding) headers.set("Content-Encoding", contentEncoding);
  return new Response(new Uint8Array(content), { headers });
}
