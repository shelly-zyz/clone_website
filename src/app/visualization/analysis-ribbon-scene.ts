import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Series } from "@/lib/topic-analysis/model";
import { analysisTone, researchColors } from "@/lib/topic-analysis/research-palette";

type Reading = { year: string; source: string; value: number };
const width = 10.8;
const height = 5.1;
const depth = 7.4;
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function mountAnalysisRibbonScene(host: HTMLElement, labels: readonly string[], series: readonly Series[], unitLabel: string, capacity: boolean, handlers: {
  inspect: (reading?: Reading) => void;
  select: (reading: Reading) => void;
  unavailable: () => void;
}) {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
  if (!gl) return;
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
  const overlay = document.createElement("canvas");
  const context = overlay.getContext("2d");
  if (!context) { renderer.dispose(); return; }
  host.append(canvas, overlay);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-9, 9, 6, -6, 0.1, 100);
  camera.position.set(8.5, 9.5, 19);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2.3, 0);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = Math.PI / 4.7;
  controls.maxPolarAngle = Math.PI / 2.24;
  controls.minAzimuthAngle = -0.83;
  controls.maxAzimuthAngle = 0.88;
  controls.rotateSpeed = 0.6;
  controls.update();
  controls.saveState();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d9ec, 2.05));
  const light = new THREE.DirectionalLight(0xfff9ee, 2.2);
  light.position.set(-4, 10, 7);
  scene.add(light);
  const maximum = Math.max(0, ...series.flatMap(part => part.values.map(value => value ?? 0)));
  const magnitude = 10 ** Math.floor(Math.log10(maximum / 4 || 1));
  const step = [1, 2, 2.5, 5, 10].find(candidate => candidate >= (maximum / 4) / magnitude) ?? 10;
  const top = capacity ? Math.max(400, 400 * Math.ceil(maximum / 400)) : 4 * step * magnitude;
  const tick = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
  const xs = labels.map((_, i) => -width / 2 + i * width / Math.max(labels.length - 1, 1));
  const ys = [0, 1, 2, 3, 4].map(i => (i / 4) * height);
  const zs = series.map((_, i) => depth / 2 - (i + 0.5) * depth / series.length);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.7, depth + 0.6), new THREE.MeshBasicMaterial({ color: 0xf7f9fc }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.018;
  scene.add(floor);

  function line(points: THREE.Vector3[], color: string, segments = false) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true });
    return segments ? new THREE.LineSegments(geometry, material) : new THREE.Line(geometry, material);
  }

  scene.add(line([
    ...xs.flatMap(x => [vec(x, 0, -depth / 2), vec(x, 0, depth / 2)]),
    ...zs.flatMap(z => [vec(-width / 2, 0, z), vec(width / 2, 0, z)]),
    ...ys.flatMap(y => [vec(-width / 2, y, -depth / 2), vec(width / 2, y, -depth / 2)]),
  ], "#e2e9f2", true));
  scene.add(line([vec(-width / 2, height, -depth / 2), vec(-width / 2, 0, -depth / 2),
    vec(-width / 2, 0, depth / 2), vec(width / 2, 0, depth / 2)], "#c3d1df"));
  const slice = line([vec(0, height, -depth / 2), vec(0, 0, -depth / 2), vec(0, 0, depth / 2)], "#8297bc");
  scene.add(slice);

  const points: { metric: Reading; mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial> }[] = [];
  const pointGeometry = new THREE.SphereGeometry(0.084, 16, 10);
  const bands = series.map((part, index) => {
    const z = zs[index];
    const halfBand = 0.39;
    const tone = researchColors[analysisTone(part.name, index)];
    const base = new THREE.Color(tone.base).lerp(new THREE.Color(tone.ink), 0.18);
    const pale = new THREE.Color(tone.light);
    const pigment = new THREE.Color(tone.base);
    const array: number[] = [];
    const colors: number[] = [];
    function quad(vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3], pigments: [THREE.Color, THREE.Color, THREE.Color, THREE.Color]) {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        array.push(...vertices[i].toArray());
        colors.push(...pigments[i].toArray());
      }
    }
    const crest: THREE.Vector3[] = [];
    const dots = new THREE.MeshPhongMaterial({ color: tone.base, shininess: 38, transparent: true });
    part.values.forEach((value, i) => {
      if (value === null) return;
      const x = xs[i];
      const y = value / top * height;
      const point = new THREE.Mesh(pointGeometry, dots);
      point.position.set(x, y, z + halfBand);
      points.push({ metric: { year: labels[i], source: part.name, value }, mesh: point });
      scene.add(point);
      const previous = part.values[i - 1];
      if (previous === null || previous === undefined) return;
      const a = xs[i - 1];
      const b = previous / top * height;
      quad([vec(a, 0, z + halfBand), vec(x, 0, z + halfBand), vec(x, y, z + halfBand), vec(a, b, z + halfBand)],
        [pale, pale, base, base]);
      quad([vec(a, b, z + halfBand), vec(x, y, z + halfBand), vec(x, y, z - halfBand), vec(a, b, z - halfBand)],
        [pigment, pigment, pale, pale]);
      crest.push(vec(a, b + 0.014, z + halfBand), vec(x, y + 0.014, z + halfBand));
    });
    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(array, 3));
    meshGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    meshGeometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.77, depthWrite: false });
    const ribbon = new THREE.Mesh(meshGeometry, material);
    ribbon.renderOrder = series.length - index;
    const edge = line(crest, tone.ink, true);
    edge.renderOrder = 10;
    scene.add(ribbon, edge);
    return { name: part.name, material, edge: edge.material, dots };
  });

  let selected = labels.at(-1);
  let size = { w: 0, h: 0 };
  let ratio = 1;
  const projected = vec(0, 0, 0);
  function project(pos: THREE.Vector3) {
    projected.copy(pos).project(camera);
    return { x: (projected.x * 0.5 + 0.5) * size.w, y: (-projected.y * 0.5 + 0.5) * size.h };
  }
  function draw() {
    if (!context || !size.w || !size.h) return;
    renderer.render(scene, camera);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.w, size.h);
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.font = "11px Inter, sans-serif";
    context.fillStyle = "#60758d";
    ys.forEach((y, index) => {
      const p = project(vec(-width / 2 - 0.23, y, -depth / 2));
      context.fillText(tick.format(index * top / 4), p.x, p.y);
    });
    const unit = project(vec(-width / 2, height + 0.47, -depth / 2));
    context.fillText(unitLabel, unit.x, unit.y);
    context.textAlign = "center";
    const stride = Math.max(1, Math.ceil(xs.length / Math.max(5, Math.floor(size.w / 54))));
    xs.forEach((x, i) => {
      if (i % stride && selected !== labels[i]) return;
      const p = project(vec(x, 0, depth / 2 + 0.46));
      context.fillStyle = selected === labels[i] ? "#4d5f8e" : "#60758d";
      context.font = `${selected === labels[i] ? "700 " : ""}11px Inter, sans-serif`;
      context.fillText(labels[i], p.x, p.y + 7);
    });
  }

  function pointAt(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    return points.map(({ mesh, metric }) => {
      const p = project(mesh.position);
      return { metric, distance: Math.hypot(p.x - event.clientX + bounds.left, p.y - event.clientY + bounds.top) };
    }).sort((a, b) => a.distance - b.distance).find(point => point.distance <= (event.pointerType === "touch" ? 19 : 11))?.metric;
  }

  let cursorStart: { x: number; y: number } | undefined;
  let dragging = false;
  const down = (event: PointerEvent) => { cursorStart = { x: event.clientX, y: event.clientY }; dragging = true; };
  const move = (event: PointerEvent) => {
    const point = dragging ? undefined : pointAt(event);
    host.dataset.point = point ? "true" : "false";
    handlers.inspect(point);
  };
  const up = (event: PointerEvent) => {
    dragging = false;
    if (cursorStart && Math.hypot(event.clientX - cursorStart.x, event.clientY - cursorStart.y) <= 5) {
      const point = pointAt(event);
      if (point) handlers.select(point);
    }
  };
  const leave = () => { dragging = false; handlers.inspect(); delete host.dataset.point; };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("pointercancel", leave);
  canvas.addEventListener("webglcontextlost", handlers.unavailable);
  controls.addEventListener("change", draw);

  const resize = new ResizeObserver(() => {
    size = { w: host.clientWidth, h: host.clientHeight };
    if (!size.w || !size.h) return;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(size.w, size.h, false);
    overlay.width = size.w * ratio;
    overlay.height = size.h * ratio;
    const aspect = size.w / size.h;
    const extent = Math.max(4.92, 7.65 / aspect);
    camera.left = -extent * aspect; camera.right = extent * aspect;
    camera.top = extent; camera.bottom = -extent;
    camera.updateProjectionMatrix();
    draw();
  });
  resize.observe(host);
  return {
    update(year?: string, highlight?: string) {
      selected = year;
      slice.position.x = xs[labels.indexOf(year ?? "")] ?? xs[xs.length - 1];
      const filter = series.some(part => part.name === highlight);
      for (const band of bands) {
        const dim = filter && band.name !== highlight;
        band.material.opacity = dim ? 0.28 : 0.77;
        band.edge.opacity = dim ? 0.36 : 0.88;
        band.dots.opacity = dim ? 0.42 : 1;
      }
      for (const { metric, mesh } of points) mesh.scale.setScalar(metric.year === year ? 1.68 : 0.82);
      draw();
    },
    rotate(direction: number) {
      const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      orbit.theta = THREE.MathUtils.clamp(orbit.theta + direction * 0.21, controls.minAzimuthAngle, controls.maxAzimuthAngle);
      camera.position.setFromSpherical(orbit).add(controls.target);
      controls.update();
    },
    zoom(factor: number) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.83, 1.35); camera.updateProjectionMatrix(); draw(); },
    reset() { camera.zoom = 1; camera.updateProjectionMatrix(); controls.reset(); draw(); },
    dispose() {
      resize.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointercancel", leave);
      canvas.removeEventListener("webglcontextlost", handlers.unavailable);
      controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      overlay.remove();
    },
  };
}
