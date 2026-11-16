import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, OrthographicCamera, Points, Scene,
  ShaderMaterial, SphereGeometry, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
  type Texture,
} from "three";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import { introChapters, type IntroTopic } from "./intro-chapters";

type Sample = [longitude: number, latitude: number, value: number, northVelocity?: number];
type Samples = Record<WorkspaceTopic, Sample[]>;
type Pose = { longitude: number; latitude: number; night: number };

export type IntroScene = {
  focus: (topic: IntroTopic) => void;
  pause: (paused: boolean) => void;
  dispose: () => void;
};

const radians = Math.PI / 180;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const assemblyDuration = 2100;
const focusDuration = 480;
let openingPlayed = false;

function random(seed: number) {
  const next = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return next - Math.floor(next);
}

function surface(longitude: number, latitude: number, radius: number) {
  const parallel = radius * Math.cos(latitude);
  return [
    parallel * Math.sin(longitude), radius * Math.sin(latitude), parallel * Math.cos(longitude),
  ];
}

function chapterPose(topic: IntroTopic): Pose {
  const chapter = topic ? introChapters[topic] : null;
  const [longitude, latitude] = chapter?.center ?? [58, 25];
  return { longitude, latitude, night: chapter?.night ?? 0.56 };
}

const atlasUv = `
  vec2 atlasUv(vec3 surface) {
    return vec2(atan(surface.x, surface.z) / 6.2831853 + 0.5, asin(clamp(surface.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  }
`;

const pointVertex = `
  attribute float aSeed;
  attribute float aSample;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform float uAssembly;
  uniform float uSamples;
  uniform float uPixel;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  ${atlasUv}
  void main() {
    if (aSample == 0.0) {
      vAlpha = 0.0;
      vColor = vec3(0.0);
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 1.0;
      return;
    }
    vec3 surface = normalize(position);
    vec2 uv = atlasUv(surface);
    vec3 terrain = texture2D(uDay, uv).rgb;
    float land = smoothstep(0.002, 0.045, max(terrain.r, terrain.g) - terrain.b * 0.44);
    float city = smoothstep(0.005, 0.19, texture2D(uNight, uv).r);

    vec3 view = mat3(modelViewMatrix) * position;
    vec3 normal = normalize(view);
    // Nearby points arrive together in a sweep, with a small offset between individual points.
    float band = 0.5 + 0.5 * sin(uv.x * 6.2831853 + surface.y * 1.6);
    float delay = band * 0.22 + aSeed * 0.09;
    float progress = smoothstep(delay, 0.78 + delay * 0.70, uAssembly);
    float remaining = 1.0 - progress;
    float angle = remaining * (0.72 + band * 0.63 + aSeed * 0.26);
    mat2 turn = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    view.xy = turn * view.xy * (1.0 + remaining * (0.08 + aSeed * 0.27));
    gl_Position = projectionMatrix * vec4(view + modelViewMatrix[3].xyz, 1.0);

    float sampleStrength = max(aSample, 0.0);
    float signal = 0.17 + land * 0.62 + city * 0.85 + sampleStrength * 0.41;
    float pulse = 0.87 + 0.13 * sin(uTime * 1.2 + uv.x * 6.2831853 + surface.y * 3.8 + aSeed);
    float front = smoothstep(-0.19, 0.38, normal.z);
    float presence = aSample < 0.0 ? 1.0 : sampleStrength * uSamples;
    vAlpha = presence * signal * pulse * mix(0.63 + front * 0.22, front, progress);
    vAlpha *= smoothstep(0.01, 0.18, uAssembly) * (0.70 + aSeed * 0.30);
    vColor = mix(vec3(0.14, 0.16, 0.83), vec3(0.55, 0.23, 0.97), clamp(land * 0.55 + city * 0.4 + aSeed * 0.35, 0.0, 1.0));
    gl_PointSize = (1.25 + land * 0.42 + city * 1.52 + sampleStrength * 0.72 + aSeed * 0.55) * uPixel;
  }
`;

const pointFragment = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float halo = 1.0 - smoothstep(0.06, 0.5, radius);
    float core = 1.0 - smoothstep(0.02, 0.26, radius);
    gl_FragColor = vec4(vColor, vAlpha * (halo * 0.48 + core * 0.52));
    #include <colorspace_fragment>
  }
