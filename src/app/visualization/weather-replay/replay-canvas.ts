import {
  AmbientLight, DirectionalLight, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry,
  Scene, Vector3, WebGLRenderer, type Texture,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ReplayBounds, WeatherReplay } from "@/lib/weather-replay/model";
import type { ReplayView } from "@/lib/weather-replay/views";
import { satelliteAt, stackFrameIndices, utcClock } from "./replay-data";
import { geographicProjection, type ReplayArea } from "./replay-geography";
import { createRainParticles, createRainSurface } from "./replay-meshes";
import { fieldTexture, geographicTexture, textureBounds, type Grid } from "./replay-textures";

type ViewState = {
  view: ReplayView;
  index: number;
  clouds: boolean;
  precipitation: boolean;
  totals?: Grid;
  accumulationLimit: number;
};

const up = new Vector3(0, 1, 0);
const layerStart = 0.06;
const layerSpacing = 0.112;

export function createReplayScene(canvas: HTMLCanvasElement, labels: HTMLDivElement, onContextLoss: () => void) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.05, 30);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enablePan = false;
  orbit.rotateSpeed = 0.56;
  orbit.zoomSpeed = 0.76;
  orbit.minZoom = 0.74;
  orbit.maxZoom = 2.5;
  orbit.minPolarAngle = Math.PI * 0.12;
  orbit.maxPolarAngle = Math.PI * 0.43;
  const sunlight = new DirectionalLight(0xc8edf8, 1.75);
  sunlight.position.set(-0.8, 2, -1.2);
  scene.add(new AmbientLight(0xaec8e4, 1.4), sunlight);

  const plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const createPlane = (order: number, color = 0xffffff) => {
    const material = new MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const mesh = new Mesh(plane, material);
    mesh.visible = false;
    mesh.renderOrder = order;
    scene.add(mesh);
    return mesh;
  };
  const groundBase = createPlane(0, 0x648597);
  const ground = createPlane(1);
  const rain = createPlane(2);
  const cloud = createPlane(6);
  const sliceGround = Array.from({ length: 5 }, (_, i) => createPlane(3 + i * 2));
  const sliceRain = Array.from({ length: 5 }, (_, i) => createPlane(4 + i * 2));
  const particles = createRainParticles();
  scene.add(particles.mesh);
  particles.mesh.visible = false;

  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motion = preference.matches;
  let requested = 0;
  let lastDraw = 0;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let state: ViewState | undefined;
  let selectedArea: ReplayArea | undefined;
  let replay: WeatherReplay | undefined;
  let projection: ReturnType<typeof geographicProjection> | undefined;
  let surface: ReturnType<typeof createRainSurface> | undefined;
  let landMap: Texture | null = null;
  let clipMap: Texture | null = null;
  let textures = new Map<Grid, Texture>();
  let anchors: { element: HTMLSpanElement; position: Vector3; alignSlice: boolean }[] = [];
  let labelsDirty = true;
  let top = 0;
  const point = new Vector3();

  function fitCamera() {
    if (!projection || !width || !height) return;
    camera.updateMatrixWorld();
    const { width: spanX, depth: spanZ } = projection;
    let left = Infinity, right = -Infinity, bottom = Infinity, upper = -Infinity;
    for (const x of [-spanX / 2, spanX / 2]) {
      for (const z of [-spanZ / 2, spanZ / 2]) {
        for (const y of [0, top]) {
          point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          left = Math.min(left, point.x);
          right = Math.max(right, point.x);
          bottom = Math.min(bottom, point.y);
          upper = Math.max(upper, point.y);
        }
      }
    }
    const aspect = width / height;
    const time = state?.view === "time" && selectedArea?.hasData;
    const frameHeight = Math.max((upper - bottom) / 0.76, (right - left) / aspect / (time ? 0.71 : 0.83));
    const frameWidth = frameHeight * aspect;
    const x = (left + right) / 2 + (time ? frameWidth * 0.05 : 0);
    const y = (bottom + upper) / 2;
    camera.left = x - frameWidth / 2;
    camera.right = x + frameWidth / 2;
    camera.bottom = y - frameHeight / 2;
    camera.top = y + frameHeight / 2;
    camera.updateProjectionMatrix();
  }

  function paint(now: number) {
    requested = 0;
    if (!width || !height || document.hidden) return;
    if (particles.mesh.visible && !motion) {
      particles.time.value += lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 0;
      lastDraw = now;
    } else {
      lastDraw = 0;
    }
    renderer.render(scene, camera);
    if (labelsDirty) {
      labelsDirty = false;
      for (const { element, position, alignSlice } of anchors) {
        point.copy(position).project(camera);
        let x = (point.x + 1) * width / 2;
        const y = (1 - point.y) * height / 2;
        if (alignSlice && projection) {
          let east = -Infinity;
          for (const cornerX of [-projection.width / 2, projection.width / 2]) {
            for (const cornerZ of [-projection.depth / 2, projection.depth / 2]) {
              east = Math.max(east, point.set(cornerX, position.y, cornerZ).project(camera).x);
            }
          }
          x = Math.min(width - 48, Math.max(5, (east + 1) * width / 2 + 4));
        }
        element.hidden = x < 0 || x > width || y < 18 || y > height - 14;
        element.style.transform = "translate(" + x + "px," + y + "px) translateY(-50%)";
      }
    }
    if (particles.mesh.visible && !motion && !document.hidden) draw();
  }

  function draw() {
    if (!requested && !document.hidden) requested = requestAnimationFrame(paint);
  }

  function layout() {
    fitCamera();
    labelsDirty = true;
    draw();
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
    if (canvas.clientWidth === width && canvas.clientHeight === height && ratio === pixelRatio) return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    pixelRatio = ratio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    layout();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  orbit.addEventListener("change", layout);
  const onMotionChange = () => { motion = preference.matches; lastDraw = 0; draw(); };
  const onVisibility = () => { lastDraw = 0; draw(); };
  const onLost = (event: Event) => { event.preventDefault(); onContextLoss(); };
  preference.addEventListener("change", onMotionChange);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onLost);

  function reset() {
    orbit.target.set(0, 0.12, 0);
    camera.position.set(0.80, 1.45, 1.83);
    camera.zoom = 1;
    orbit.update();
    layout();
  }

  function rotate(angle: number) {
    camera.position.sub(orbit.target).applyAxisAngle(up, angle).add(orbit.target);
    orbit.update();
    layout();
  }

  function zoom(factor: number) {
    camera.zoom = Math.max(orbit.minZoom, Math.min(orbit.maxZoom, camera.zoom * factor));
    layout();
  }

  function place(mesh: typeof rain, bounds: ReplayBounds, altitude: number) {
    if (!projection) return;
    const [x, z] = projection.project((bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2);
    const [left, bottom] = projection.project(bounds.west, bounds.south);
    const [right, upper] = projection.project(bounds.east, bounds.north);
    mesh.scale.set(right - left, 1, bottom - upper);
    mesh.position.set(x, altitude, z);
  }

  function show(mesh: typeof rain, texture: Texture | null, opacity: number, mask: Texture | null = null) {
    if (Boolean(mesh.material.map) !== Boolean(texture) || Boolean(mesh.material.alphaMap) !== Boolean(mask)) {
      mesh.material.needsUpdate = true;
    }
    mesh.material.map = texture;
    mesh.material.alphaMap = mask;
    mesh.material.opacity = opacity;
    mesh.visible = texture !== null;
  }

  function addLabel(text: string, x: number, y: number, z: number, active = false, alignSlice = false) {
    const element = document.createElement("span");
    element.textContent = text;
    element.dataset.active = String(active);
    labels.append(element);
    anchors.push({ element, position: new Vector3(x, y, z), alignSlice });
  }

  function releaseArea() {
    if (surface) {
      scene.remove(surface.mesh);
      surface.dispose();
      surface = undefined;
    }
    landMap?.dispose();
    clipMap?.dispose();
    landMap = clipMap = null;
  }

  function selectArea(next: ReplayArea, archive: WeatherReplay) {
    if (replay !== archive) {
      for (const texture of textures.values()) texture.dispose();
      textures = new Map();
    }
    replay = archive;
    releaseArea();
    selectedArea = next;
    projection = geographicProjection(next.bounds);
    landMap = geographicTexture(next, next.bounds);
    const extent = textureBounds(archive);
    if (next.id !== "archive" && next.hasData) clipMap = geographicTexture(next, extent, true);
    place(groundBase, next.bounds, -0.012);
    place(ground, next.bounds, 0);
    show(groundBase, landMap, 0.33);
    show(ground, landMap, 0.69);
    if (next.hasData) {
      surface = createRainSurface(archive, projection, clipMap);
      scene.add(surface.mesh);
    }
    reset();
  }

  function texture(values: Grid, kind: "cloud" | "rain") {
    let cached = textures.get(values);
    if (!cached && replay) {
      cached = fieldTexture(replay, values, kind);
      textures.set(values, cached);
    }
    return cached ?? null;
  }

  function update(archive: WeatherReplay, area: ReplayArea, next: ViewState) {
    state = next;
    const { index, view, clouds, precipitation, totals, accumulationLimit } = next;
    if (selectedArea !== area || replay !== archive) selectArea(area, archive);
    const extent = textureBounds(archive);
    const frame = archive.rain[index];
    const stack = view === "time" && area.hasData ? stackFrameIndices(archive, index) : [];
    const infrared = clouds && view === "weather" && area.hasData ? satelliteAt(archive, frame.time) : undefined;
    const rainLayer = area.hasData && (view === "rain" || (view === "weather" && precipitation));
    const heightField = area.hasData && ((view === "accumulation" && totals) || (view === "weather" && precipitation));
    top = !area.hasData ? 0 : view === "time" ? layerStart + Math.max(0, stack.length - 1) * layerSpacing
      : view === "rain" ? 0.46 : view === "accumulation" ? 0.27 : 0.29;

    place(cloud, extent, 0.265);
    show(cloud, infrared ? texture(infrared.values, "cloud") : null, 0.86, clipMap);
    place(rain, extent, 0.016);
    show(rain, rainLayer ? texture(frame.values, "rain") : null, view === "weather" ? 0.68 : 0.24, clipMap);
    if (surface) {
      surface.mesh.visible = Boolean(heightField);
      if (heightField) surface.update(view === "accumulation" && totals ? totals : frame.values, view === "accumulation" ? accumulationLimit : 75, view === "accumulation");
    }
    particles.mesh.visible = view === "rain" && area.hasData;
    if (particles.mesh.visible && projection) {
      particles.update(archive, area, projection, frame.values);
      particles.mesh.visible = particles.mesh.geometry.drawRange.count > 0;
    }

    labels.replaceChildren();
    anchors = [];
    for (let i = 0; i < sliceGround.length; i++) {
      const layer = stack[i];
      const altitude = layerStart + i * layerSpacing;
      const active = layer === index;
      place(sliceGround[i], area.bounds, altitude);
      place(sliceRain[i], extent, altitude + 0.004);
      show(sliceGround[i], layer === undefined ? null : landMap, active ? 0.45 : 0.16);
      show(sliceRain[i], layer === undefined ? null : texture(archive.rain[layer].values, "rain"), active ? 0.96 : 0.62, clipMap);
      if (layer !== undefined && projection) {
        addLabel(utcClock(archive.rain[layer].time) + (active ? " UTC" : ""), 0, altitude, 0, active, true);
      }
    }
    if (area.id === "archive" && view !== "time" && projection) {
      for (const [text, lon, lat] of [["美国东南沿海", -79.75, 34.4], ["巴哈马", -77.7, 25.75]] as const) {
        if (lon < area.bounds.west || lon > area.bounds.east || lat < area.bounds.south || lat > area.bounds.north) continue;
        const [x, z] = projection.project(lon, lat);
        addLabel(text, x, 0.006, z);
      }
    }
    resize();
    layout();
  }

  function dispose() {
    cancelAnimationFrame(requested);
    observer.disconnect();
    orbit.removeEventListener("change", layout);
    orbit.dispose();
    preference.removeEventListener("change", onMotionChange);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onLost);
    releaseArea();
    particles.dispose();
    plane.dispose();
    for (const mesh of scene.children) if (mesh instanceof Mesh) mesh.material.dispose();
    for (const texture of textures.values()) texture.dispose();
    renderer.dispose();
    labels.replaceChildren();
  }

  reset();
  resize();
  return { update, rotate, zoom, reset, dispose };
}
