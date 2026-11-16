import { geoMercator } from "d3-geo";
import {
  Box2, BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, Path, Shape, Vector2, Vector3,
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
    main.add(mesh, lines);
    const coord = properties.centroid ?? properties.center!;
    const { x, y } = projectPowerPoint(coord);
    return [{ code, mesh, lines, fill, side, name: properties.name, anchor: new Vector3(x, y, powerMapDepth) }];
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
