import { geoIdentity, geoStream } from "d3-geo";
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { ReplayBounds, WeatherReplay } from "@/lib/weather-replay/model";
import { replayRegions, type ReplayRegionId } from "@/lib/weather-replay/regions";

export type ReplayGeography = FeatureCollection<Polygon | MultiPolygon>;
export type Coordinate = [longitude: number, latitude: number];
type Rings = Coordinate[][];

function clipRings(geometry: MultiPolygon, bounds: ReplayBounds): Rings {
  const rings: Rings = [];
  let ring: Coordinate[] = [];
  const projection = geoIdentity().clipExtent([[bounds.west, bounds.south], [bounds.east, bounds.north]]);
  geoStream(geometry, projection.stream({
    point(x, y) { ring.push([x, y]); },
    lineStart() { ring = []; },
    lineEnd() { if (ring.length >= 3) rings.push(ring); },
    polygonStart() {},
    polygonEnd() {},
  }));
  return rings;
}

function ringsContain(rings: Rings, x: number, y: number) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = ring[i];
      const [c, d] = ring[j];
      if ((b > y) !== (d > y) && x < a + (c - a) * (y - b) / (d - b)) inside = !inside;
    }
  }
  return inside;
}

export function gridCoordinate(replay: WeatherReplay, column: number, row: number): Coordinate {
  const { bounds, cols, rows } = replay;
  return [bounds.west + (bounds.east - bounds.west) * column / (cols - 1),
    bounds.south + (bounds.north - bounds.south) * row / (rows - 1)];
}

function boundsOf(rings: Rings) {
  const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      bounds.west = Math.min(bounds.west, lon);
      bounds.east = Math.max(bounds.east, lon);
      bounds.south = Math.min(bounds.south, lat);
      bounds.north = Math.max(bounds.north, lat);
    }
  }
  return bounds;
}

export function prepareReplayArea(replay: WeatherReplay, id: ReplayRegionId, geography: ReplayGeography) {
  const { label, land } = replayRegions[id];
  const countries: readonly string[] = land;
  const coordinates: Position[][][] = geography.features.filter(feature => countries.includes(String(feature.id)))
    .flatMap(({ geometry }) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates);
  const geometry: MultiPolygon = { type: "MultiPolygon", coordinates };
  const clipped = clipRings(geometry, replay.bounds);
  const contains = (lon: number, lat: number) => id === "archive" || ringsContain(clipped, lon, lat);
  const cells: number[] = [];
  for (let row = 0; row < replay.rows; row++) {
    for (let col = 0; col < replay.cols; col++) {
      if (contains(...gridCoordinate(replay, col, row))) cells.push(row * replay.cols + col);
    }
  }
  const hasData = cells.some(cell => replay.rain.some(frame => frame.values[cell] != null));
  // Areas outside the publication retain their full geographic outline and empty data layers.
  const rings: Rings = clipped.length || id === "archive" ? clipped
    : coordinates.flatMap(polygon => polygon.map(ring => ring.map<Coordinate>(([lon, lat]) => [lon, lat])));
  const bounds = id === "archive" || !rings.length ? replay.bounds : boundsOf(rings);
  return { id, label, bounds, rings, cells, hasData, contains };
}

export type ReplayArea = ReturnType<typeof prepareReplayArea>;

export function geographicProjection(bounds: ReplayBounds) {
  const lonCenter = (bounds.west + bounds.east) / 2;
  const latCenter = (bounds.south + bounds.north) / 2;
  const correction = Math.cos(latCenter * Math.PI / 180);
  const span = Math.max((bounds.east - bounds.west) * correction, bounds.north - bounds.south);
  const project = (lon: number, lat: number): [x: number, z: number] => [
    (lon - lonCenter) * correction / span, (latCenter - lat) / span,
  ];
  return { project, width: (bounds.east - bounds.west) * correction / span, depth: (bounds.north - bounds.south) / span };
}

export type GeographicProjection = ReturnType<typeof geographicProjection>;

export function regionalPeak(values: readonly (number | null)[], cells: readonly number[]) {
  let peak: number | null = null;
  for (const cell of cells) {
    const value = values[cell];
    if (value != null && (peak === null || value > peak)) peak = value;
  }
  return peak;
}