`;

const globeVertex = `
  varying vec3 vSurface;
  varying vec3 vFacing;
  void main() {
    vSurface = normalize(position);
    vFacing = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const globeFragment = `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform float uNightAmount;
  uniform float uReveal;
  varying vec3 vSurface;
  varying vec3 vFacing;
  ${atlasUv}
  void main() {
    vec2 uv = atlasUv(normalize(vSurface));
    vec3 facing = normalize(vFacing);
    vec3 terrain = texture2D(uDay, uv).rgb;
    float land = smoothstep(0.001, 0.10, max(terrain.r, terrain.g) - terrain.b * 0.48);
    float lights = smoothstep(0.002, 0.28, texture2D(uNight, uv).r);
    float light = max(0.0, dot(facing, normalize(vec3(-0.5, 0.42, 0.75))));
    float rim = pow(1.0 - max(facing.z, 0.0), 2.5);
    vec3 color = vec3(0.003, 0.003, 0.014);
    color += vec3(0.010, 0.006, 0.027) * land * (0.30 + 0.70 * light) * (1.0 - 0.42 * uNightAmount);
    color += vec3(0.057, 0.019, 0.15) * lights * (0.42 + 0.58 * uNightAmount);
    color += vec3(0.027, 0.029, 0.083) * rim * (0.26 + 0.74 * light);
    gl_FragColor = vec4(color, uReveal * smoothstep(0.0, 0.22, facing.z));
    #include <colorspace_fragment>
  }
`;

export function createIntroScene(
  canvas: HTMLCanvasElement,
  initialTopic: IntroTopic,
  initiallyPaused: boolean,
  onReady: () => void,
  onFail: () => void,
): IntroScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.z = 4;
  const host = canvas.parentElement ?? canvas;
  const atlas = { uDay: { value: null as Texture | null }, uNight: { value: null as Texture | null } };
  const globeGeometry = new SphereGeometry(1, 80, 52);
  const globeMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...atlas, uNightAmount: { value: 0 }, uReveal: { value: 0 } },
    vertexShader: globeVertex,
    fragmentShader: globeFragment,
  });
  const globe = new Mesh(globeGeometry, globeMaterial);
  scene.add(globe);

  const pointCount = window.innerWidth <= 700 ? 14000 : 30000;
  const sampleCount = Math.round(pointCount * 0.19);
  const count = pointCount + sampleCount;
  const positions = new Float32Array(count * 3);
  const strengths = new Float32Array(count);
  strengths.fill(-1, 0, pointCount);
  for (let i = 0; i < pointCount; i++) {
    const latitude = Math.asin(1 - 2 * (i + 0.5) / pointCount);
    const longitude = goldenAngle * i;
    positions.set(surface(longitude, latitude, 1.005 + random(i * 11) * 0.017), i * 3);
  }

  const pointGeometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const strengthAttribute = new BufferAttribute(strengths, 1).setUsage(DynamicDrawUsage);
  pointGeometry.setAttribute("position", positionAttribute);
  pointGeometry.setAttribute("aSample", strengthAttribute);
  pointGeometry.setAttribute("aSeed", new BufferAttribute(Float32Array.from({ length: count }, (_, i) => random(i * 7 + 19)), 1));
  const pointMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...atlas, uAssembly: { value: 0 }, uSamples: { value: 0 }, uPixel: { value: 1 }, uTime: { value: 0 } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });
  const particles = new Points(pointGeometry, pointMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 1;
  scene.add(particles);

  const xAxis = new Vector3(1, 0, 0);
  const yAxis = new Vector3(0, 1, 0);
  const viewport = new Vector2();
  const textures = new Set<Texture>();
  const controller = new AbortController();
  const loader = new TextureLoader();
  let data: Partial<Samples> = {};
  let topic = initialTopic;
  let selected = chapterPose(topic);
  let from = selected;
  let current = selected;
  let width = 1;
  let height = 1;
  let compact = false;
  let paused = initiallyPaused;
  let disposed = false;
  let ready = false;
  let frame = 0;
  let last = 0;
  let time = 0;
  let assembly = 0;
  let focusTime = focusDuration;

  function updateSamples() {
    const samples = topic ? data[topic] : undefined;
    strengths.fill(0, pointCount);
    if (samples?.length) {
      const visible = Math.min(sampleCount, samples.length * 7);
      for (let i = 0; i < visible; i++) {
        const [longitude, latitude, weight, north = 0] = samples[i % samples.length];
        const copy = Math.floor(i / samples.length);
        const jitter = copy * 0.16;
        const angle = random(i * 5) * Math.PI * 2;
        const lon = longitude + (topic === "weather" ? weight * jitter * 0.24 : Math.cos(angle) * jitter);
        const lat = latitude + (topic === "weather" ? north * jitter * 0.24 : Math.sin(angle) * jitter);
        const strength = topic === "weather" ? Math.min(1, Math.hypot(weight, north) / 26) : weight;
        positions.set(surface(lon * radians, lat * radians, 1.019), (pointCount + i) * 3);
        strengths[pointCount + i] = (0.20 + 0.8 * strength) * (copy === 0 ? 1 : 0.52);
      }
    }
    positionAttribute.needsUpdate = true;
    strengthAttribute.needsUpdate = true;
  }

  function draw() {
    const progress = assembly / assemblyDuration;
    const ease = focusTime / focusDuration;
    const blend = ease * ease * (3 - 2 * ease);
    current = {
      longitude: from.longitude + (selected.longitude - from.longitude) * blend,
      latitude: from.latitude + (selected.latitude - from.latitude) * blend,
      night: from.night + (selected.night - from.night) * blend,
    };
    const drift = Math.sin(time / 15000) * 7;
    const aspect = width / height;
    const size = (compact ? 0.88 : 0.76) * Math.min(width, height) / height;
    globe.rotation.set(0, 0, 0);
    globe.rotateOnWorldAxis(yAxis, -(current.longitude + drift) * radians);
    globe.rotateOnWorldAxis(xAxis, current.latitude * radians);
    globe.scale.setScalar(size);
    globe.position.set(compact ? 0 : 0.21 * aspect, compact ? 0.40 : 0.13, 0);
    particles.rotation.copy(globe.rotation);
    particles.position.copy(globe.position);
    particles.scale.copy(globe.scale);
    globeMaterial.uniforms.uNightAmount.value = current.night;
    globeMaterial.uniforms.uReveal.value = Math.max(0, Math.min(1, (progress - 0.32) / 0.63));
    pointMaterial.uniforms.uAssembly.value = progress;
    pointMaterial.uniforms.uSamples.value = blend;
    pointMaterial.uniforms.uTime.value = time / 1000;
    renderer.render(scene, camera);
  }

  function paint(now: number) {
    frame = 0;
    const elapsed = last ? Math.min(60, now - last) : 0;
    last = now;
    time += elapsed;
    assembly = Math.min(assemblyDuration, assembly + elapsed);
    focusTime = Math.min(focusDuration, focusTime + elapsed);
    draw();
    schedule();
  }

  function schedule() {
    if (!ready || disposed || frame || document.hidden || paused) return;
    frame = requestAnimationFrame(paint);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  function fit() {
    compact = window.innerWidth <= 700;
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    camera.left = -aspect;
    camera.right = aspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.55));
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(viewport);
    pointMaterial.uniforms.uPixel.value = viewport.x / width;
    if (ready) draw();
  }

  const resize = new ResizeObserver(fit);
  resize.observe(host);
  fit();

  async function readTexture(name: string) {
    const texture = await loader.loadAsync(`/intro/atlas-${name}.webp`);
    if (disposed) texture.dispose();
    else {
      texture.colorSpace = SRGBColorSpace;
      textures.add(texture);
    }
    return texture;
  }

  Promise.all([
    readTexture("day"),
    readTexture("night"),
    fetch("/intro/atlas-samples.json", { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error("Opening data unavailable.");
      return response.json() as Promise<Samples>;
    }).catch(() => ({})),
  ]).then(([day, night, samples]) => {
    if (disposed) return;
    atlas.uDay.value = day;
    atlas.uNight.value = night;
    data = samples;
    updateSamples();
    assembly = openingPlayed || paused ? assemblyDuration : 0;
    ready = true;
    draw();
    openingPlayed = true;
    onReady();
    schedule();
  }).catch(() => { if (!disposed) onFail(); });

  function visibility() {
    if (document.hidden) stop();
    else schedule();
  }

  function lost(event: Event) {
    event.preventDefault();
    stop();
    if (!disposed) onFail();
  }

  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", lost);

  return {
    focus(next) {
      if (next === topic) return;
      topic = next;
      from = current;
      selected = chapterPose(next);
      focusTime = !ready || paused ? focusDuration : 0;
      if (ready) {
        updateSamples();
        if (paused) draw();
      }
    },
    pause(value) {
      if (paused === value) return;
      paused = value;
      if (paused) stop();
      else schedule();
    },
    dispose() {
      disposed = true;
      stop();
      controller.abort();
      resize.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("webglcontextlost", lost);
      scene.clear();
      pointGeometry.dispose();
      pointMaterial.dispose();
      globeGeometry.dispose();
      globeMaterial.dispose();
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
    },
  };
}
