import {
  BoxGeometry, BufferGeometry, CanvasTexture, ConeGeometry, CustomBlending, DataTexture, DirectionalLight, Float32BufferAttribute,
  FrontSide, HemisphereLight, LineBasicMaterial, LineSegments, LinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial, OneFactor,
  OneMinusSrcAlphaFactor, PerspectiveCamera, PlaneGeometry, Raycaster, RedFormat, Scene, ShaderMaterial, SRGBColorSpace,
  Vector2, Vector3, type Texture,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { choosePlaces, elevationAt, loadPlaces, loadRelief, paintBasemap, type Place, type Relief } from "./replay-basemap";
import type { RendererContext, SceneInput, SurfaceSize, ViewRenderer } from "./replay-canvas";
import { satelliteAt } from "./replay-data";
import { upsample, type Grid } from "./replay-field";
import { geographicProjection, gridCoordinate } from "./replay-geography";
import { scaleColor, scaleLookup, volumeScale } from "./replay-palette";
import { haloText } from "./replay-plan";

const worldSpan = 2.4;
const topKm = 15;
const kmToY = .6 / topKm;
const fieldFactor = 4;
/** Terrain uses a gentler exaggeration than the atmosphere so relief reads without spikes. */
const terrainScale = .38;

/** Cloud amount 0–1 from GFS total cover (%) or infrared brightness temperature (K). */
function cloudAmount(replay: WeatherReplay, values: Grid): Grid {
  const cover = replay.metadata?.cloudVariable === "cover";
  return values.map(value => value == null ? null : Math.min(1, Math.max(0, cover ? (value - 25) / 75 : (285 - value) / 75)));
}

function fieldTexture(values: Grid, cols: number, rows: number, encode: (value: number) => number) {
  const field = upsample(values, cols, rows, fieldFactor);
  const bytes = new Uint8Array(field.width * field.height);
  for (let i = 0; i < bytes.length; i++) {
    const value = field.data[i];
    bytes[i] = Number.isNaN(value) ? 0 : Math.round(255 * Math.min(1, Math.max(0, encode(value))));
  }
  const texture = new DataTexture(bytes, field.width, field.height, RedFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D rainA, rainB, cloudA, cloudB, lut, ground;
  uniform float mixT, rainFloor, cutV, showRain, showClouds, cloudOpacity, time, streaks, kmToY, groundKm, aspect;
  uniform vec3 boxMin, boxMax, sunDir;
  varying vec3 vWorld;

  vec2 uvOf(vec3 p) { return vec2((p.x - boxMin.x) / (boxMax.x - boxMin.x), (boxMax.z - p.z) / (boxMax.z - boxMin.z)); }
  float rainAt(vec2 uv) { return mix(texture2D(rainA, uv).r, texture2D(rainB, uv).r, mixT); }
  float coverAt(vec2 uv) { return mix(texture2D(cloudA, uv).r, texture2D(cloudB, uv).r, mixT); }

  float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = .5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= .5; } return s; }

  // Cloud deck: base and depth follow the observed cover; noise only erodes edges for texture.
  float cloudDensity(vec3 p, vec2 uv, bool detail) {
    float c = coverAt(uv);
    if (c < .05) return 0.0;
    float h = p.y / kmToY;
    float base = 1.8 + (1.0 - c) * 1.4;
    if (h < base) return 0.0;
    // Billowed tops: deck depth follows cover, a low-frequency field varies the top height.
    vec2 drift = vec2(time * .012, time * .006);
    float swell = noise(vec3((uv + drift) * vec2(aspect, 1.0) * 5.0, 1.7)) * .8 + noise(vec3((uv + drift) * vec2(aspect, 1.0) * 9.0, 4.1)) * .2;
    float depth = (.5 + 4.2 * pow(c, 1.6)) * (.6 + .7 * swell) * smoothstep(.05, .35, c);
    float top = base + depth;
    if (h > top) return 0.0;
    float edge = min(h - base, top - h);
    float d = c * smoothstep(0.0, 1.1, edge) * smoothstep(.3, 1.4, depth);
    if (!detail) return d * .8;
    vec3 q = vec3((uv.x + drift.x) * aspect * 26.0, h * .55, (uv.y + drift.y) * 26.0);
    float n = fbm(q);
    return clamp(d * 1.5 - (1.0 - n) * .55 * (1.0 - smoothstep(.6, 2.2, edge)) - .08, 0.0, 1.0);
  }

  void main() {
    vec3 ray = normalize(vWorld - cameraPosition);
    vec3 inv = 1.0 / ray;
    vec3 t0 = (boxMin - cameraPosition) * inv, t1 = (boxMax - cameraPosition) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    float near = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float far = min(min(tmax.x, tmax.y), tmax.z);
    if (far <= near) discard;
    const int STEPS = 128;
    float dt = (far - near) / float(STEPS);
    float jitter = hash(vec3(gl_FragCoord.xy, time * 7.0));
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    for (int i = 0; i < STEPS; i++) {
      float t = near + (float(i) + jitter) * dt;
      vec3 p = cameraPosition + ray * t;
      vec2 uv = uvOf(p);
      if (uv.y < cutV) continue;
      float groundY = texture2D(ground, uv).r * groundKm * kmToY;
      if (p.y < groundY) break;
      float h = p.y / kmToY;
      if (showRain > .5) {
        float s = rainAt(uv);
        if (s > rainFloor) {
          // Column depth grows with surface rate; the vertical structure is schematic.
          float columnTop = 2.2 + 9.6 * s;
          if (h < columnTop) {
            float rel = h / columnTop;
            float intensity = s * (1.0 - .5 * rel * rel);
            float density = (.4 + 2.2 * s) * (1.0 - smoothstep(.62, 1.0, rel)) * smoothstep(rainFloor, rainFloor + .06, s);
            if (streaks > .5) {
              float lane = hash(vec3(floor(uv * 420.0), 3.0));
              density *= .35 + .65 * smoothstep(.45, 1.0, fract(h * .9 + time * 1.6 + lane));
            }
            float a = 1.0 - exp(-density * dt * 15.0);
            vec3 c = texture2D(lut, vec2(clamp(intensity * 1.08, 0.0, 1.0), .5)).rgb;
            c *= .9 + .35 * (1.0 - rel);
            color += (1.0 - alpha) * a * c;
            alpha += (1.0 - alpha) * a;
          }
        }
      }
      if (showClouds > .5) {
        // Clouds open up just behind the section so the rain columns on the cut face stay readable.
        float window = cutV < 0.0 ? 1.0 : smoothstep(cutV + .02, cutV + .16, uv.y);
        float d = window > .01 ? cloudDensity(p, uv, true) * window : 0.0;
        if (d > .002) {
          float shadow = 0.0;
          for (int k = 1; k <= 4; k++) {
            vec3 q = p + sunDir * float(k) * .028;
            shadow += cloudDensity(q, uvOf(q), false);
          }
          float light = exp(-shadow * .9);
          float height = clamp((h - 2.0) / 10.0, 0.0, 1.0);
          vec3 c = mix(vec3(.46, .52, .62), vec3(1.0, .985, .955), light) * (.86 + .14 * height);
          float a = (1.0 - exp(-d * dt * 16.0)) * cloudOpacity;
          color += (1.0 - alpha) * a * c;
          alpha += (1.0 - alpha) * a;
        }
      }
      if (alpha > .985) break;
    }
    if (alpha < .004) discard;
    gl_FragColor = vec4(color, alpha);
  }`;

/** Portrait viewports need a farther camera to keep the same horizontal coverage. */
const aspectFit = (aspect: number) => Math.max(1, Math.pow(1.15 / Math.max(.3, aspect), .85));

export async function createVolumeScene({ overlay, gl, invalidate, reducedMotion }: RendererContext): Promise<ViewRenderer> {
  const renderer = gl();
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, .02, 40);
  const controls = new OrbitControls(camera, overlay);
  controls.enableDamping = true;
  controls.dampingFactor = .09;
  controls.minDistance = .7;
  controls.maxDistance = 16;
  controls.maxPolarAngle = 1.42;
  controls.screenSpacePanning = false;
  controls.addEventListener("change", invalidate);
  let framedAspect = 0;
  let userMoved = false;
  controls.addEventListener("start", () => { userMoved = true; });

  const sun = new DirectionalLight(0xfff4e6, 3.4);
  sun.position.set(-2.2, 3.2, -1.4);
  scene.add(sun, new HemisphereLight(0xcfe0f2, 0x4a5444, 1.4));
  const sunDir = sun.position.clone().normalize();

  const lut = new DataTexture(scaleLookup(volumeScale), 256, 1);
  lut.magFilter = lut.minFilter = LinearFilter;
  lut.colorSpace = SRGBColorSpace;
  lut.needsUpdate = true;
  const empty = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat);
  empty.needsUpdate = true;
  const uniforms = {
    rainA: { value: empty as Texture }, rainB: { value: empty as Texture }, cloudA: { value: empty as Texture }, cloudB: { value: empty as Texture },
    lut: { value: lut as Texture }, ground: { value: empty as Texture },
    mixT: { value: 1 }, rainFloor: { value: .05 }, cutV: { value: -1 }, showRain: { value: 1 }, showClouds: { value: 1 },
    cloudOpacity: { value: .65 }, time: { value: 0 }, streaks: { value: 0 }, kmToY: { value: kmToY }, groundKm: { value: 8 }, aspect: { value: 1 },
    boxMin: { value: new Vector3() }, boxMax: { value: new Vector3() }, sunDir: { value: sunDir },
  };
  const volumeMaterial = new ShaderMaterial({
    uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, side: FrontSide, toneMapped: false,
    blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
  });
  const volume = new Mesh(new BoxGeometry(1, 1, 1), volumeMaterial);
  volume.renderOrder = 5;
  scene.add(volume);

  const groundMaterial = new MeshStandardMaterial({ roughness: .94, metalness: 0 });
  let groundMesh: Mesh<PlaneGeometry, MeshStandardMaterial> | undefined;
  const lineMaterial = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, depthTest: false });
  const guide = new LineSegments(new BufferGeometry(), lineMaterial);
  guide.renderOrder = 9;
  const arrowHeads = [new Mesh(new ConeGeometry(.018, .06, 18), new MeshBasicMaterial({ color: 0xffffff, depthTest: false })),
    new Mesh(new ConeGeometry(.016, .05, 18), new MeshBasicMaterial({ color: 0xffffff, depthTest: false }))];
  arrowHeads.forEach(head => { head.renderOrder = 10; scene.add(head); });
  scene.add(guide);

  let input: SceneInput | undefined;
  let relief: Relief | null = null;
  let places: Place[] = [];
  let built: { area: SceneInput["area"]; relief: Relief | null } | undefined;
  let projection = geographicProjection({ west: 0, east: 1, south: 0, north: 1 });
  let basemap: HTMLCanvasElement | undefined;
  let groundTexture: CanvasTexture | undefined;
  let groundKey = "";
  let heightTexture: DataTexture | undefined;
  let frameKey = "";
  let changedAt = 0;
  let disposed = false;
  let lastNow = 0;
  let exaggeration = 1;
  const textures = new Map<Grid, DataTexture>();
  const defaultView = { azimuth: -.2, polar: .98, distance: 5.0 };

  const toWorld = (lon: number, lat: number, km = 0) => {
    const [x, z] = projection.project(lon, lat);
    return new Vector3(x * worldSpan, km * kmToY, z * worldSpan);
  };

  function texture(values: Grid, kind: "rain" | "cloud", limit: number) {
    let saved = textures.get(values);
    if (!saved && input) {
      const { replay } = input;
      saved = kind === "rain"
        ? fieldTexture(values, replay.cols, replay.rows, value => Math.sqrt(Math.max(0, value) / limit))
        : fieldTexture(cloudAmount(replay, values), replay.cols, replay.rows, value => value);
      textures.set(values, saved);
      if (textures.size > 12) {
        const [oldest, old] = textures.entries().next().value!;
        if (old !== uniforms.rainA.value && old !== uniforms.rainB.value && old !== uniforms.cloudA.value && old !== uniforms.cloudB.value) old.dispose();
        textures.delete(oldest);
      }
    }
    return saved ?? empty;
  }

  function placeCamera(view = defaultView) {
    const reach = Math.max(projection.width, projection.depth) * worldSpan;
    const distance = view.distance * reach / 2.4 * aspectFit(camera.aspect);
    controls.target.set(0, .02, 0);
    camera.position.set(
      Math.sin(view.azimuth) * Math.sin(view.polar) * distance,
      .02 + Math.cos(view.polar) * distance,
      Math.cos(view.azimuth) * Math.sin(view.polar) * distance,
    );
    controls.update();
  }

  function build(area: SceneInput["area"], replay: WeatherReplay) {
    built = { area, relief };
    projection = geographicProjection(area.mapBounds);
    const width = projection.width * worldSpan, depth = projection.depth * worldSpan;
    const segmentsX = 360, segmentsZ = Math.max(8, Math.round(segmentsX * depth / width));
    const plane = new PlaneGeometry(width, depth, segmentsX, segmentsZ);
    plane.rotateX(-Math.PI / 2);
    const positions = plane.getAttribute("position");
    const { west, east, south, north } = area.mapBounds;
    for (let i = 0; i < positions.count; i++) {
      const u = (positions.getX(i) / width) + .5, v = .5 - positions.getZ(i) / depth;
      const lon = west + u * (east - west), lat = south + v * (north - south);
      const km = relief ? Math.max(0, elevationAt(relief, lon, lat)) / 1000 : 0;
      positions.setY(i, km * kmToY * terrainScale);
    }
    plane.computeVertexNormals();
    groundMesh?.geometry.dispose();
    if (groundMesh) scene.remove(groundMesh);
    // The projection is centred on the map bounds, so the plane sits at the origin.
    groundMesh = new Mesh(plane, groundMaterial);
    scene.add(groundMesh);

    const aspect = projection.width / projection.depth;
    const w = 2048, h = Math.round(w / aspect);
    basemap = paintBasemap(w, h, area.mapBounds, "terrain", area.mapPolygons, relief, 5);
    groundKey = "";

    // Data box and terrain heights for occlusion inside the volume.
    const b = replay.bounds;
    const min = toWorld(b.west, b.north), max = toWorld(b.east, b.south, topKm);
    uniforms.boxMin.value.set(min.x, 0, min.z);
    uniforms.boxMax.value.set(max.x, max.y, max.z);
    volume.scale.set(max.x - min.x, max.y, max.z - min.z);
    volume.position.set((min.x + max.x) / 2, max.y / 2, (min.z + max.z) / 2);
    uniforms.aspect.value = (max.x - min.x) / (max.z - min.z);
    const hw = 256, hh = 256;
    const heights = new Uint8Array(hw * hh);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const km = relief ? Math.max(0, elevationAt(relief, b.west + x / (hw - 1) * (b.east - b.west), b.south + y / (hh - 1) * (b.north - b.south))) / 1000 : 0;
        heights[y * hw + x] = Math.round(Math.min(1, km * terrainScale / 8) * 255);
      }
    }
    heightTexture?.dispose();
    heightTexture = new DataTexture(heights, hw, hh, RedFormat);
    heightTexture.magFilter = heightTexture.minFilter = LinearFilter;
    heightTexture.unpackAlignment = 1;
    heightTexture.needsUpdate = true;
    uniforms.ground.value = heightTexture;
    const km = (replay.bounds.east - replay.bounds.west) * 111.2 * Math.cos((b.north + b.south) * Math.PI / 360);
    exaggeration = (kmToY) / ((max.x - min.x) / km);
    placeCamera();
  }

  /** Ground: terrain colours with a translucent surface-rain footprint and a light cloud shade. */
  function paintGround(replay: WeatherReplay, rain: Grid, cover: Grid | undefined, limit: number, cutRow: number | undefined) {
    if (!basemap) return;
    const key = [rain === undefined ? "" : replay.rain.findIndex(frame => frame.values === rain), cover ? "c" : "", cutRow ?? "", limit].join("|");
    if (key === groundKey && groundTexture) return;
    groundKey = key;
    const canvas = document.createElement("canvas");
    canvas.width = basemap.width;
    canvas.height = basemap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(basemap, 0, 0);
    const area = input!.area;
    const { west, east, south, north } = area.mapBounds;
    const x = (lon: number) => (lon - west) / (east - west) * canvas.width;
    const y = (lat: number) => (north - lat) / (north - south) * canvas.height;
    const b = replay.bounds;
    const overlayImage = (values: Grid, paint: (value: number) => [number, number, number, number] | undefined) => {
      const field = upsample(values, replay.cols, replay.rows, fieldFactor);
      const image = document.createElement("canvas");
      image.width = field.width;
      image.height = field.height;
      const painter = image.getContext("2d")!;
      const pixels = painter.createImageData(field.width, field.height);
      for (let row = 0; row < field.height; row++) {
        for (let col = 0; col < field.width; col++) {
          const value = field.data[(field.height - 1 - row) * field.width + col];
          if (Number.isNaN(value)) continue;
          const rgba = paint(value);
          if (rgba) pixels.data.set(rgba, (row * field.width + col) * 4);
        }
      }
      painter.putImageData(pixels, 0, 0);
      context.drawImage(image, x(b.west), y(b.north), x(b.east) - x(b.west), y(b.south) - y(b.north));
    };
    if (cover) {
      context.globalCompositeOperation = "multiply";
      overlayImage(cloudAmount(replay, cover), value => [70, 82, 100, Math.round(110 * value * value)]);
      context.globalCompositeOperation = "source-over";
    }
    overlayImage(rain, value => {
      const s = Math.sqrt(Math.min(1, value / limit));
      if (s < .1) return;
      const [r, g, bl] = scaleColor(volumeScale, s);
      return [r, g, bl, Math.round(255 * Math.min(.58, .1 + s * .85))];
    });
    // Data extent and the section line.
    context.strokeStyle = "rgba(255,255,255,.4)";
    context.lineWidth = 2;
    context.strokeRect(x(b.west), y(b.north), x(b.east) - x(b.west), y(b.south) - y(b.north));
    // Fade the map edges into the sky so the surface reads as part of a larger planet.
    const fade = Math.round(Math.min(canvas.width, canvas.height) * .07);
    for (const [gx0, gy0, gx1, gy1, rx, ry, rw, rh] of [
      [0, 0, fade, 0, 0, 0, fade, canvas.height], [canvas.width, 0, canvas.width - fade, 0, canvas.width - fade, 0, fade, canvas.height],
      [0, 0, 0, fade, 0, 0, canvas.width, fade], [0, canvas.height, 0, canvas.height - fade, 0, canvas.height - fade, canvas.width, fade],
    ]) {
      const gradient = context.createLinearGradient(gx0, gy0, gx1, gy1);
      gradient.addColorStop(0, "rgba(22, 38, 58, 1)");
      gradient.addColorStop(1, "rgba(22, 38, 58, 0)");
      context.fillStyle = gradient;
      context.fillRect(rx, ry, rw, rh);
    }
    groundTexture?.dispose();
    groundTexture = new CanvasTexture(canvas);
    groundTexture.colorSpace = SRGBColorSpace;
    groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    groundMaterial.map = groundTexture;
    groundMaterial.needsUpdate = true;
  }

  function updateGuide(replay: WeatherReplay, cutRow: number | undefined) {
    if (cutRow === undefined) {
      guide.visible = false;
      arrowHeads.forEach(head => { head.visible = false; });
      return;
    }
    const lat = gridCoordinate(replay, 0, cutRow)[1];
    const a = toWorld(replay.bounds.west, lat, .05), b = toWorld(replay.bounds.east, lat, .05);
    const axisTop = toWorld(replay.bounds.east, lat, 13);
    guide.geometry.dispose();
    guide.geometry = new BufferGeometry();
    guide.geometry.setAttribute("position", new Float32BufferAttribute([
      a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y, b.z, axisTop.x, axisTop.y, axisTop.z,
      ...[2, 4, 6, 8, 10, 12].flatMap(km => {
        const tick = toWorld(replay.bounds.east, lat, km);
        return [tick.x, tick.y, tick.z, tick.x + .025, tick.y, tick.z];
      }),
    ], 3));
    guide.visible = true;
    const [westHead, topHead] = arrowHeads;
    westHead.position.copy(a);
    westHead.rotation.set(0, 0, Math.PI / 2);
    topHead.position.copy(axisTop);
    topHead.rotation.set(0, 0, 0);
    arrowHeads.forEach(head => { head.visible = true; });
  }

  function paintLabels(size: SurfaceSize) {
    const context = overlay.getContext("2d");
    if (!context || !input) return;
    const { replay, area, state } = input;
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const screen = (point: Vector3): [number, number, boolean] => {
      const p = point.clone().project(camera);
      return [(p.x + 1) / 2 * size.width, (1 - p.y) / 2 * size.height, p.z < 1];
    };
    context.font = "11px system-ui, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    const groundPoint = (lon: number, lat: number) => toWorld(lon, lat, relief ? Math.max(0, elevationAt(relief, lon, lat)) / 1000 * terrainScale : 0);
    for (const place of choosePlaces(places, area.mapBounds, (lon, lat) => screen(groundPoint(lon, lat)).slice(0, 2) as [number, number], size.width < 640 ? 5 : 11, 54)) {
      context.fillStyle = "rgba(255,255,255,.92)";
      context.beginPath();
      context.arc(place.x, place.y, 2, 0, Math.PI * 2);
      context.fill();
      haloText(context, place.name, place.x + 5, place.y, "rgba(245,248,250,.94)", "rgba(12,22,34,.7)", 3);
    }
    if (state.sectionRow !== undefined && area.hasData) {
      const lat = gridCoordinate(replay, 0, state.sectionRow)[1];
      context.font = "700 13px system-ui, sans-serif";
      const [ax, ay] = screen(toWorld(replay.bounds.west, lat, .05));
      const [bx, by] = screen(toWorld(replay.bounds.east, lat, .05));
      haloText(context, "A", ax - 22, ay, "#fff", "rgba(8,16,26,.8)", 4);
      haloText(context, "B", bx + 8, by + 12, "#fff", "rgba(8,16,26,.8)", 4);
      context.font = "600 11px system-ui, sans-serif";
      for (const km of [0, 4, 8, 12]) {
        const [x, y] = screen(toWorld(replay.bounds.east, lat, km));
        haloText(context, String(km), x + 12, y, "#f4f8fb", "rgba(8,16,26,.8)", 3);
      }
      const [tx, ty] = screen(toWorld(replay.bounds.east, lat, 13.6));
      context.font = "600 12px system-ui, sans-serif";
      haloText(context, "km", tx + 10, ty, "#fff", "rgba(8,16,26,.8)", 3);
    }
    if (area.hasData) {
      context.font = "10px system-ui, sans-serif";
      context.textAlign = "left";
      haloText(context, `高度为示意 · 大气垂直放大约 ${Math.round(exaggeration)} 倍，地形约 ${Math.round(exaggeration * terrainScale)} 倍`, 14, size.height - 16, "rgba(226,236,244,.8)", "rgba(8,16,26,.7)", 3);
    }
    if (state.selectedCell !== undefined && area.hasData) {
      const [lon, lat] = gridCoordinate(replay, state.selectedCell % replay.cols, Math.floor(state.selectedCell / replay.cols));
      const [x, y] = screen(groundPoint(lon, lat));
      context.strokeStyle = "#fff";
      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(x, y, 6, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#fff";
      context.beginPath();
      context.arc(x, y, 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  function update(next: SceneInput) {
    const { replay, area, state } = next;
    const reload = input?.area !== area;
    input = next;
    if (reload) {
      built = undefined;
      void Promise.all([loadRelief(area.mapBounds), loadPlaces()]).then(([r, p]) => {
        if (disposed || input?.area !== area) return;
        relief = r;
        places = p;
        groundKey = "";
        update(input);
        invalidate();
      });
    }
    if (!built || built.area !== area || built.relief !== relief) build(area, replay);
    const frame = replay.rain[state.index];
    const satellite = satelliteAt(replay, frame.time);
    const key = frame.time + "|" + (satellite?.time ?? "") + "|" + state.rainLimit;
    if (key !== frameKey) {
      const rain = texture(frame.values, "rain", state.rainLimit);
      const cloud = satellite ? texture(satellite.values, "cloud", 1) : empty;
      const first = !frameKey;
      uniforms.rainA.value = first ? rain : uniforms.rainB.value;
      uniforms.cloudA.value = first ? cloud : uniforms.cloudB.value;
      uniforms.rainB.value = rain;
      uniforms.cloudB.value = cloud;
      uniforms.mixT.value = first ? 1 : 0;
      changedAt = performance.now();
      frameKey = key;
    }
    uniforms.rainFloor.value = Math.sqrt(.3 / state.rainLimit);
    uniforms.showClouds.value = state.clouds && satellite ? 1 : 0;
    uniforms.cloudOpacity.value = state.cloudOpacity;
    uniforms.streaks.value = state.precipitation ? 1 : 0;
    uniforms.cutV.value = state.sectionRow === undefined ? -1 : state.sectionRow / (replay.rows - 1);
    uniforms.showRain.value = area.hasData ? 1 : 0;
    volume.visible = area.hasData;
    paintGround(replay, frame.values, state.clouds ? satellite?.values : undefined, state.rainLimit, state.sectionRow);
    updateGuide(replay, area.hasData ? state.sectionRow : undefined);
  }

  return {
    update,
    render(now, size) {
      if (!input) return false;
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      if (!userMoved && Math.abs(framedAspect - camera.aspect) > .02) {
        framedAspect = camera.aspect;
        placeCamera();
      }
      const moving = controls.update();
      const fading = uniforms.mixT.value < 1;
      if (fading) uniforms.mixT.value = Math.min(1, (now - changedAt) / 480);
      const animate = !reducedMotion() && uniforms.streaks.value > .5;
      if (animate) uniforms.time.value += Math.min(.05, lastNow ? (now - lastNow) / 1000 : 0);
      lastNow = animate ? now : 0;
      renderer.render(scene, camera);
      paintLabels(size);
      return moving || fading || animate;
    },
    pick(x, y) {
      if (!input || !groundMesh) return;
      const { replay } = input;
      const box = overlay.getBoundingClientRect();
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(x / box.width * 2 - 1, -(y / box.height) * 2 + 1), camera);
      const hit = raycaster.intersectObject(groundMesh)[0];
      if (!hit) return;
      const { west, east, south, north } = input.area.mapBounds;
      const u = (hit.point.x - groundMesh.position.x) / (projection.width * worldSpan) + .5;
      const v = .5 - (hit.point.z - groundMesh.position.z) / (projection.depth * worldSpan);
      const lon = west + u * (east - west), lat = south + v * (north - south);
      const b = replay.bounds;
      if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return;
      return {
        cell: Math.round((lat - b.south) / (b.north - b.south) * (replay.rows - 1)) * replay.cols
          + Math.round((lon - b.west) / (b.east - b.west) * (replay.cols - 1)),
      };
    },
    zoom(factor) {
      const offset = camera.position.clone().sub(controls.target).divideScalar(factor);
      const length = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length()));
      camera.position.copy(controls.target).add(offset.setLength(length));
      controls.update();
    },
    rotate(angle) {
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new Vector3(0, 1, 0), angle);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    reset() { userMoved = false; placeCamera(); },
    dispose() {
      disposed = true;
      controls.dispose();
      textures.forEach(texture => texture.dispose());
      [lut, empty, heightTexture, groundTexture].forEach(texture => texture?.dispose());
      volume.geometry.dispose();
      volumeMaterial.dispose();
      groundMesh?.geometry.dispose();
      groundMaterial.dispose();
      guide.geometry.dispose();
      lineMaterial.dispose();
      arrowHeads.forEach(head => { head.geometry.dispose(); (head.material as MeshBasicMaterial).dispose(); });
      overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
    },
  };
}
