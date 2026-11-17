import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Box3, OrthographicCamera, Vector3 } from "three";

// Node 的类型擦除测试入口需要显式扩展名。
// @ts-expect-error TS5097 仅用于 Node 直接加载测试模块。
import { buildPowerGeography, fitPowerMapBounds, powerMapDepth, projectPowerPoint, type ChinaPowerGeography, type PowerFitViewport } from "./power-statistics-geometry.ts";

const geo: ChinaPowerGeography = JSON.parse(readFileSync(new URL("../../../public/data/china-power/provinces.geojson", import.meta.url), "utf8"));
const geography = buildPowerGeography(geo);
const provinces = ["650000000000", "540000000000", "150000000000", "460000000000", "110000000000"];
const sizes = [[390, 844], [1440, 900], [1024, 768], [900, 650]] as const;

function corners(bounds: Box3) {
  return [bounds.min.x, bounds.max.x].flatMap(x =>
    [bounds.min.y, bounds.max.y].flatMap(y =>
      [bounds.min.z, bounds.max.z].map(z => new Vector3(x, y, z))));
}

function provincePoints(code: string) {
  const province = geography.provinces.find(part => part.code === code)!;
  const feature = geo.features.find(part => String(part.properties.adcode).padEnd(12, "0") === code)!;
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const national = polygons.filter(([ring]) => ring.some(point => point[1] >= 18));
  const points = national.flatMap(polygon => polygon.flatMap(ring => ring.flatMap(point => {
    const { x, y } = projectPowerPoint(point);
    return [new Vector3(x, y, 0), new Vector3(x, y, powerMapDepth + .008)];
  })));
  for (const object of [province.mesh, province.lines]) {
    const positions = object.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) points.push(new Vector3().fromBufferAttribute(positions, index));
  }
  points.push(...corners(province.fitBounds));
  return { province, points, polygons: national.length };
}

function makeCamera(viewport: PowerFitViewport, offset = new Vector3(0, -11, 24)) {
  const { width, height } = viewport;
  const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 100);
  camera.up.set(0, 0, 1);
  camera.position.copy(offset);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function checkFit(points: Vector3[], bounds: Box3, viewport: PowerFitViewport, offset?: Vector3) {
  const camera = makeCamera(viewport, offset);
  const originalBounds = bounds.clone();
  const originalOrientation = camera.quaternion.clone();
  const view = fitPowerMapBounds(bounds, viewport, camera.quaternion);
  assert.ok(Number.isFinite(view.zoom) && view.zoom > 0);
  assert.equal(view.center.z, 0);
  assert.deepEqual(bounds, originalBounds);
  assert.deepEqual(camera.quaternion.toArray(), originalOrientation.toArray());
  camera.position.add(view.center);
  camera.zoom = view.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const { width, height, padding } = viewport;
  let clearance = Infinity;
  for (const point of points) {
    const projected = point.clone().project(camera);
    const x = (projected.x + 1) * width / 2;
    const y = (1 - projected.y) * height / 2;
    const distances = [x - padding.left, width - padding.right - x, y - padding.top, height - padding.bottom - y];
    clearance = Math.min(clearance, ...distances);
    assert.ok(distances.every(value => value >= -1e-6), `包围点被裁：${point.toArray()} → ${x},${y}；安全区 ${JSON.stringify(viewport)}`);
    assert.ok(projected.z >= -1 && projected.z <= 1, "包围点超出相机近远裁面");
  }
  return { zoom: view.zoom, clearance };
}

for (const code of provinces) {
  const { province, points, polygons } = provincePoints(code);
  for (const [width, height] of sizes) {
    for (const fullscreen of [false, true]) {
      const padding = fullscreen
        ? { left: width > 900 ? 280 : 24, right: width > 900 ? 300 : 24, top: 122, bottom: width > 900 ? 140 : 300 }
        : { left: 24, right: 24, top: 32, bottom: 32 };
      test(`${province.name} ${width}×${height} ${fullscreen ? "全屏 UI 留白" : "舞台 canvas"} 包围点全部可见`, context => {
        let zoom = 0;
        for (const columnHeight of [.16, 3.15]) {
          const bounds = province.fitBounds.clone();
          const column = new Box3(
            province.anchor.clone().add(new Vector3(-.127, -.127, 0)),
            province.anchor.clone().add(new Vector3(.127, .127, columnHeight)),
          );
          bounds.union(column);
          const allPoints = [...points, ...corners(column), ...corners(bounds)];
          const result = checkFit(allPoints, bounds, { width, height, padding });
          zoom = result.zoom;
          context.diagnostic(`${polygons} 个主图多边形，${allPoints.length} 个轮廓/挤出/bbox/柱顶点，柱高 ${columnHeight}，安全区最小余量 ${result.clearance.toFixed(6)}px，未裁点 100%`);
        }
        assert.ok(zoom > 0);
      });
    }
  }
}

for (const [width, height] of sizes) {
  test(`全国 ${width}×${height} 包含全部主图挤出与柱顶，南海附图不并入 fit`, context => {
    const points = geography.provinces.flatMap(part => provincePoints(part.code).points);
    const bounds = new Box3();
    for (const part of geography.provinces) {
      bounds.union(part.fitBounds);
      bounds.expandByPoint(part.anchor.clone().add(new Vector3(0, 0, 3.15)));
    }
    points.push(...corners(bounds));
    checkFit(points, bounds, { width, height, padding: { left: 24, right: 24, top: 32, bottom: 32 } });
    assert.ok(geography.inset.children.length > 0);
    assert.ok(!geography.insetBounds.isEmpty());
    context.diagnostic(`全国 ${points.length} 个包围点未裁；南海附图仍独立存在`);
  });
}

test("fit 使用传入的真实相机朝向，而不是固定的斜视缩短系数", () => {
  const { province, points } = provincePoints("150000000000");
  for (const offset of [new Vector3(7, -15, 20), new Vector3(-8, -4, 30)]) {
    checkFit(points, province.fitBounds, { width: 900, height: 650, padding: { left: 250, right: 80, top: 60, bottom: 150 } }, offset);
  }
});

test("省份尺寸和 viewport 决定 zoom，小省不会被全国 maxZoom 裁减", () => {
  const viewport = { width: 1440, height: 900, padding: { left: 24, right: 24, top: 32, bottom: 32 } };
  const camera = makeCamera(viewport);
  const xinjiang = fitPowerMapBounds(provincePoints("650000000000").province.fitBounds, viewport, camera.quaternion);
  const beijing = fitPowerMapBounds(provincePoints("110000000000").province.fitBounds, viewport, camera.quaternion);
  const nationalBounds = new Box3();
  geography.provinces.forEach(part => nationalBounds.union(part.fitBounds));
  const national = fitPowerMapBounds(nationalBounds, viewport, camera.quaternion);
  assert.ok(beijing.zoom > xinjiang.zoom * 5);
  assert.ok(beijing.zoom > national.zoom * 5.5);
  assert.notEqual(fitPowerMapBounds(provincePoints("650000000000").province.fitBounds, { ...viewport, width: 390 }, camera.quaternion).zoom, xinjiang.zoom);
});
