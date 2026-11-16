import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, OrthographicCamera, Points, Scene,
  ShaderMaterial, SphereGeometry, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
  type Texture,
} from "three";
export type IntroScene = {
  pause: (paused: boolean) => void;
  dispose: () => void;
};

const radians = Math.PI / 180;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const assemblyDuration = 2.2;
const loopDuration = 13.5;

function smoothstep(start: number, end: number, time: number) {
  const position = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return position * position * (3 - 2 * position);
}

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

const atlasUv = `
  vec2 atlasUv(vec3 surface) {
    return vec2(atan(surface.x, surface.z) / 6.2831853 + 0.5, asin(clamp(surface.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  }
`;

const pointVertex = `
  attribute float aSeed;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform float uAssembly;
  uniform float uOpacity;
  uniform float uPixel;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  ${atlasUv}
  void main() {
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

    float signal = 0.17 + land * 0.62 + city * 0.85;
    float pulse = 0.87 + 0.13 * sin(uTime * 1.2 + uv.x * 6.2831853 + surface.y * 3.8 + aSeed);
    float front = smoothstep(-0.19, 0.38, normal.z);
    vAlpha = uOpacity * signal * pulse * mix(0.63 + front * 0.22, front, progress);
    vAlpha *= smoothstep(0.01, 0.18, uAssembly) * (0.70 + aSeed * 0.30);
    vColor = mix(vec3(0.14, 0.16, 0.83), vec3(0.55, 0.23, 0.97), clamp(land * 0.55 + city * 0.4 + aSeed * 0.35, 0.0, 1.0));
    gl_PointSize = (1.25 + land * 0.42 + city * 1.52 + aSeed * 0.55) * uPixel;
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
    color += vec3(0.010, 0.006, 0.027) * land * (0.30 + 0.70 * light);
    color += vec3(0.057, 0.019, 0.15) * lights;
    color += vec3(0.027, 0.029, 0.083) * rim * (0.26 + 0.74 * light);
    gl_FragColor = vec4(color, uReveal * smoothstep(0.0, 0.22, facing.z));
    #include <colorspace_fragment>
  }
`;

const arcVertex = `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aAlong;
  attribute float aLaunch;
  attribute float aTint;
  uniform float uHalfWidth;
  uniform float uRadius;
  varying float vSide;
  varying float vAlong;
  varying float vLaunch;
  varying float vTint;
  varying float vVisible;

  void main() {
    vec3 view = mat3(modelViewMatrix) * position;
    vec2 tangent = (mat3(modelViewMatrix) * aTangent).xy;
    vec2 normal = vec2(-tangent.y, tangent.x) / max(length(tangent), 0.0001);
    gl_Position = projectionMatrix * vec4(view + modelViewMatrix[3].xyz + vec3(normal * aSide * uHalfWidth, 0.0), 1.0);
    vVisible = max(smoothstep(-0.035, 0.045, view.z / uRadius),
                   smoothstep(0.99, 1.035, length(view.xy) / uRadius));
    vSide = aSide;
    vAlong = aAlong;
    vLaunch = aLaunch;
    vTint = aTint;
  }
`;

const arcFragment = `
  uniform float uArcTime;
  varying float vSide;
  varying float vAlong;
  varying float vLaunch;
  varying float vTint;
  varying float vVisible;

  void main() {
    float age = uArcTime - vLaunch;
    float distanceFromHead = age / 1.45 - vAlong;
    float revealed = smoothstep(-0.025, 0.012, distanceFromHead);
    float trail = 1.0 - smoothstep(0.18, 1.19, distanceFromHead);
    float head = 1.0 - smoothstep(0.0, 0.09, abs(distanceFromHead));
    float width = abs(vSide);
    float profile = 0.68 * (1.0 - smoothstep(0.0, 0.30, width))
                  + 0.32 * (1.0 - smoothstep(0.0, 1.0, width));
    float alpha = profile * vVisible * revealed * trail * smoothstep(0.0, 0.17, age);
    vec3 base = mix(vec3(0.32, 0.077, 1.0), vec3(0.035, 0.34, 0.98), vTint);
    gl_FragColor = vec4(mix(base, vec3(0.72, 0.66, 1.0), head * 0.70), alpha * (0.64 + 0.36 * head));
    #include <colorspace_fragment>
  }
`;

