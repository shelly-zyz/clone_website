import "server-only";

import type { StyleSpecification } from "maplibre-gl";
import { Spherical, Vector3 } from "three";
import { readDataAgent } from "@/lib/data-agent/database.server";

const source = "osm_power_points";
const attribution = "© OpenStreetMap contributors";
const defaultBounds: [number, number, number, number] = [70, 15, 135, 55];

export async function powerScene(request: {
  renderer: "maplibre" | "three"; bounds?: [number, number, number, number]; limit?: number;
}, signal: AbortSignal) {
  const [west, south, east, north] = request.bounds ?? defaultBounds;
  if (west >= east || south >= north) return { status: "unsupported" as const, error: "空间范围的西南角必须小于东北角。" };
  const center: [number, number] = [(west + east) / 2, (south + north) / 2];
  const reference = { dataset_id: source, attribution, bounds: [west, south, east, north] };
  if (request.renderer === "maplibre") {
    const style: StyleSpecification = {
      version: 8, projection: { type: "globe" },
      sources: { power: { type: "vector", tiles: ["/api/data/vector-tiles/postgis/{z}/{x}/{y}.pbf"],
        minzoom: 7, maxzoom: 15, bounds: [west, south, east, north], attribution } },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#16383d" } },
        { id: "power", type: "circle", source: "power", "source-layer": source,
          paint: { "circle-radius": 3, "circle-color": "#5ae0a8" } },
      ],
    };
    return { status: "ok" as const, renderer: "maplibre", source: reference, options: { style, center, zoom: 7 } };
  }
  const rows = await readDataAgent(async client => (await client.query<{ lon: number; lat: number }>(`
    SELECT public.ST_X(public.ST_Transform(geom,4326)) AS lon, public.ST_Y(public.ST_Transform(geom,4326)) AS lat
    FROM derived.osm_power_point
    WHERE geom OPERATOR(public.&&) public.ST_Transform(public.ST_MakeEnvelope($1,$2,$3,$4,4326),3857)
    ORDER BY source_path, feature_index LIMIT $5
  `, [west, south, east, north, request.limit ?? 250])).rows);
  signal.throwIfAborted();
  if (!rows.length) return { status: "empty" as const, error: "该范围没有已发布的 OSM 电力点。" };
  const radians = Math.PI / 180;
  const positions = rows.flatMap(({ lon, lat }) =>
    new Vector3().setFromSpherical(new Spherical(1.012, (90 - lat) * radians, lon * radians)).toArray());
  const camera = new Vector3().setFromSpherical(new Spherical(2.7, (90 - center[1]) * radians, center[0] * radians)).toArray();
  return { status: "ok" as const, renderer: "three", source: reference,
    options: { geometry: "sphere", radius: 1, positions, camera, count: rows.length } };
}
