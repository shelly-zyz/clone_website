import { vectorTileSlugToDatabasePath } from "@/lib/database-data-path";
import { queryDatabase } from "@/lib/db";
import { readDataAgent } from "@/lib/data-agent/database.server";

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
  try {
    const { slug } = await params;
    if (slug[0] === "postgis") {
      const coordinates = slug.slice(1).join("/").match(/^(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.pbf$/);
      if (!coordinates) return new Response("Invalid tile coordinates.", { status: 400 });
      const [z, x, y] = coordinates.slice(1).map(Number);
      if (z < 7 || z > 15 || x >= 2 ** z || y >= 2 ** z) return new Response("Tile coordinates are out of range.", { status: 400 });
      const content = await readDataAgent(async (client) => {
        const { rows } = await client.query<{ tile: Buffer }>("SELECT derived.osm_power_point_tile($1,$2,$3) AS tile", [z, x, y]);
        return rows[0].tile;
      });
      return new Response(new Uint8Array(content), { headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile", "Cache-Control": "public, max-age=300",
      } });
    }
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

    const headers = new Headers({
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    });
    if (tile.content_encoding) {
      headers.set("Content-Encoding", tile.content_encoding);
    }

    return new Response(new Uint8Array(tile.content), { headers });
  } catch (error) {
    console.error("Database vector tile request failed.", error);
    return new Response("Vector tile data is unavailable.", { status: 503 });
  }
}