function createArcs() {
  // Illustrative city-to-city paths for the opening animation.
  const hubs = {
    beijing: [116, 40],
    delhi: [77, 29],
    tokyo: [140, 36],
    sydney: [151, -34],
    dubai: [55, 25],
    singapore: [104, 1],
    nairobi: [37, -1],
    london: [-0.1, 51],
    anchorage: [-150, 61],
    vancouver: [-123, 49],
    honolulu: [-158, 21],
    mexicoCity: [-99, 19],
    losAngeles: [-118, 34],
    newYork: [-74, 41],
    lima: [-77, -12],
    saoPaulo: [-47, -24],
  } as const;
  const routes: [keyof typeof hubs, keyof typeof hubs, launch: number, lift: number][] = [
    ["beijing", "singapore", 2.80, 0.19],
    ["beijing", "delhi", 2.97, 0.15],
    ["beijing", "tokyo", 3.10, 0.11],
    ["beijing", "dubai", 3.24, 0.24],
    ["beijing", "sydney", 3.40, 0.29],
    ["beijing", "london", 3.63, 0.30],
    ["delhi", "nairobi", 3.82, 0.22],
    ["tokyo", "anchorage", 4.30, 0.27],
    ["tokyo", "honolulu", 4.65, 0.29],
    ["tokyo", "vancouver", 5.08, 0.31],
    ["honolulu", "sydney", 5.40, 0.23],
    ["honolulu", "mexicoCity", 5.75, 0.19],
    ["losAngeles", "vancouver", 6.40, 0.13],
    ["losAngeles", "lima", 6.74, 0.22],
    ["losAngeles", "newYork", 7.05, 0.22],
    ["newYork", "saoPaulo", 8.42, 0.26],
    ["newYork", "london", 8.64, 0.30],
  ];
  const positions: number[] = [];
  const tangents: number[] = [];
  const sides: number[] = [];
  const spans: number[] = [];
  const launches: number[] = [];
  const tints: number[] = [];
  const indices: number[] = [];
  const steps = 48;

  routes.forEach(([from, to, launch, lift], route) => {
    const start = new Vector3(...surface(hubs[from][0] * radians, hubs[from][1] * radians, 1));
    const end = new Vector3(...surface(hubs[to][0] * radians, hubs[to][1] * radians, 1));
    const theta = start.angleTo(end);
    const path = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      return start.clone().multiplyScalar(Math.sin((1 - t) * theta))
        .addScaledVector(end, Math.sin(t * theta))
        .multiplyScalar((1.013 + lift * Math.sin(Math.PI * t)) / Math.sin(theta));
    });
    const offset = sides.length;
    path.forEach((position, i) => {
      const tangent = path[Math.min(steps, i + 1)].clone().sub(path[Math.max(0, i - 1)]).normalize();
      for (const side of [-1, 1]) {
        positions.push(position.x, position.y, position.z);
        tangents.push(tangent.x, tangent.y, tangent.z);
        sides.push(side);
        spans.push(i / steps);
        launches.push(launch);
        tints.push(route % 3 === 0 ? 0.9 : 0.12);
      }
      if (i === steps) return;
      const at = offset + i * 2;
      indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
    });
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("aTangent", new BufferAttribute(new Float32Array(tangents), 3));
  geometry.setAttribute("aSide", new BufferAttribute(new Float32Array(sides), 1));
  geometry.setAttribute("aAlong", new BufferAttribute(new Float32Array(spans), 1));
  geometry.setAttribute("aLaunch", new BufferAttribute(new Float32Array(launches), 1));
  geometry.setAttribute("aTint", new BufferAttribute(new Float32Array(tints), 1));
  geometry.setIndex(indices);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
    uniforms: { uArcTime: { value: 0 }, uHalfWidth: { value: 0 }, uRadius: { value: 1 } },
    vertexShader: arcVertex,
    fragmentShader: arcFragment,
  });
  const arcs = new Mesh(geometry, material);
  arcs.renderOrder = 2;
  arcs.frustumCulled = false;
  return arcs;
}

