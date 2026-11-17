import { geoMercator } from "d3-geo";
import {
  Box2, Box3, BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, Path, Shape, Vector2, Vector3, type Quaternion,
} from "three";

type Coordinate = [number, number];
type Polygon = Coordinate[][];
export type ChinaPowerGeography = {
  features: {
    properties: { name: string; adcode: number | string; centroid?: Coordinate; center?: Coordinate };
    geometry: { type: "Polygon"; coordinates: Polygon } | { type: "MultiPolygon"; coordinates: Polygon[] };
  }[];
};

export const powerMapDepth = .56;
export const powerMapRelief = .75;
export const powerSelectionLift = .14;
export const powerPlatformBottom = -.56;

export function powerProvinceHeight(value: number | null, maximum: number) {
  const ratio = value == null || maximum <= 0 ? 0 : Math.min(1, Math.abs(value) / maximum);
  return powerMapDepth + Math.sqrt(ratio) * powerMapRelief;
}
export const powerProjection = geoMercator().center([104, 35]).scale(14).translate([0, 0]);

export function projectPowerPoint([lng, lat]: Coordinate) {
  const [x, y] = powerProjection([lng, lat])!;
  return new Vector2(x, -y);
}

export type PowerFitPadding = { left: number; right: number; top: number; bottom: number };
export type PowerFitViewport = { width: number; height: number; padding: PowerFitPadding };

export function fitPowerMapBounds(bounds: Box3, viewport: PowerFitViewport, orientation: Quaternion) {
  const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const up = new Vector3(0, 1, 0).applyQuaternion(orientation);
  const back = new Vector3(0, 0, 1).applyQuaternion(orientation);
  const projected = new Box2();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new Vector3(x, y, z);
        projected.expandByPoint(new Vector2(point.dot(right), point.dot(up)));
      }
    }
  }
  const { width, height, padding } = viewport;
  const size = projected.getSize(new Vector2());
  const zoom = Math.min(
    Math.max(1, width - padding.left - padding.right) / Math.max(size.x, Number.EPSILON),
    Math.max(1, height - padding.top - padding.bottom) / Math.max(size.y, Number.EPSILON),
  );
  const middle = projected.getCenter(new Vector2());
  const center = right.multiplyScalar(middle.x - (padding.left - padding.right) / (2 * zoom))
    .addScaledVector(up, middle.y - (padding.bottom - padding.top) / (2 * zoom));
  // 沿视线落回地图平面，保存经纬度相机后仍能精确还原同一投影中心。
  center.addScaledVector(back, -center.z / back.z);
  center.z = 0;
  return { center, zoom };
}

function ringsToShapes(polygons: Vector2[][][]) {
  return polygons.map(([outer, ...holes]) => {
    const shape = new Shape(outer);
    shape.holes = holes.map(ring => new Path(ring));
    return shape;
  });
}

function topRim(polygons: Vector2[][][]) {
  const positions: number[] = [];
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (!a.equals(b)) positions.push(a.x, a.y, powerMapDepth + .007, b.x, b.y, powerMapDepth + .007);
    }
  }
  const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new LineSegments(geometry, new LineBasicMaterial({
    color: "#d0bedd", transparent: true, opacity: .15, depthWrite: false,
  }));
}

export function buildPowerGeography(geo: ChinaPowerGeography) {
  // Use the reference map's direct ring projection, hole handling and southern inset partition.
  const main = new Group();
  const inset = new Group();
  const platformShapes: Shape[] = [];
  const bounds = new Box2();
  const insetBounds = new Box2();
  const insetLand = new MeshBasicMaterial({ color: "#668299" });

  const provinces = geo.features.flatMap(({ properties, geometry }) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const national = properties.name ? polygons.filter(([ring]) => ring.some(point => point[1] >= 18)) : [];
    const southern = polygons.filter(polygon => !national.includes(polygon));
    if (southern.length) {
      for (const polygon of southern) for (const point of polygon[0]) insetBounds.expandByPoint(projectPowerPoint(point));
      const shape = new ExtrudeGeometry(ringsToShapes(southern.map(polygon => polygon.map(ring => ring.map(projectPowerPoint)))), { depth: 0, bevelEnabled: false, curveSegments: 1 });
      inset.add(new Mesh(shape, insetLand));
    }
    if (!national.length) return [];

    for (const polygon of national) for (const point of polygon[0]) bounds.expandByPoint(projectPowerPoint(point));
    const code = String(properties.adcode).padEnd(12, "0");
    const polygons2d = national.map(polygon => polygon.map(ring => ring.map(projectPowerPoint)));
    const shapes = ringsToShapes(polygons2d);
    platformShapes.push(...shapes);
    const fill = new MeshLambertMaterial({ toneMapped: false });
    const side = new MeshLambertMaterial({ toneMapped: false });
    const mesh = new Mesh(
      new ExtrudeGeometry(shapes, { depth: powerMapDepth, bevelEnabled: false, curveSegments: 1 }),
      [fill, side],
    );
    mesh.userData.code = code;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const edge = topRim(polygons2d);
    mesh.add(edge);
    mesh.geometry.computeBoundingBox();
    const fitBounds = mesh.geometry.boundingBox!.clone();
    // 同时保留双精度原始轮廓和实际 Float32 挤出几何的边界。
    for (const polygon of polygons2d) for (const ring of polygon) for (const { x, y } of ring) {
      fitBounds.expandByPoint(new Vector3(x, y, 0));
      fitBounds.expandByPoint(new Vector3(x, y, powerMapDepth));
    }
    main.add(mesh);
    const coord = properties.centroid ?? properties.center!;
    const { x, y } = projectPowerPoint(coord);
    return [{ code, mesh, edge, fill, side, fitBounds, name: properties.name, anchor: new Vector3(x, y, powerMapDepth) }];
  });
  const platform = new Mesh(
    new ExtrudeGeometry(platformShapes, { depth: .33, bevelEnabled: false, curveSegments: 1 }),
    [new MeshLambertMaterial({ color: "#162442" }), new MeshLambertMaterial({
      color: "#26395c", emissive: "#14122e", emissiveIntensity: .45,
    })],
  );
  platform.position.z = powerPlatformBottom;
  platform.receiveShadow = true;
  return { main, inset, platform, bounds, insetBounds, provinces };
}
