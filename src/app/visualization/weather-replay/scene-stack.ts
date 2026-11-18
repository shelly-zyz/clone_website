import {
  AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, DirectionalLight, Float32BufferAttribute, Group,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera,
  PlaneGeometry, Raycaster, Scene, ShadowMaterial, SphereGeometry, SRGBColorSpace, TubeGeometry, CatmullRomCurve3, Vector2, Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { loadRelief, paintBasemap, type Relief } from "./replay-basemap";
import type { RendererContext, SceneInput, SurfaceSize, ViewRenderer } from "./replay-canvas";
import { accumulateRain, stackFrameIndices, utcClock, type Hotspot } from "./replay-data";
import { blurField, upsample, type Grid } from "./replay-field";
import { geographicProjection, gridCoordinate, regionalPeak } from "./replay-geography";
import { scaleColor, stackScale } from "./replay-palette";
import { haloText } from "./replay-plan";

const span = 2;
const stackHeight = 2.15;
const thickness = .034;
const baseY = -.42;

/** The map is the box's own +y face (material index 2), which avoids z-fighting with a separate plane. */
type Slab = { frame: number; group: Group; face: MeshStandardMaterial; body: Mesh<BoxGeometry, MeshStandardMaterial[]>; y: number; target: number; emphasis: number };

/** Portrait viewports need a farther camera to keep the same horizontal coverage. */
const aspectFit = (aspect: number) => Math.max(1, Math.pow(1.15 / Math.max(.3, aspect), .85));

export async function createStackScene({ overlay, gl, invalidate }: RendererContext): Promise<ViewRenderer> {
  const renderer = gl();
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, .05, 40);
  const controls = new OrbitControls(camera, overlay);
  controls.enableDamping = true;
  controls.dampingFactor = .09;
  controls.minDistance = 1.6;
  controls.maxDistance = 22;
  controls.maxPolarAngle = 1.5;
  controls.addEventListener("change", invalidate);
  let framedAspect = 0;
  let userMoved = false;
  controls.addEventListener("start", () => { userMoved = true; });

  const key = new DirectionalLight(0xffffff, 1.7);
  key.position.set(-2.4, 4.2, 1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -2.4;
  key.shadow.camera.right = key.shadow.camera.top = 2.4;
  key.shadow.camera.near = .5;
  key.shadow.camera.far = 12;
  key.shadow.radius = 6;
  key.shadow.bias = -.0006;
  const fill = new DirectionalLight(0xdfe8f2, .7);
  fill.position.set(3, 1.5, 2.5);
  scene.add(key, fill, new AmbientLight(0xffffff, 1.45));

  const floor = new Mesh(new PlaneGeometry(14, 14), new ShadowMaterial({ opacity: .12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = baseY - .02;
  floor.receiveShadow = true;
  scene.add(floor);

  const sideMaterial = new MeshStandardMaterial({ color: 0xf4f4f1, roughness: .62 });
  const activeSide = new MeshStandardMaterial({ color: 0x5a86ea, roughness: .45, emissive: new Color(0x2f5bd6), emissiveIntensity: .35 });
  const postMaterial = new LineBasicMaterial({ color: 0x7f8a95, transparent: true, opacity: .55 });
  const posts = new LineSegments(new BufferGeometry(), postMaterial);
  scene.add(posts);
  const axisMaterial = new LineBasicMaterial({ vertexColors: true });
  const axis = new LineSegments(new BufferGeometry(), axisMaterial);
  const axisHead = new Mesh(new ConeGeometry(.03, .09, 20), new MeshBasicMaterial({ color: 0x6a3fc0 }));
  scene.add(axis, axisHead);
  const trailMaterial = new MeshStandardMaterial({ color: 0xf06a35, roughness: .4, emissive: new Color(0xf06a35), emissiveIntensity: .25 });
  const trailGroup = new Group();
  scene.add(trailGroup);
  const baseGroup = new Group();
  scene.add(baseGroup);

  let input: SceneInput | undefined;
  let relief: Relief | null = null;
  let builtFor: { area: SceneInput["area"]; relief: Relief | null } | undefined;
  let projection = geographicProjection({ west: 0, east: 1, south: 0, north: 1 });
  let basemap: HTMLCanvasElement | undefined;
  let slabs: Slab[] = [];
  let stackKey = "";
  let baseKey = "";
  let baseInfo: { peak: number } | undefined;
  let disposed = false;
  const tops = new Map<Grid, CanvasTexture>();
  const defaultView = { azimuth: .55, polar: 1.2, distance: 8.7 };

  const width = () => projection.width * span;
  const depth = () => projection.depth * span;
  const toLocal = (lon: number, lat: number) => {
    const [x, z] = projection.project(lon, lat);
    return [x * span, z * span] as const;
  };

  function placeCamera(view = defaultView) {
    const distance = view.distance * aspectFit(camera.aspect);
    controls.target.set(0, stackHeight * .38, 0);
    camera.position.set(
      Math.sin(view.azimuth) * Math.sin(view.polar) * distance,
      stackHeight * .38 + Math.cos(view.polar) * distance,
      Math.cos(view.azimuth) * Math.sin(view.polar) * distance,
    );
    controls.update();
  }

  function topTexture(replay: WeatherReplay, values: Grid, limit: number) {
    let saved = tops.get(values);
    if (saved || !basemap) return saved;
    const canvas = document.createElement("canvas");
    canvas.width = basemap.width;
    canvas.height = basemap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(basemap, 0, 0);
    const field = blurField(upsample(values, replay.cols, replay.rows, 6), 1);
    const image = document.createElement("canvas");
    image.width = field.width;
    image.height = field.height;
    const painter = image.getContext("2d")!;
    const pixels = painter.createImageData(field.width, field.height);
    for (let row = 0; row < field.height; row++) {
      for (let col = 0; col < field.width; col++) {
        const value = field.data[(field.height - 1 - row) * field.width + col];
        if (!(value >= .5)) continue;
        const s = Math.sqrt(Math.min(1, value / limit));
        const [r, g, b] = scaleColor(stackScale, s);
        pixels.data.set([r, g, b, Math.round(255 * Math.min(.96, 1.45 * s))], (row * field.width + col) * 4);
      }
    }
    painter.putImageData(pixels, 0, 0);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    saved = new CanvasTexture(canvas);
    saved.colorSpace = SRGBColorSpace;
    saved.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tops.set(values, saved);
    return saved;
  }

  function heightOf(replay: WeatherReplay, frames: number[], frame: number) {
    const start = Date.parse(replay.rain[frames[0]].time);
    const duration = Date.parse(replay.rain[frames[frames.length - 1]].time) - start;
    return duration ? (Date.parse(replay.rain[frame].time) - start) / duration * stackHeight : 0;
  }

  function disposeSlab(slab: Slab) {
    scene.remove(slab.group);
    slab.body.geometry.dispose();
    slab.face.dispose();
  }

  function build(replay: WeatherReplay, area: SceneInput["area"]) {
    builtFor = { area, relief };
    projection = geographicProjection(replay.bounds);
    const aspect = projection.width / projection.depth;
    basemap = paintBasemap(1280, Math.round(1280 / aspect), replay.bounds, "slab", area.mapPolygons, relief, 6);
    tops.forEach(texture => texture.dispose());
    tops.clear();
    slabs.forEach(disposeSlab);
    slabs = [];
    stackKey = baseKey = "";
    placeCamera();
  }

  function layout(replay: WeatherReplay, state: SceneInput["state"]) {
    const frames = stackFrameIndices(replay, state.index);
    const next = frames.join(",") + "|" + state.rainLimit;
    if (next !== stackKey) {
      stackKey = next;
      const kept = new Map(slabs.map(slab => [slab.frame, slab]));
      const fresh: Slab[] = [];
      for (const frame of frames) {
        const target = heightOf(replay, frames, frame);
        const existing = kept.get(frame);
        if (existing) {
          existing.target = target;
          kept.delete(frame);
          fresh.push(existing);
          continue;
        }
        const group = new Group();
        const face = new MeshStandardMaterial({ roughness: .78, map: topTexture(replay, replay.rain[frame].values, state.rainLimit) ?? null });
        const body = new Mesh(new BoxGeometry(width(), thickness, depth()), [sideMaterial, sideMaterial, face, sideMaterial, sideMaterial, sideMaterial]);
        // Slices cast onto the floor only; shading each other would grey out the lower maps.
        body.castShadow = true;
        group.add(body);
        scene.add(group);
        fresh.push({ frame, group, face, body, y: target + .25, target, emphasis: 0 });
      }
      kept.forEach(disposeSlab);
      slabs = fresh;
      // Corner posts tie the slices into one time column.
      const w = width() / 2, d = depth() / 2;
      const top = stackHeight + thickness / 2, bottom = -thickness / 2;
      posts.geometry.dispose();
      posts.geometry = new BufferGeometry();
      posts.geometry.setAttribute("position", new Float32BufferAttribute([
        -w, bottom, -d, -w, top, -d, w, bottom, -d, w, top, -d, -w, bottom, d, -w, top, d, w, bottom, d, w, top, d,
        -w, baseY, d, -w, bottom, d, w, baseY, d, w, bottom, d, w, baseY, -d, w, bottom, -d,
      ], 3));
      const ax = w + .2, az = d;
      axis.geometry.dispose();
      axis.geometry = new BufferGeometry();
      const from = new Color(0x3d8be0), to = new Color(0x6a3fc0);
      const axisPoints: number[] = [], axisColors: number[] = [];
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const a = i / steps, b = (i + 1) / steps;
        axisPoints.push(ax, -thickness + a * (stackHeight + .1), az, ax, -thickness + b * (stackHeight + .1), az);
        const ca = from.clone().lerp(to, a), cb = from.clone().lerp(to, b);
        axisColors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
      }
      for (const frame of frames) {
        const y = heightOf(replay, frames, frame);
        axisPoints.push(w, y, d, ax, y, az);
        axisColors.push(.62, .66, .7, .62, .66, .7);
      }
      axis.geometry.setAttribute("position", new Float32BufferAttribute(axisPoints, 3));
      axis.geometry.setAttribute("color", new Float32BufferAttribute(axisColors, 3));
      axisHead.position.set(ax, stackHeight + .1, az);
      buildBase(replay, frames);
    }
    for (const slab of slabs) {
      const map = topTexture(replay, replay.rain[slab.frame].values, state.rainLimit) ?? null;
      if (slab.face.map !== map) {
        slab.face.map = map;
        slab.face.needsUpdate = true;
      }
    }
    buildTrail(replay, frames, state.trail);
  }

  /** Base relief: rain accumulated across the stacked window, height proportional to depth in mm. */
  function buildBase(replay: WeatherReplay, frames: number[]) {
    const keyNext = frames[0] + "-" + frames[frames.length - 1];
    if (keyNext === baseKey) return;
    baseKey = keyNext;
    baseGroup.children.forEach(child => {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    });
    baseGroup.clear();
    const totals = accumulateRain(replay, frames[0])[frames[frames.length - 1] - frames[0]];
    const peak = Math.max(1, ...totals.map(value => value ?? 0));
    const field = blurField(upsample(totals, replay.cols, replay.rows, 2), 1);
    const plane = new PlaneGeometry(width(), depth(), field.width - 1, field.height - 1);
    plane.rotateX(-Math.PI / 2);
    const position = plane.getAttribute("position");
    const colors: number[] = [];
    const lift = .26;
    for (let i = 0; i < position.count; i++) {
      const col = i % field.width, row = field.height - 1 - Math.floor(i / field.width);
      const value = field.data[row * field.width + col];
      const t = Number.isNaN(value) ? 0 : Math.sqrt(Math.min(1, value / peak));
      position.setY(i, t * lift);
      const [r, g, b] = t < .04 ? [222, 224, 220] : scaleColor(stackScale, t);
      const color = new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
      colors.push(color.r, color.g, color.b);
    }
    plane.setAttribute("color", new Float32BufferAttribute(colors, 3));
    plane.computeVertexNormals();
    const surface = new Mesh(plane, new MeshStandardMaterial({ vertexColors: true, roughness: .7, flatShading: false }));
    surface.position.y = baseY;
    surface.castShadow = true;
    baseGroup.add(surface);
    baseInfo = { peak };
  }

  function clearTrail() {
    trailGroup.children.forEach(child => (child as Mesh).geometry.dispose());
    trailGroup.clear();
  }

  function buildTrail(replay: WeatherReplay, frames: number[], trail: readonly Hotspot[]) {
    clearTrail();
    const points = trail.filter(spot => spot.frame >= frames[0] && spot.frame <= frames[frames.length - 1]).map(spot => {
      const [lon, lat] = gridCoordinate(replay, spot.center[0] * (replay.cols - 1), spot.center[1] * (replay.rows - 1));
      const [x, z] = toLocal(lon, lat);
      return new Vector3(x, heightOf(replay, frames, spot.frame) + thickness / 2 + .012, z);
    });
    for (const point of points) {
      const dot = new Mesh(new SphereGeometry(.018, 16, 12), trailMaterial);
      dot.position.copy(point);
      dot.castShadow = true;
      trailGroup.add(dot);
    }
    if (points.length > 1) {
      const tube = new Mesh(new TubeGeometry(new CatmullRomCurve3(points, false, "centripetal"), points.length * 12, .006, 8, false), trailMaterial);
      tube.castShadow = true;
      trailGroup.add(tube);
    }
  }

  function paintLabels(size: SurfaceSize) {
    const context = overlay.getContext("2d");
    if (!context || !input) return;
    const { replay, state, area } = input;
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const screen = (point: Vector3): [number, number] => {
      const p = point.clone().project(camera);
      return [(p.x + 1) / 2 * size.width, (1 - p.y) / 2 * size.height];
    };
    const w = width() / 2, d = depth() / 2;
    const frames = slabs.map(slab => slab.frame);
    const sameDay = replay.rain[frames[0]]?.time.slice(0, 10) === replay.rain[frames[frames.length - 1]]?.time.slice(0, 10);
    context.textBaseline = "middle";
    context.textAlign = "left";
    for (const slab of slabs) {
      const active = slab.frame === state.index;
      const [x, y] = screen(new Vector3(w + .24, slab.group.position.y, d));
      const time = replay.rain[slab.frame].time;
      const peak = regionalPeak(replay.rain[slab.frame].values, area.cells);
      context.font = (active ? "700 13px" : "600 11px") + " system-ui, sans-serif";
      haloText(context, (sameDay ? "" : time.slice(5, 10) + " ") + utcClock(time) + " UTC", x + 8, y - 7, active ? "#1d3fa8" : "#3a4652", "rgba(255,255,255,.9)", 3);
      context.font = (active ? "600 11px" : "10px") + " system-ui, sans-serif";
      haloText(context, peak == null ? "缺测" : `峰值 ${peak.toFixed(1)} mm/h`, x + 8, y + 8, active ? "#6a3fc0" : "#66727e", "rgba(255,255,255,.9)", 3);
    }
    const [hx, hy] = screen(new Vector3(w + .2, stackHeight + .17, d));
    context.font = "600 11px system-ui, sans-serif";
    context.textAlign = "center";
    haloText(context, "时间 UTC", hx, hy - 6, "#4a3a8c", "rgba(255,255,255,.9)", 3);
    if (baseInfo) {
      const [bx, by] = screen(new Vector3(-w, baseY, d));
      context.textAlign = "left";
      context.font = "600 11px system-ui, sans-serif";
      haloText(context, "底座 · 切片窗口累计降水起伏", bx, by + 18, "#2f3a46", "rgba(255,255,255,.9)", 3);
      context.font = "700 11px system-ui, sans-serif";
      haloText(context, `最大累计 ${baseInfo.peak.toFixed(1)} mm`, bx, by + 34, "#7a1f6a", "rgba(255,255,255,.92)", 3);
    }
    if (state.selectedCell !== undefined && area.hasData) {
      const active = slabs.find(slab => slab.frame === state.index);
      if (active) {
        const [lon, lat] = gridCoordinate(replay, state.selectedCell % replay.cols, Math.floor(state.selectedCell / replay.cols));
        const [lx, lz] = toLocal(lon, lat);
        const [x, y] = screen(new Vector3(lx, active.group.position.y + thickness / 2, lz));
        context.strokeStyle = "#111";
        context.lineWidth = 1.6;
        context.beginPath();
        context.arc(x, y, 5.5, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "#fff";
        context.beginPath();
        context.arc(x, y, 2, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function update(next: SceneInput) {
    const { replay, area, state } = next;
    const reload = input?.area !== area;
    input = next;
    if (reload) {
      builtFor = undefined;
      void loadRelief(replay.bounds).then(r => {
        if (disposed || input?.area !== area) return;
        relief = r;
        update(input);
        invalidate();
      });
    }
    if (!builtFor || builtFor.area !== area || builtFor.relief !== relief) build(replay, area);
    layout(replay, state);
  }

  return {
    update,
    render(now, size) {
      if (!input) return false;
      if (!renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;
      }
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      if (!userMoved && Math.abs(framedAspect - camera.aspect) > .02) {
        framedAspect = camera.aspect;
        placeCamera();
      }
      let moving = controls.update();
      for (const slab of slabs) {
        const active = slab.frame === input.state.index;
        const goal = active ? 1 : 0;
        slab.emphasis += (goal - slab.emphasis) * .18;
        const y = slab.target + slab.emphasis * .07;
        slab.y += (y - slab.y) * .16;
        if (Math.abs(goal - slab.emphasis) > .004 || Math.abs(y - slab.y) > .0005) moving = true;
        slab.group.position.y = slab.y;
        const tone = .8 + .2 * slab.emphasis;
        slab.face.color.setRGB(tone, tone, tone * 1.01);
        const side = active ? activeSide : sideMaterial;
        if (slab.body.material[0] !== side) slab.body.material = [side, side, slab.face, side, side, side];
      }
      renderer.render(scene, camera);
      paintLabels(size);
      return moving;
    },
    pick(x, y) {
      if (!input) return;
      const active = slabs.find(slab => slab.frame === input!.state.index);
      if (!active) return;
      const box = overlay.getBoundingClientRect();
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(x / box.width * 2 - 1, -(y / box.height) * 2 + 1), camera);
      const hit = raycaster.intersectObject(active.body)[0];
      if (!hit || (hit.face?.normal.y ?? 0) < .5) return;
      const { replay } = input;
      const u = hit.point.x / width() + .5, v = .5 - hit.point.z / depth();
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      return { cell: Math.round(v * (replay.rows - 1)) * replay.cols + Math.round(u * (replay.cols - 1)) };
    },
    zoom(factor) {
      const offset = camera.position.clone().sub(controls.target).divideScalar(factor);
      camera.position.copy(controls.target).add(offset.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length()))));
      controls.update();
    },
    rotate(angle) {
      camera.position.sub(controls.target).applyAxisAngle(new Vector3(0, 1, 0), angle).add(controls.target);
      controls.update();
    },
    reset() { userMoved = false; placeCamera(); },
    dispose() {
      disposed = true;
      controls.dispose();
      slabs.forEach(disposeSlab);
      tops.forEach(texture => texture.dispose());
      clearTrail();
      baseGroup.children.forEach(child => {
        const mesh = child as Mesh;
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      });
      [posts, axis].forEach(line => line.geometry.dispose());
      [sideMaterial, activeSide, postMaterial, axisMaterial, trailMaterial].forEach(material => material.dispose());
      axisHead.geometry.dispose();
      floor.geometry.dispose();
      renderer.shadowMap.enabled = false;
      overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
    },
  };
}
