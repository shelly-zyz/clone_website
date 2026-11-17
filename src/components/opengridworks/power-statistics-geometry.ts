import { geoMercator } from "d3-geo";
import {
  Box2, Box3, BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, Path, Shape, Vector2, Vector3, type Quaternion,
} from "three";

type Coordinate = [number, number];
type Polygon = Coordinate[][];
export type ChinaPowerGeography = {
  features: {
    properties: { name: string; adcode: number | string; centroid?: Coordinate; center?: Coordinate };
    geometry: { type: "Polygon"; coordinates: Polygon } | { type: "MultiPolygon"; coordinates: Polygon[] };
  }[];
};

export const powerMapDepth = 0.22;
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

function ringsToShapes(polygons: Polygon[]) {
  return polygons.map(([outer, ...holes]) => {
    const shape = new Shape(outer.map(projectPowerPoint));
    shape.holes = holes.map(ring => new Path(ring.map(projectPowerPoint)));
    return shape;
  });
}

function outline(polygons: Polygon[], z: number, material: LineBasicMaterial) {
  const positions: number[] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = ring.map(projectPowerPoint);
      for (let index = 1; index < points.length; index++) {
        positions.push(points[index - 1].x, points[index - 1].y, z, points[index].x, points[index].y, z);
      }
    }
  }
  return new LineSegments(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(positions, 3)), material);
}

export function buildPowerGeography(geo: ChinaPowerGeography) {
  // Use the reference map's direct ring projection, hole handling and southern inset partition.
  const main = new Group();
  const inset = new Group();
  const bounds = new Box2();
  const insetBounds = new Box2();
  const boundary = new LineBasicMaterial({ color: "#203e58", transparent: true, opacity: .9 });
  const coast = new LineBasicMaterial({ color: "#8099b0" });
  const insetLand = new MeshBasicMaterial({ color: "#668299" });

  const provinces = geo.features.flatMap(({ properties, geometry }) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const national = properties.name ? polygons.filter(([ring]) => ring.some(point => point[1] >= 18)) : [];
    const southern = polygons.filter(polygon => !national.includes(polygon));
    if (southern.length) {
      for (const polygon of southern) for (const point of polygon[0]) insetBounds.expandByPoint(projectPowerPoint(point));
      const shape = new ExtrudeGeometry(ringsToShapes(southern), { depth: 0, bevelEnabled: false, curveSegments: 1 });
      inset.add(new Mesh(shape, insetLand));
      inset.add(outline(southern, .01, coast));
    }
    if (!national.length) return [];

    for (const polygon of national) for (const point of polygon[0]) bounds.expandByPoint(projectPowerPoint(point));
    const code = String(properties.adcode).padEnd(12, "0");
    const fill = new MeshBasicMaterial();
    const side = new MeshBasicMaterial();
    const mesh = new Mesh(
      new ExtrudeGeometry(ringsToShapes(national), { depth: powerMapDepth, bevelEnabled: false, curveSegments: 1 }),
      [fill, side],
    );
    mesh.userData.code = code;
    const lines = outline(national, powerMapDepth + .008, boundary);
    mesh.geometry.computeBoundingBox();
    lines.geometry.computeBoundingBox();
    const fitBounds = mesh.geometry.boundingBox!.clone().union(lines.geometry.boundingBox!);
    // 同时保留双精度原始轮廓和实际 Float32 挤出几何的边界。
    for (const polygon of national) for (const ring of polygon) for (const point of ring) {
      const { x, y } = projectPowerPoint(point);
      fitBounds.expandByPoint(new Vector3(x, y, 0));
      fitBounds.expandByPoint(new Vector3(x, y, powerMapDepth + .008));
    }
    main.add(mesh, lines);
    const coord = properties.centroid ?? properties.center!;
    const { x, y } = projectPowerPoint(coord);
    return [{ code, mesh, lines, fill, side, fitBounds, name: properties.name, anchor: new Vector3(x, y, powerMapDepth) }];
  });
  return { main, inset, bounds, insetBounds, provinces };
}

export function powerDetailLines(buffer: ArrayBuffer, county: boolean) {
  const data = new DataView(buffer);
  const positions = new Float32Array(buffer.byteLength / 8 * 3);
  for (let offset = 0, index = 0; offset < buffer.byteLength; offset += 8, index += 3) {
    const { x, y } = projectPowerPoint([data.getFloat32(offset, true), data.getFloat32(offset + 4, true)]);
    positions.set([x, y, powerMapDepth + .004], index);
  }
  const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color: "#1d4669", transparent: true, opacity: county ? .17 : .22 });
  return new LineSegments(geometry, material);
}
