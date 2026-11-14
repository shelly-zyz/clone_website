import {
  BufferAttribute, BufferGeometry, Color, DataTexture, LinearFilter, Mesh, OrthographicCamera,
  Points, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Texture, TextureLoader,
  Vector2, Vector3, WebGLRenderer,
} from "three";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import { introChapters, type IntroTopic } from "./intro-chapters";

type Sample = [longitude: number, latitude: number, value: number, northVelocity?: number];
type Samples = Record<WorkspaceTopic, Sample[]>;
type ParticleSet = { positions: Float32Array; colors: Float32Array };
type Pose = {
  longitude: number;
  latitude: number;
  diameter: number;
  offsetX: number;
  offsetY: number;
  night: number;
};

export type IntroScene = {
  focus: (topic: IntroTopic) => void;
  pause: (paused: boolean) => void;
  replay: () => void;
  fly: (topic: WorkspaceTopic, finish: (frame?: string) => void) => void;
  cancelFlight: () => void;
  dispose: () => void;
};

const background = new Color("#090e11");
const radians = Math.PI / 180;
const overviewColor = "#cdeae0";
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const loading = { longitude: 46, latitude: 25, diameter: 0.89, offsetX: 0.1, offsetY: 0.09, night: 0.49 };

function random(seed: number) {
  const next = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return next - Math.floor(next);
}

function surface(lon: number, lat: number, radius: number): [number, number, number] {
  const longitude = lon * radians;
  const latitude = lat * radians;
  const parallel = radius * Math.cos(latitude);
  return [parallel * Math.sin(longitude), radius * Math.sin(latitude), parallel * Math.cos(longitude)];
}

function pointsFor(topic: IntroTopic, count: number, points: Samples): ParticleSet {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const data = topic ? points[topic] : [];
  const color = new Color(topic ? introChapters[topic].particleColor : overviewColor);
  const dataStart = Math.floor(count * 0.72);
  const set = (index: number, longitude: number, latitude: number, radius: number, strength: number) => {
    const offset = index * 3;
    positions.set(surface(longitude, latitude, radius), offset);
    colors[offset] = color.r * strength;
    colors[offset + 1] = color.g * strength;
    colors[offset + 2] = color.b * strength;
  };

  for (let i = 0; i < count; i += 1) {
    if (i < dataStart || !data.length) {
      const latitude = Math.asin(1 - 2 * (i + 0.5) / (data.length ? dataStart : count)) / radians;
      const longitude = (goldenAngle * i / radians) % 360;
      const radius = 1.006 + random(i * 11) * 0.026;
      set(i, longitude, latitude, radius, 0.045 + random(i * 13) * 0.12);
      continue;
    }

    const relativeIndex = i - dataStart;
    const [longitude, latitude, weight, north] = data[relativeIndex % data.length];
    const orbit = Math.floor(relativeIndex / data.length);
    if (topic === "weather") {
      const speed = Math.hypot(weight, north ?? 0);
      const share = Math.min(1, orbit / 10);
      const parallel = Math.max(0.43, Math.cos(latitude * radians));
      set(i, longitude + share * weight * 0.22 / parallel,
        latitude + share * (north ?? 0) * 0.22, 1.01 + share * 0.01,
        Math.min(1.3, 0.12 + speed * 0.044) * (0.28 + 0.56 * share));
      continue;
    }

    const distance = orbit === 0 ? 0 : (random(i * 3) * 0.75 + 0.25) * 0.72;
    const angle = random(i * 5) * Math.PI * 2;
    const radius = 1.01 + distance * 0.021 + (topic === "economy" ? orbit * weight * 0.0053 : weight * 0.023);
    const strength = (orbit === 0 ? 1.21 : 0.78 / (1 + distance)) * (0.18 + 0.82 * weight);
    set(i, longitude + Math.cos(angle) * distance, latitude + Math.sin(angle) * distance, radius, strength);
  }

  return { positions, colors };
}

function scatterFor(target: ParticleSet) {
  const positions = target.positions.slice();
  const colors = target.colors.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const spread = 1.07 + 0.63 * random(i * 17);
    positions[i] *= spread;
    positions[i + 1] *= spread;
    positions[i + 2] *= spread;
    colors[i] *= 1.6;
    colors[i + 1] *= 1.6;
    colors[i + 2] *= 1.6;
  }
  return { positions, colors };
}

