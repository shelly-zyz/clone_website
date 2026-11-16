import { geoIdentity, geoStream } from "d3-geo";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { ReplayBounds, WeatherReplay } from "@/lib/weather-replay/model";
import { replayRegions, type ReplayRegionId } from "@/lib/weather-replay/regions";

export type ReplayGeography = FeatureCollection<Polygon | MultiPolygon>;
export type Coordinate = [longitude: number, latitude: number];
type Rings = Coordinate[][];

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

/** Preserve Polygon ownership of holes; independent islands must not XOR each other. */
function countryPolygons(geography: ReplayGeography, countries?: readonly string[]): Rings[] {
  return geography.features.filter(feature => !countries || countries.includes(String(feature.id)))
    .flatMap(({ geometry }) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates)
    .map(polygon => polygon.map(ring => ring.map<Coordinate>(([lon, lat]) => [lon, lat])));
}

/** Clip in geographic space before the historical perspective projection.
 * Keep each polygon's rings together, including holes and disconnected pieces.
 */
function clipPolygons(polygons: Rings[], bounds: ReplayBounds): Rings[] {
  const clipped: Rings[] = [];
  const projection = geoIdentity().clipExtent([[bounds.west, bounds.south], [bounds.east, bounds.north]]);
  for (const coordinates of polygons) {
    let polygon: Rings = [];
    let ring: Coordinate[] = [];
    // GeoJSON winding varies between sources; clipping uses a signed winding count.
    const oriented = coordinates.map((points, index) => {
      const signedArea = points.reduce((sum, [x, y], i) => {
        const [nextX, nextY] = points[(i + 1) % points.length];
        return sum + x * nextY - nextX * y;
      }, 0);
      return (signedArea > 0) === (index === 0) ? points : [...points].reverse();
    });
    geoStream({ type: "Polygon", coordinates: oriented }, projection.stream({
      polygonStart() { polygon = []; },
      lineStart() { ring = []; },
      point(lon, lat) { ring.push([lon, lat]); },
      lineEnd() { if (ring.length >= 3) polygon.push(ring); },
      polygonEnd() { if (polygon.length) clipped.push(polygon); },
    }));
  }
  return clipped;
}

export function prepareReplayArea(replay: WeatherReplay, id: ReplayRegionId, geography: ReplayGeography) {
  const { label, land } = replayRegions[id];
  const selected = countryPolygons(geography, land);
  const inCountry = (lon: number, lat: number) => selected.some(polygon => ringsContain(polygon, lon, lat));
  const observed: number[] = [];
  let intersectsCountry = false;
  let crossesCoast = false;
  for (let row = 0; row < replay.rows; row++) {
    for (let col = 0; col < replay.cols; col++) {
      const cell = row * replay.cols + col;
      if (!replay.rain.some(frame => frame.values[cell] != null)
        && !replay.satellite.some(frame => frame.values[cell] != null)) continue;
      observed.push(cell);
      if (inCountry(...gridCoordinate(replay, col, row))) intersectsCountry = true;
      else crossesCoast = true;
    }
  }
  const covered = id === "archive" || intersectsCountry;
  // A coastal archive is one geographic/data domain, including offshore observations.
  // Country selection highlights land; it is never a mask on precipitation or clouds.
  const ocean = covered && (id === "archive" || crossesCoast);
  const context = ocean ? countryPolygons(geography) : selected;
  const polygons = covered ? clipPolygons(context, replay.bounds) : selected;
  const rings = polygons.flat();
  const bounds = covered || !rings.length ? replay.bounds : boundsOf(rings);
  // Give coastal scenes enough landward context to show Florida and Cuba.
  // The data layers still use the original archive bounds.
  const lonSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  const mapBounds = ocean ? {
    west: Math.max(-180, bounds.west - lonSpan * 0.32),
    east: bounds.east,
    south: Math.max(-90, bounds.south - latSpan * 0.16),
    north: Math.min(90, bounds.north + latSpan * 0.16),
  } : bounds;
  const mapPolygons = ocean ? clipPolygons(context, mapBounds) : polygons;
  const focusPolygons = ocean && id !== "archive" ? clipPolygons(selected, mapBounds) : [];
  const contains = (lon: number, lat: number) => covered && lon >= bounds.west && lon <= bounds.east
    && lat >= bounds.south && lat <= bounds.north;
  const cells = covered ? observed : [];
  const hasData = cells.some(cell => replay.rain.some(frame => frame.values[cell] != null));
  return { id, label, bounds, rings, polygons, mapBounds, mapPolygons, focusPolygons, cells, hasData, ocean, contains };
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
