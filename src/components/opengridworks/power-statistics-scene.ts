import {
  AmbientLight, Box2, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Float32BufferAttribute, LineBasicMaterial,
  Mesh, MeshStandardMaterial, MOUSE, OrthographicCamera, Raycaster, Scene, Sprite, SpriteMaterial, SRGBColorSpace, TOUCH,
  Vector2, Vector3, WebGLRenderer, LineSegments, type BufferGeometry, type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { powerAmount, powerMapColors, powerMapNoData, provincePowerRatio, type ProvincePowerFrame } from "@/lib/china-power-statistics";
import type { MapCameraState } from "@/types/opengridworks";
import { buildPowerGeography, powerDetailLines, powerProjection, projectPowerPoint, type ChinaPowerGeography } from "./power-statistics-geometry";

const cameraOffset = new Vector3(0, -11, 24);
const maximumHeight = 3.15;
const pixelsPerUnit = 512 / (Math.PI * 2 * powerProjection.scale());
const palette = powerMapColors.map(color => new Color(color));
const noData = new Color(powerMapNoData);

type View = { center: Vector3; zoom: number };
type Callbacks = {
  onCamera: (camera: MapCameraState) => void;
  onHover: (value: { x: number; y: number; title: string; subtitle: string; color: string } | null) => void;
  onSelect: (code: string) => void;
};

function scaleColor(ratio: number) {
  const stop = ratio * (palette.length - 1);
  const left = Math.min(palette.length - 2, Math.floor(stop));
  return palette[left].clone().lerp(palette[left + 1], stop - left);
}

function buildColumn() {
  const geometry = new CylinderGeometry(.009, .127, 1, 6, 1);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let index = 0; index < geometry.attributes.position.count; index++) {
    colors.fill(geometry.attributes.position.getY(index) > 0 ? 1 : .66, index * 3, index * 3 + 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, .5);
  return geometry;
}

function makeLabel(text: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "600 22px Inter, system-ui, sans-serif";
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.height = 36;
  ctx.font = font;
  ctx.fillStyle = "#102236";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 7);
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e5f2ff";
  ctx.fillText(text, 12, 19);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.center.set(.5, 0);
  sprite.renderOrder = 3;
  return { sprite, width: canvas.width / 2, height: canvas.height / 2 };
}

function mapCenter(bounds: Box2) {
  const center = bounds.getCenter(new Vector2());
  return new Vector3(center.x, center.y + .28, 0);
}