const pointVertex = `
  attribute vec3 aEnd;
  attribute vec3 aBaseColor;
  attribute vec3 aNextColor;
  attribute float aDelay;
  uniform float uProgress;
  uniform float uWave;
  uniform float uPixel;
  varying vec3 vColor;
  varying float vDepth;
  void main() {
    float t = clamp((uProgress - (aDelay * 0.17)) / (1.0 - aDelay * 0.17), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    vec3 p = mix(position, aEnd, t);
    vec3 normal = normalize(p + vec3(0.00001));
    float spread = sin(t * 3.14159265) * uWave * (0.18 + aDelay * 0.82);
    p += normal * spread;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    vColor = mix(aBaseColor, aNextColor, t);
    vDepth = (modelViewMatrix * vec4(normal, 0.0)).z;
    float hot = min(1.0, 1.25 * max(max(vColor.r, vColor.g), vColor.b));
    gl_PointSize = (0.88 + hot * 1.94 + (1.0 - abs(vDepth)) * 0.28) * uPixel;
  }
`;

const pointFragment = `
  varying vec3 vColor;
  varying float vDepth;
  void main() {
    float r = length(gl_PointCoord - vec2(0.5));
    float core = 1.0 - smoothstep(0.1, 0.48, r);
    float alpha = core * smoothstep(-0.16, 0.38, vDepth);
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(vColor * (0.75 + core * 0.43), alpha);
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
  uniform vec3 uBackground;
  varying vec3 vSurface;
  varying vec3 vFacing;
  void main() {
    vec3 s = normalize(vSurface);
    vec3 facing = normalize(vFacing);
    vec2 uv = vec2(atan(s.x, s.z) / 6.2831853 + 0.5, asin(s.y) / 3.14159265 + 0.5);
    vec3 terrain = texture2D(uDay, uv).rgb;
    vec3 lights = texture2D(uNight, uv).rgb;
    float sun = max(0.0, dot(facing, normalize(vec3(-0.62, 0.45, 0.8))));
    float rim = pow(1.0 - max(facing.z, 0.0), 3.5);
    float shade = 0.17 + 0.49 * sun;
    vec3 day = (terrain * vec3(0.76, 0.83, 0.82) + vec3(0.009, 0.022, 0.028)) * shade;
    vec3 night = lights * vec3(0.52, 0.44, 0.27) + day * 0.15 + vec3(0.007, 0.014, 0.019);
    vec3 color = mix(day, night, uNightAmount);
    color += rim * (0.17 + 0.42 * sun) * vec3(0.089, 0.22, 0.28);
    gl_FragColor = vec4(mix(uBackground, color, uReveal), 1.0);
    #include <colorspace_fragment>
  }
`;

function targetPose(topic: IntroTopic, compact: boolean, flying = false): Pose {
  const chapter = topic ? introChapters[topic] : null;
  const [longitude, latitude] = (flying ? chapter?.handoffCenter : chapter?.center)
    ?? [loading.longitude, loading.latitude];

  return {
    longitude,
    latitude,
    diameter: flying ? 0.77 : compact ? 0.93 : 0.88,
    offsetX: compact ? 0 : flying ? (topic === "power" || topic === "carbon" ? 0.125 : 0) : 0.105,
    offsetY: flying ? 0.018 : compact ? 0.18 : 0.097,
    night: chapter?.night ?? loading.night,
  };
}

function blendPose(from: Pose, to: Pose, ratio: number): Pose {
  const mix = (left: number, right: number) => left + (right - left) * ratio;
  const drift = Math.sin(ratio * Math.PI) * 1.9;
  return {
    longitude: mix(from.longitude, to.longitude),
    latitude: mix(from.latitude, to.latitude) + drift,
    diameter: mix(from.diameter, to.diameter),
    offsetX: mix(from.offsetX, to.offsetX),
    offsetY: mix(from.offsetY, to.offsetY),
    night: mix(from.night, to.night),
  };
}