export function createIntroScene(
  canvas: HTMLCanvasElement,
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
    uniforms: { ...atlas, uReveal: { value: 0 } },
    vertexShader: globeVertex,
    fragmentShader: globeFragment,
  });
  const globe = new Mesh(globeGeometry, globeMaterial);
  const globeGroup = new Group();
  globeGroup.add(globe);
  scene.add(globeGroup);

  const count = window.innerWidth <= 700 ? 14000 : 30000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const latitude = Math.asin(1 - 2 * (i + 0.5) / count);
    const longitude = goldenAngle * i;
    positions.set(surface(longitude, latitude, 1.005 + random(i * 11) * 0.017), i * 3);
  }

  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  pointGeometry.setAttribute("aSeed", new BufferAttribute(Float32Array.from({ length: count }, (_, i) => random(i * 7 + 19)), 1));
  const pointMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...atlas, uAssembly: { value: 0 }, uOpacity: { value: 1 }, uPixel: { value: 1 }, uTime: { value: 0 } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });
  const particles = new Points(pointGeometry, pointMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 1;
  const arcs = createArcs();
  globeGroup.add(particles, arcs);

  const xAxis = new Vector3(1, 0, 0);
  const yAxis = new Vector3(0, 1, 0);
  const viewport = new Vector2();
  const textures = new Set<Texture>();
  const loader = new TextureLoader();
  let width = 1;
  let height = 1;
  let compact = false;
  let paused = initiallyPaused;
  let disposed = false;
  let ready = false;
  let frame = 0;
  let last: number | undefined;
  let time = 0;

  function draw() {
    const progress = Math.min(1, time / assemblyDuration);
    const opacity = 1 - smoothstep(11.6, loopDuration, time);
    const longitude = 24 * radians + 2 * Math.PI * time / loopDuration;
    const aspect = width / height;
    const size = compact ? 0.86 * Math.min(1, aspect) : Math.min(0.76, 0.72 * aspect);
    globeGroup.rotation.set(0, 0, 0);
    globeGroup.rotateOnWorldAxis(yAxis, -longitude);
    globeGroup.rotateOnWorldAxis(xAxis, 22 * radians);
    globeGroup.scale.setScalar(size);
    globeGroup.position.set(compact ? 0 : 0.21 * aspect, compact ? 0.40 : 0.13, 0);
    globeMaterial.uniforms.uReveal.value = smoothstep(0.28, 1, progress) * opacity;
    pointMaterial.uniforms.uAssembly.value = progress;
    pointMaterial.uniforms.uOpacity.value = opacity;
    pointMaterial.uniforms.uTime.value = time;
    arcs.visible = time > 2.7 && time < 11.6;
    arcs.material.uniforms.uArcTime.value = time;
    arcs.material.uniforms.uRadius.value = size;
    renderer.render(scene, camera);
  }

  function paint(now: number) {
    frame = 0;
    const elapsed = last === undefined ? 0 : Math.min(100, now - last) / 1000;
    last = now;
    time = (time + elapsed) % loopDuration;
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
    last = undefined;
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
    arcs.material.uniforms.uHalfWidth.value = 3.7 / height;
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

  Promise.all([readTexture("day"), readTexture("night")]).then(([day, night]) => {
    if (disposed) return;
    atlas.uDay.value = day;
    atlas.uNight.value = night;
    ready = true;
    if (paused) time = assemblyDuration;
    draw();
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
    pause(value) {
      if (paused === value) return;
      paused = value;
      if (paused) stop();
      else schedule();
    },
    dispose() {
      disposed = true;
      stop();
      resize.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("webglcontextlost", lost);
      scene.clear();
      pointGeometry.dispose();
      pointMaterial.dispose();
      arcs.geometry.dispose();
      arcs.material.dispose();
      globeGeometry.dispose();
      globeMaterial.dispose();
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
    },
  };
}