export function createPowerStatisticsScene(canvas: HTMLCanvasElement, geo: ChinaPowerGeography, callbacks: Callbacks) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.autoClear = false;
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  const { main, inset, bounds, insetBounds, provinces } = buildPowerGeography(geo);
  const scene = new Scene();
  const insetScene = new Scene();
  const insetCamera = new OrthographicCamera(-1, 1, 1, -1, .1, 20);
  const insetCenter = insetBounds.getCenter(new Vector2());
  insetCamera.position.set(insetCenter.x, insetCenter.y, 5);
  insetScene.add(inset);
  scene.add(main, new AmbientLight("#e1f2ff", 1.65));
  const key = new DirectionalLight("#e9f6ff", 2.1);
  key.position.set(-8, -6, 12);
  scene.add(key);
  const fillLight = new DirectionalLight("#b8d6ff", .8);
  fillLight.position.set(7, -7, 8);
  scene.add(fillLight);

  const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 100);
  camera.up.set(0, 0, 1);
  const center = mapCenter(bounds);
  camera.position.copy(center).add(cameraOffset);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableRotate = false;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
  controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN };
  controls.zoomSpeed = .85;
  controls.update();

  const columnGeometry = buildColumn();
  const highlighted = new LineBasicMaterial({ color: "#e1f3ff" });
  const originalBoundary = provinces[0].lines.material;
  const parts = provinces.map(province => {
    const column = new Mesh(columnGeometry, new MeshStandardMaterial({ vertexColors: true, roughness: .63 }));
    column.userData.code = province.code;
    column.position.copy(province.anchor);
    main.add(column);
    return { ...province, column, value: null as number | null };
  });
  const byCode = new Map(parts.map(part => [part.code, part]));
  const targets = parts.flatMap(part => [part.mesh, part.column]);
  const labels: ReturnType<typeof makeLabel>[] = [];
  const boundaries = new Map<string, LineSegments>();
  const requested = new Set<string>();
  const controller = new AbortController();
  const ray = new Raycaster();
  let width = 1;
  let height = 1;
  let fit = 1;
  let animation = 0;
  let drawRequest = 0;
  let frame: ProvincePowerFrame | undefined;

  function queueRender() {
    if (!drawRequest) drawRequest = requestAnimationFrame(draw);
  }

  function syncDetails() {
    for (const [level, threshold] of [["city", .95], ["county", 2.6]] as const) {
      const visible = camera.zoom / fit >= threshold;
      const layer = boundaries.get(level);
      if (layer) layer.visible = visible;
      if (!visible || requested.has(level)) continue;
      requested.add(level);
      void fetch(`/data/china-power/${level}-lines.bin`, { signal: controller.signal })
        .then(response => {
          if (!response.ok) throw new Error("行政辅助边界暂不可用");
          return response.arrayBuffer();
        })
        .then(data => {
          if (controller.signal.aborted) return;
          const lines = powerDetailLines(data, level === "county");
          boundaries.set(level, lines);
          scene.add(lines);
          queueRender();
        })
        .catch(() => requested.delete(level));
    }
  }

  function draw() {
    cancelAnimationFrame(drawRequest);
    drawRequest = 0;
    syncDetails();
    camera.updateMatrixWorld();
    const mobile = width < 540;
    const regions: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const label of labels) {
      const position = label.sprite.position.clone().project(camera);
      const x = (position.x + 1) * width / 2;
      const y = (1 - position.y) * height / 2;
      const rect = { left: x - label.width / 2, right: x + label.width / 2, top: y - label.height, bottom: y };
      const overlaps = regions.some(box => rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top);
      label.sprite.visible = !overlaps && rect.left > 0 && rect.right < width && rect.top > 0 && rect.bottom < height;
      if (label.sprite.visible) regions.push(rect);
      label.sprite.scale.set(label.width / camera.zoom, label.height / camera.zoom, 1);
    }
    renderer.setViewport(0, 0, width, height);
    renderer.clear();
    renderer.render(scene, camera);

    const insetWidth = mobile ? 64 : 106;
    const insetHeight = mobile ? 75 : 120;
    const insetSize = insetBounds.getSize(new Vector2());
    const insetScale = Math.min(insetWidth / insetSize.x, insetHeight / insetSize.y) * .91;
    insetCamera.left = -insetWidth / (2 * insetScale);
    insetCamera.right = -insetCamera.left;
    insetCamera.top = insetHeight / (2 * insetScale);
    insetCamera.bottom = -insetCamera.top;
    insetCamera.updateProjectionMatrix();
    renderer.clearDepth();
    renderer.setViewport(width - insetWidth - 12, mobile ? 144 : 112, insetWidth, insetHeight);
    renderer.render(insetScene, insetCamera);
  }

  function reportCamera() {
    const lngLat = powerProjection.invert?.([controls.target.x, -controls.target.y]);
    if (lngLat) callbacks.onCamera({ center: lngLat, zoom: Math.log2(camera.zoom / pixelsPerUnit), pitch: 0, bearing: 0 });
  }

  function applyView(view: View) {
    controls.target.copy(view.center);
    camera.position.copy(view.center).add(cameraOffset);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    controls.update();
    queueRender();
  }

  function moveTo(next: View, animate = true) {
    cancelAnimationFrame(animation);
    const view = { ...next, zoom: Math.min(controls.maxZoom, Math.max(controls.minZoom, next.zoom)) };
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyView(view);
      reportCamera();
      return;
    }
    const from = controls.target.clone();
    const zoom = camera.zoom;
    const start = performance.now();
    const advance = (time: number) => {
      const progress = Math.min(1, (time - start) / 320);
      const ease = 1 - (1 - progress) ** 3;
      applyView({ center: from.clone().lerp(view.center, ease), zoom: zoom + (view.zoom - zoom) * ease });
      if (progress < 1) animation = requestAnimationFrame(advance);
      else reportCamera();
    };
    animation = requestAnimationFrame(advance);
  }

  function resize() {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    const size = bounds.getSize(new Vector2());
    const previous = fit;
    fit = Math.min(width * .93 / size.x, height * .95 / (size.y * .91 + maximumHeight * .42));
    controls.minZoom = fit * .68;
    controls.maxZoom = fit * 5.5;
    applyView({ center: controls.target.clone(), zoom: camera.zoom / previous * fit });
    renderer.setSize(width, height, false);
    reportCamera();
  }

  function locate(event: PointerEvent) {
    const box = canvas.getBoundingClientRect();
    ray.setFromCamera(new Vector2((event.clientX - box.left) / box.width * 2 - 1, 1 - (event.clientY - box.top) / box.height * 2), camera);
    const hit = ray.intersectObjects(targets, false).find(item => item.object.visible);
    return byCode.get(hit?.object.userData.code);
  }

  let pointerStart: { x: number; y: number; id: number } | undefined;
  const pointerDown = (event: PointerEvent) => {
    pointerStart = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : undefined;
  };
  function pointerMove(event: PointerEvent) {
    const part = event.buttons ? undefined : locate(event);
    canvas.classList.toggle("is-over-province", Boolean(part));
    callbacks.onHover(part && frame ? {
      x: event.clientX,
      y: event.clientY,
      title: `${part.name} · ${frame.label}`,
      subtitle: `${frame.period} · ${part.value == null ? "暂无数据" : `${powerAmount.format(part.value)} ${frame.unit}`}`,
      color: part.value == null ? powerMapNoData : "#" + part.column.material.color.getHexString(),
    } : null);
  }
  function pointerUp(event: PointerEvent) {
    const start = pointerStart;
    pointerStart = undefined;
    if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const part = locate(event);
    if (part) callbacks.onSelect(part.code);
    if (event.pointerType === "touch" && part?.value == null) pointerMove(event);
  }
  const hideHover = () => callbacks.onHover(null);
  const stopMove = () => { cancelAnimationFrame(animation); hideHover(); };
  controls.addEventListener("change", queueRender);
  controls.addEventListener("start", stopMove);
  controls.addEventListener("end", reportCamera);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointerleave", hideHover);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function clearLabels() {
    for (const { sprite } of labels) {
      sprite.removeFromParent();
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    labels.length = 0;
  }

  return {
    focus(view: MapCameraState | undefined, animate = true) {
      const target = view && projectPowerPoint(view.center);
      moveTo({
        center: target ? new Vector3(target.x, target.y, 0) : center,
        zoom: view ? pixelsPerUnit * 2 ** view.zoom : fit,
      }, animate);
    },
    zoom(factor: number) { moveTo({ center: controls.target.clone(), zoom: camera.zoom * factor }); },
    update(next: ProvincePowerFrame, selected?: string) {
      frame = next;
      hideHover();
      clearLabels();
      const values = new Map(next.regions.map(({ code, value }) => [code, value]));
      for (const part of parts) {
        const value = values.get(part.code) ?? null;
        const ratio = provincePowerRatio(value ?? 0, next.scaleMax);
        const base = value == null ? noData : scaleColor(ratio);
        part.value = value;
        part.fill.color.copy(base);
        part.side.color.copy(base).multiplyScalar(.47);
        part.lines.material = part.code === selected ? highlighted : originalBoundary;
        part.column.material.color.copy(base);
        part.column.visible = value != null && value > 0;
        part.column.scale.set(1, 1, Math.max(.16, ratio * maximumHeight));
      }

      const ranked = parts.filter(part => part.column.visible).sort((a, b) => b.value! - a.value!).slice(0, 3);
      const active = selected ? byCode.get(selected) : undefined;
      const annotated = active ? [active, ...ranked.filter(part => part !== active)] : ranked;
      for (const part of annotated) {
        const name = part.name.replace(/(?:壮族|回族|维吾尔)?自治区$|特别行政区$|[省市]$/u, "");
        const label = makeLabel(`${name} ${part.value == null ? "暂无数据" : powerAmount.format(part.value)}`);
        label.sprite.position.copy(part.anchor);
        label.sprite.position.z += (part.column.visible ? part.column.scale.z : 0) + .15;
        labels.push(label);
        scene.add(label.sprite);
      }
      queueRender();
    },
    screenshot() {
      draw();
      return canvas.toDataURL("image/png");
    },
    dispose() {
      controller.abort();
      observer.disconnect();
      cancelAnimationFrame(animation);
      cancelAnimationFrame(drawRequest);
      controls.dispose();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointerleave", hideHover);
      clearLabels();
      const geometries = new Set<BufferGeometry>([columnGeometry]);
      const materials = new Set<Material>([highlighted, originalBoundary]);
      for (const root of [scene, insetScene]) root.traverse(object => {
        if (object instanceof Mesh || object instanceof LineSegments) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