function darkTexture() {
  const texture = new DataTexture(new Uint8Array([13, 28, 34, 255]), 1, 1);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

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
  const textures = new Set<Texture>();
  const globeTexture = darkTexture();
  textures.add(globeTexture);

  const globeGeometry = new SphereGeometry(1, 86, 54);
  const globeMaterial = new ShaderMaterial({
    uniforms: {
      uDay: { value: globeTexture },
      uNight: { value: globeTexture },
      uNightAmount: { value: 0 },
      uReveal: { value: 0 },
      uBackground: { value: background },
    },
    vertexShader: globeVertex,
    fragmentShader: globeFragment,
  });
  const globe = new Mesh(globeGeometry, globeMaterial);
  globe.renderOrder = 0;
  scene.add(globe);

  function isCompact() { return window.innerWidth <= 700; }
  const count = isCompact() ? 15000 : 40000;
  const variants = new Map<IntroTopic, ParticleSet>();
  let topic = initialTopic;
  let samples: Samples = { power: [], weather: [], carbon: [], economy: [] };
  function variant(key: IntroTopic) {
    const existing = variants.get(key);
    if (existing) return existing;
    const next = pointsFor(key, count, samples);
    variants.set(key, next);
    return next;
  }

  let end = variant(topic);
  let start: ParticleSet = scatterFor(end);
  const delays = Float32Array.from({ length: count }, (_, i) => random(i * 7 + 19));
  const pointGeometry = new BufferGeometry();
  const starting = new BufferAttribute(start.positions.slice(), 3);
  const ending = new BufferAttribute(end.positions.slice(), 3);
  const fromColors = new BufferAttribute(start.colors.slice(), 3);
  const toColors = new BufferAttribute(end.colors.slice(), 3);
  pointGeometry.setAttribute("position", starting);
  pointGeometry.setAttribute("aEnd", ending);
  pointGeometry.setAttribute("aBaseColor", fromColors);
  pointGeometry.setAttribute("aNextColor", toColors);
  pointGeometry.setAttribute("aDelay", new BufferAttribute(delays, 1));
  const pointMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uProgress: { value: 0 }, uWave: { value: 0.22 }, uPixel: { value: 1 } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });
  const particles = new Points(pointGeometry, pointMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 1;
  scene.add(particles);

  let width = 1;
  let height = 1;
  let paused = initiallyPaused;
  let disposed = false;
  let ready = false;
  let time = 0;
  let tick = 0;
  let last = 0;
  let frame = 0;
  let gesture: { finish: (frame?: string) => void } | null = null;
  let settle = 790;
  let reveal = 0;
  let wave = 0.21;
  let idleTurn = 0;
  let chosen = targetPose(topic, isCompact());
  let from = { ...chosen, longitude: chosen.longitude - 12, diameter: chosen.diameter * 0.88 };
  let current = from;
  const xAxis = new Vector3(1, 0, 0);
  const yAxis = new Vector3(0, 1, 0);
  const viewport = new Vector2();

  function rawProgress() { return Math.min(1, tick / settle); }

  function movePoints(next: ParticleSet, reset: boolean) {
    const progress = rawProgress();
    if (reset) start = scatterFor(next);
    else if (progress >= 1) start = end;
    else {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      // Match the shader's current curve when a fresh chapter interrupts the transition.
      for (let i = 0; i < count; i += 1) {
        let t = Math.max(0, Math.min(1, (progress - delays[i] * 0.17) / (1 - delays[i] * 0.17)));
        t *= t * (3 - 2 * t);
        const at = i * 3;
        const x = start.positions[at] + (end.positions[at] - start.positions[at]) * t;
        const y = start.positions[at + 1] + (end.positions[at + 1] - start.positions[at + 1]) * t;
        const z = start.positions[at + 2] + (end.positions[at + 2] - start.positions[at + 2]) * t;
        const length = Math.hypot(x, y, z) || 1;
        const scale = 1 + Math.sin(t * Math.PI) * wave * (0.18 + delays[i] * 0.82) / length;
        positions[at] = x * scale;
        positions[at + 1] = y * scale;
        positions[at + 2] = z * scale;
        for (let j = at; j < at + 3; j += 1) colors[j] = start.colors[j] + (end.colors[j] - start.colors[j]) * t;
      }
      start = { positions, colors };
    }
    end = next;
    starting.copyArray(start.positions);
    starting.needsUpdate = true;
    ending.copyArray(end.positions);
    ending.needsUpdate = true;
    fromColors.copyArray(start.colors);
    fromColors.needsUpdate = true;
    toColors.copyArray(end.colors);
    toColors.needsUpdate = true;
  }

  function draw() {
    const progress = rawProgress();
    const eased = 1 - (1 - progress) ** 3;
    current = blendPose(from, chosen, eased);
    const aspect = width / height;
    const radius = current.diameter * Math.min(width, height) / height;
    const turn = gesture ? 0 : idleTurn;
    globe.rotation.set(0, 0, 0);
    globe.rotateOnWorldAxis(yAxis, -(current.longitude + turn) * radians);
    globe.rotateOnWorldAxis(xAxis, current.latitude * radians);
    globe.scale.setScalar(radius);
    globe.position.set(current.offsetX * aspect * 2, current.offsetY * 2, 0);
    particles.rotation.copy(globe.rotation);
    particles.position.copy(globe.position);
    particles.scale.copy(globe.scale);
    globeMaterial.uniforms.uNightAmount.value = current.night;
    globeMaterial.uniforms.uReveal.value = reveal;
    pointMaterial.uniforms.uProgress.value = progress;
    pointMaterial.uniforms.uWave.value = wave;
    renderer.render(scene, camera);
  }

  function capture() {
    const image = document.createElement("canvas");
    const longSide = Math.max(width, height);
    const scale = Math.min(1, 1440 / longSide);
    image.width = Math.round(width * scale);
    image.height = Math.round(height * scale);
    const context = image.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#090e11";
    context.fillRect(0, 0, image.width, image.height);
    context.drawImage(canvas, 0, 0, image.width, image.height);
    return image.toDataURL("image/jpeg", 0.81);
  }

  function paint(now: number) {
    frame = 0;
    const elapsed = last ? (gesture ? now - last : Math.min(60, now - last)) : 0;
    last = now;
    if (!gesture && !paused) {
      time += elapsed;
      idleTurn = Math.sin(time / 13000) * 8.5;
    }
    tick += elapsed;
    reveal = Math.min(1, reveal + elapsed / 430);
    draw();
    if (gesture && rawProgress() === 1) {
      const finish = gesture.finish;
      gesture = null;
      let image: string | undefined;
      try { image = capture(); } catch { /* The workspace can use its static preview. */ }
      finish(image);
      return;
    }
    schedule();
  }

  function schedule() {
    if (!ready || disposed || frame || document.hidden || (paused && !gesture)) return;
    frame = requestAnimationFrame(paint);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  function fit() {
    const compact = isCompact();
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
    chosen = targetPose(topic, compact, Boolean(gesture));
    if (ready) draw();
  }

  function focus(next: IntroTopic, restart = false, flying = false) {
    const target = variant(next);
    movePoints(target, restart);
    topic = next;
    from = flying ? { ...current, longitude: current.longitude + idleTurn } : current;
    chosen = targetPose(next, isCompact(), flying);
    settle = flying ? 370 : restart ? 790 : 640;
    tick = paused && !flying ? settle : 0;
    wave = flying ? 0.045 : restart ? 0.21 : 0.16;
    if (restart) {
      reveal = paused ? 1 : 0.07;
      from = { ...chosen, longitude: chosen.longitude - 11, diameter: chosen.diameter * 0.87 };
    }
    if (ready) draw();
    schedule();
  }

  const resize = new ResizeObserver(fit);
  resize.observe(host);
  fit();

  const controller = new AbortController();
  const loader = new TextureLoader();
  async function readTexture(name: string) {
    const texture = await loader.loadAsync(`/intro/atlas-${name}.webp`);
    if (disposed) {
      texture.dispose();
      return globeTexture;
    }
    texture.colorSpace = SRGBColorSpace;
    textures.add(texture);
    return texture;
  }

  Promise.all([
    readTexture("day"),
    readTexture("night"),
    fetch("/intro/atlas-samples.json", { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error("Opening data unavailable.");
      return response.json() as Promise<Samples>;
    }).catch(() => samples),
  ]).then(([day, night, data]) => {
    if (disposed) return;
    globeMaterial.uniforms.uDay.value = day;
    globeMaterial.uniforms.uNight.value = night;
    samples = data;
    variants.clear();
    ready = true;
    focus(topic, true);
    onReady();
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
    focus(next) { if (next !== topic) focus(next); },
    pause(value) {
      if (paused === value) return;
      paused = value;
      if (paused) {
        if (!gesture) stop();
      } else {
        schedule();
      }
    },
    replay: () => focus(topic, true),
    fly(next, finish) {
      if (!ready || paused || document.hidden) {
        finish();
        return;
      }
      gesture = { finish };
      focus(next, false, true);
    },
    cancelFlight() {
      if (!gesture && rawProgress() === 1) return;
      gesture = null;
      time = 0;
      idleTurn = 0;
      focus(topic);
    },
    dispose() {
      disposed = true;
      gesture = null;
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
