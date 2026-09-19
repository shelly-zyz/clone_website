export type Position = [number, number];
export type PolygonGeometry = { type: "Polygon"; coordinates: Position[][] };
export type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: Position[][][] };
export type RegionGeometry = PolygonGeometry | MultiPolygonGeometry;

const provinceSuffix = /(壮族|回族|维吾尔)?自治区|特别行政区|省|市/g;

export function normalizeRegionName(name: string) {
  return name.trim().replace(provinceSuffix, "");
}

export function pointInGeometry(point: Position, geometry: RegionGeometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

// Prepare each polygon once; point queries only inspect rings within its bounds.
// Keeping the original rings preserves the existing hole/boundary semantics.
export function createRegionMatcher(geometries: RegionGeometry[]) {
  const polygons = geometries.flatMap((geometry) => (
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates
  )).map((rings) => ({ rings, bounds: geometryBounds({ type: "Polygon", coordinates: rings }) }));
  return (lng: number, lat: number) => polygons.some(({ rings, bounds }) => (
    lng >= bounds.minLng && lng <= bounds.maxLng && lat >= bounds.minLat && lat <= bounds.maxLat
    && pointInPolygon([lng, lat], rings)
  ));
}

function pointInPolygon(point: Position, rings: Position[][]) {
  if (!rings[0] || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((ring) => pointInRing(point, ring));
}

function pointInRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function geometryBounds(geometry: RegionGeometry) {
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  const points = rings.flat();
  return points.reduce((bounds, [lng, lat]) => ({
    minLng: Math.min(bounds.minLng, lng),
    maxLng: Math.max(bounds.maxLng, lng),
    minLat: Math.min(bounds.minLat, lat),
    maxLat: Math.max(bounds.maxLat, lat),
  }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });
}
