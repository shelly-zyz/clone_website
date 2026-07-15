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
  try {
    const { slug } = await params;
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
