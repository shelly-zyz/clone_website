import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Group, Mesh, OrthographicCamera, Points,
  Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
  type Texture,
} from "three";
export type IntroScene = {
  pause: (paused: boolean) => void;
  dispose: () => void;
};

const radians = Math.PI / 180;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
// Particles have all landed by this point; a paused scene shows this frame.
const settledTime = 5.6;
const scatterStart = 13.7;
const loopDuration = 16.2;
const trailLags = [0.025, 0.05, 0.075, 0.1];

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

// Each particle starts somewhere on screen and flies along a gentle curve to its land or ocean point.
const pointVertex = `
  attribute vec3 aStart;
  attribute vec4 aMotion;
  attribute float aLand;
  uniform float uTime;
  uniform float uLag;
  uniform float uAspect;
  uniform float uPixel;
  uniform float uScatter;
  varying vec3 vColor;
  varying float vAlpha;

  float easeInOut(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
  }

  void main() {
    float delay = aMotion.x;
    float flight = aMotion.y;
    float seed = aMotion.z;
    float city = aMotion.w;
    float time = uTime - uLag;
    float gather = easeInOut(clamp((time - delay) / flight, 0.0, 1.0));
    float release = clamp((time - uScatter - seed * 0.9) / 1.35, 0.0, 1.0);
    float progress = gather * (1.0 - release * release);

    vec3 target = (modelViewMatrix * vec4(position, 1.0)).xyz;
    vec2 drift = vec2(sin(uTime * 0.31 + seed * 40.0), cos(uTime * 0.27 + seed * 53.0)) * 0.03;
    vec3 start = vec3(aStart.xy * vec2(uAspect, 1.0) + drift, modelViewMatrix[3].z);
    vec2 chord = target.xy - start.xy;
    vec3 control = vec3(mix(start.xy, target.xy, 0.5) + vec2(-chord.y, chord.x) * (seed - 0.5) * 0.5, start.z);
    vec3 view = mix(mix(start, control, progress), mix(control, target, progress), progress);
    gl_Position = projectionMatrix * vec4(view, 1.0);

    float landed = time - delay - flight;
    float flash = step(0.0, landed) * exp(-max(landed, 0.0) * 3.6) * (1.0 - release);
    float settle = smoothstep(0.72, 1.0, progress);
    float front = smoothstep(-0.12, 0.30, normalize(mat3(modelViewMatrix) * position).z);
    float depth = aStart.z;

    float resting = 0.16 + aLand * 0.62 + city * 0.55;
    float glow = mix(0.78 * mix(1.0, 0.42, depth / 3.0), resting, settle) + flash * (0.9 + city);
    float pulse = 0.88 + 0.12 * sin(uTime * 1.4 + seed * 31.0);
    vAlpha = glow * pulse * mix(1.0, front, settle);
    vAlpha *= smoothstep(0.0, 0.7, uTime) * (1.0 - smoothstep(0.55, 1.0, release));
    if (uLag > 0.0) vAlpha *= smoothstep(0.02, 0.2, progress) * (1.0 - smoothstep(0.8, 0.98, progress)) * 0.6 * (1.0 - uLag * 7.5);

    vec3 blue = vec3(0.16, 0.30, 1.0);
    vec3 violet = vec3(0.58, 0.28, 1.0);
    vColor = mix(blue, violet, clamp(aLand * 0.45 + seed * 0.55, 0.0, 1.0));
    vColor = mix(vColor, vec3(0.86, 0.80, 1.0), clamp(city * 0.7 + flash * 0.6, 0.0, 1.0));

    float size = mix(1.3 + depth * 1.55, 1.15 + aLand * 0.5 + city * 1.7 + seed * 0.45, settle);
    gl_PointSize = size * (1.0 + flash * 1.4) * uPixel;
  }
`;

const pointFragment = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float halo = 1.0 - smoothstep(0.05, 0.5, radius);
    float core = 1.0 - smoothstep(0.0, 0.22, radius);
    gl_FragColor = vec4(vColor, vAlpha * (halo * 0.45 + core * 0.75));
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
    vec3 color = vec3(0.004, 0.004, 0.02);
    color += vec3(0.016, 0.010, 0.045) * land * (0.30 + 0.70 * light);
    color += vec3(0.07, 0.024, 0.18) * lights;
    color += vec3(0.05, 0.05, 0.16) * rim * (0.30 + 0.70 * light);
    gl_FragColor = vec4(color, uReveal * smoothstep(0.0, 0.22, facing.z));
    #include <colorspace_fragment>
  }
`;

// A soft violet atmosphere that peaks at the globe's edge.
const haloVertex = `
  varying vec2 vOffset;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vOffset = view.xy - modelViewMatrix[3].xy;
    gl_Position = projectionMatrix * view;
  }
`;

const haloFragment = `
  uniform float uReveal;
  uniform float uRadius;
  varying vec2 vOffset;
  void main() {
    float edge = length(vOffset) / uRadius;
    float glow = smoothstep(0.8, 1.0, edge) * (1.0 - smoothstep(1.0, 1.2, edge));
    vec3 color = mix(vec3(0.20, 0.30, 1.0), vec3(0.55, 0.26, 1.0), smoothstep(-0.6, 0.6, vOffset.y / uRadius));
    gl_FragColor = vec4(color, glow * glow * 0.55 * uReveal);
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
  uniform float uFade;
  varying float vSide;
  varying float vAlong;
  varying float vLaunch;
  varying float vTint;
  varying float vVisible;

  void main() {
    float age = uArcTime - vLaunch;
    float distanceFromHead = age / 1.3 - vAlong;
    float revealed = smoothstep(-0.02, 0.01, distanceFromHead);
    float trail = 1.0 - smoothstep(0.25, 1.4, distanceFromHead);
    float head = 1.0 - smoothstep(0.0, 0.07, abs(distanceFromHead));
    float width = abs(vSide);
    float core = 1.0 - smoothstep(0.0, 0.22, width);
    float glow = 1.0 - smoothstep(0.0, 1.0, width);
    float alpha = (core * 0.85 + glow * glow * 0.45) * vVisible * revealed * trail * smoothstep(0.0, 0.12, age);
    // Faint flowing dashes along the settled part of the arc.
    float flow = 0.75 + 0.25 * sin((vAlong * 26.0 - uArcTime * 5.0));
    vec3 base = mix(vec3(0.50, 0.16, 1.0), vec3(0.10, 0.42, 1.0), vTint);
    vec3 color = mix(base * 1.25, vec3(0.92, 0.88, 1.0), head * 0.8);
    gl_FragColor = vec4(color, alpha * flow * (0.75 + head * 1.4) * uFade);
    #include <colorspace_fragment>
  }
`;

// Rings that open where an arc's head lands.
const pulseVertex = `
  attribute float aLaunch;
  uniform float uArcTime;
  uniform float uPixel;
  uniform float uRadius;
  varying float vAge;
  varying float vVisible;
  void main() {
    vec3 view = mat3(modelViewMatrix) * position;
    gl_Position = projectionMatrix * vec4(view + modelViewMatrix[3].xyz, 1.0);
    vAge = (uArcTime - aLaunch) / 1.1;
    vVisible = smoothstep(0.0, 0.25, view.z / uRadius);
    gl_PointSize = (6.0 + clamp(vAge, 0.0, 1.0) * 34.0) * uPixel;
  }
`;

const pulseFragment = `
  uniform float uFade;
  varying float vAge;
  varying float vVisible;
  void main() {
    if (vAge < 0.0 || vAge > 1.0) discard;
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float ring = 1.0 - smoothstep(0.0, 0.12, abs(radius - 0.85));
    float center = 1.0 - smoothstep(0.0, 0.18, radius);
    float alpha = (ring + center * 1.4) * (1.0 - vAge) * vVisible * uFade;
    gl_FragColor = vec4(mix(vec3(0.55, 0.42, 1.0), vec3(0.95, 0.92, 1.0), center), alpha);
    #include <colorspace_fragment>
  }
`;

function createArcs() {
  // Illustrative city-to-city paths for the opening animation.
  const hubs = {
    beijing: [116, 40],
    shanghai: [121, 31],
    seoul: [127, 37.5],
    delhi: [77, 29],
    mumbai: [73, 19],
    tokyo: [140, 36],
    sydney: [151, -34],
    perth: [116, -32],
    jakarta: [107, -6],
    dubai: [55, 25],
    singapore: [104, 1],
    nairobi: [37, -1],
    johannesburg: [28, -26],
    lagos: [3.4, 6.5],
    cairo: [31, 30],
    moscow: [37.6, 55.7],
    london: [-0.1, 51],
    frankfurt: [8.7, 50],
    anchorage: [-150, 61],
    vancouver: [-123, 49],
    honolulu: [-158, 21],
    mexicoCity: [-99, 19],
    losAngeles: [-118, 34],
    chicago: [-88, 42],
    newYork: [-74, 41],
    lima: [-77, -12],
    saoPaulo: [-47, -24],
    buenosAires: [-58, -35],
  } as const;
  type Hub = keyof typeof hubs;
  const routes: [Hub, Hub, launch: number, lift: number][] = [
    ["london", "lagos", 2.2, 0.2],
    ["frankfurt", "moscow", 2.45, 0.14],
    ["frankfurt", "cairo", 2.7, 0.18],
    ["cairo", "johannesburg", 3.0, 0.24],
    ["moscow", "beijing", 3.2, 0.28],
    ["dubai", "delhi", 3.35, 0.12],
    ["dubai", "nairobi", 3.55, 0.16],
    ["beijing", "singapore", 3.75, 0.19],
    ["beijing", "delhi", 3.9, 0.15],
    ["beijing", "tokyo", 4.05, 0.11],
    ["shanghai", "seoul", 4.2, 0.08],
    ["mumbai", "singapore", 4.35, 0.14],
    ["beijing", "dubai", 4.5, 0.24],
    ["singapore", "jakarta", 4.7, 0.08],
    ["shanghai", "sydney", 4.9, 0.29],
    ["beijing", "london", 5.1, 0.3],
    ["jakarta", "perth", 5.3, 0.13],
    ["delhi", "nairobi", 5.5, 0.22],
    ["perth", "sydney", 5.75, 0.12],
    ["tokyo", "anchorage", 6.1, 0.27],
    ["shanghai", "dubai", 6.3, 0.22],
    ["tokyo", "honolulu", 6.55, 0.29],
    ["seoul", "vancouver", 7.0, 0.31],
    ["honolulu", "sydney", 7.3, 0.23],
    ["honolulu", "mexicoCity", 7.7, 0.19],
    ["anchorage", "vancouver", 8.0, 0.14],
    ["losAngeles", "vancouver", 8.4, 0.13],
    ["losAngeles", "lima", 8.7, 0.22],
    ["losAngeles", "newYork", 9.0, 0.22],
    ["chicago", "mexicoCity", 9.3, 0.16],
    ["lima", "buenosAires", 9.6, 0.16],
    ["newYork", "saoPaulo", 9.9, 0.26],
    ["chicago", "newYork", 10.15, 0.08],
    ["saoPaulo", "lagos", 10.5, 0.27],
    ["newYork", "london", 10.8, 0.3],
    ["buenosAires", "johannesburg", 11.2, 0.3],
    ["newYork", "frankfurt", 11.5, 0.3],
    ["mexicoCity", "saoPaulo", 11.8, 0.22],
  ];
  const positions: number[] = [];
  const tangents: number[] = [];
  const sides: number[] = [];
  const spans: number[] = [];
  const launches: number[] = [];
  const tints: number[] = [];
  const indices: number[] = [];
  const pulsePositions: number[] = [];
  const pulseLaunches: number[] = [];
  const steps = 56;
  const hubPoint = (hub: Hub) => new Vector3(...surface(hubs[hub][0] * radians, hubs[hub][1] * radians, 1));

  routes.forEach(([from, to, launch, lift], route) => {
    const start = hubPoint(from);
    const end = hubPoint(to);
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
    pulsePositions.push(...start.clone().multiplyScalar(1.012).toArray(), ...end.clone().multiplyScalar(1.012).toArray());
    pulseLaunches.push(launch - 0.15, launch + 1.25);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("aTangent", new BufferAttribute(new Float32Array(tangents), 3));
  geometry.setAttribute("aSide", new BufferAttribute(new Float32Array(sides), 1));
  geometry.setAttribute("aAlong", new BufferAttribute(new Float32Array(spans), 1));
  geometry.setAttribute("aLaunch", new BufferAttribute(new Float32Array(launches), 1));
  geometry.setAttribute("aTint", new BufferAttribute(new Float32Array(tints), 1));
  geometry.setIndex(indices);
  const timing = { uArcTime: { value: 0 }, uFade: { value: 1 }, uRadius: { value: 1 } };
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    forceSinglePass: true,
    uniforms: { ...timing, uHalfWidth: { value: 0 } },
    vertexShader: arcVertex,
    fragmentShader: arcFragment,
  });
  const arcs = new Mesh(geometry, material);
  arcs.renderOrder = 3;
  arcs.frustumCulled = false;

  const pulseGeometry = new BufferGeometry();
  pulseGeometry.setAttribute("position", new BufferAttribute(new Float32Array(pulsePositions), 3));
  pulseGeometry.setAttribute("aLaunch", new BufferAttribute(new Float32Array(pulseLaunches), 1));
  const pulseMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...timing, uPixel: { value: 1 } },
    vertexShader: pulseVertex,
    fragmentShader: pulseFragment,
  });
  const pulses = new Points(pulseGeometry, pulseMaterial);
  pulses.renderOrder = 4;
  pulses.frustumCulled = false;
  return { arcs, pulses, timing };
}

function readPixels(texture: Texture, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  context.drawImage(texture.image as CanvasImageSource, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

// Places particles on land sampled from the day atlas, with a sparse ocean shell to outline the sphere.
function createParticleGeometry(day: Texture, night: Texture, landCount: number, oceanCount: number) {
  const width = 768;
  const height = 384;
  const dayPixels = readPixels(day, width, height);
  const nightPixels = readPixels(night, width, height);
  const linear = (value: number) => (value / 255) ** 2.2;
  const land: number[][] = [];
  const ocean: number[][] = [];
  const candidates = Math.round(landCount * 5.4);
  for (let i = 0; i < candidates; i++) {
    const latitude = Math.asin(1 - 2 * (i + 0.5) / candidates);
    const longitude = ((goldenAngle * i) % (2 * Math.PI)) - Math.PI;
    const x = Math.min(width - 1, Math.floor((longitude / (2 * Math.PI) + 0.5) * width));
    const y = Math.min(height - 1, Math.floor((0.5 - latitude / Math.PI) * height));
    const at = (y * width + x) * 4;
    const signal = Math.max(linear(dayPixels[at]), linear(dayPixels[at + 1])) - linear(dayPixels[at + 2]) * 0.44;
    const city = smoothstep(0.012, 0.3, linear(nightPixels[at]));
    if (signal > 0.012 && latitude > -60 * radians) land.push([longitude, latitude, smoothstep(0.004, 0.05, signal), city]);
    else ocean.push([longitude, latitude, 0, 0]);
  }
  const pick = (source: number[][], amount: number) =>
    Array.from({ length: Math.min(amount, source.length) }, (_, i) => source[Math.floor(i * source.length / amount)]);
  const chosen = [...pick(land, landCount), ...pick(ocean, oceanCount)];
  const count = chosen.length;
  const positions = new Float32Array(count * 3);
  const starts = new Float32Array(count * 3);
  const motion = new Float32Array(count * 4);
  const landWeights = new Float32Array(count);

  chosen.forEach(([longitude, latitude, isLand, city], i) => {
    const seed = random(i * 7 + 19);
    positions.set(surface(longitude, latitude, 1.006 + random(i * 11) * 0.012), i * 3);
    // Land sweeps in eastward from West Africa; the ocean shell fills in loosely behind it.
    const sweep = (((longitude / radians + 20) % 360) + 360) % 360 / 360;
    const delay = isLand ? 0.35 + sweep * 2.5 + random(i * 13) * 0.85 : 0.8 + random(i * 13) * 3.0;
    const depth = 0.4 + random(i * 17) ** 2.4 * 2.6;
    starts.set([random(i * 23) * 2.4 - 1.2, random(i * 29) * 2.4 - 1.2, depth], i * 3);
    motion.set([delay, 1.45 + random(i * 31) * 0.9, seed, city], i * 4);
    landWeights[i] = isLand;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aStart", new BufferAttribute(starts, 3));
  geometry.setAttribute("aMotion", new BufferAttribute(motion, 4));
  geometry.setAttribute("aLand", new BufferAttribute(landWeights, 1));
  return geometry;
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
  const haloGeometry = new SphereGeometry(1.22, 64, 32);
  const haloMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
    uniforms: { uReveal: { value: 0 }, uRadius: { value: 1 } },
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
  });
  const halo = new Mesh(haloGeometry, haloMaterial);
  halo.renderOrder = -1;
  const globeGroup = new Group();
  globeGroup.add(halo, globe);
  scene.add(globeGroup);

  const particleUniforms = {
    uTime: { value: 0 }, uAspect: { value: 1 }, uPixel: { value: 1 }, uScatter: { value: scatterStart },
  };
  const pointMaterials = [0, ...trailLags].map(lag => new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...particleUniforms, uLag: { value: lag } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  }));
  let pointGeometry: BufferGeometry | undefined;
  const trails: Points[] = [];
  const { arcs, pulses, timing } = createArcs();
  globeGroup.add(arcs, pulses);

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
    const reveal = smoothstep(1.4, 4.6, time) * (1 - smoothstep(scatterStart - 0.3, scatterStart + 1.1, time));
    const longitude = 24 * radians + 2 * Math.PI * time / loopDuration;
    const aspect = width / height;
    const size = compact ? 0.86 * Math.min(1, aspect) : Math.min(0.76, 0.72 * aspect);
    globeGroup.rotation.set(0, 0, 0);
    globeGroup.rotateOnWorldAxis(yAxis, -longitude);
    globeGroup.rotateOnWorldAxis(xAxis, 22 * radians);
    globeGroup.scale.setScalar(size);
    globeGroup.position.set(compact ? 0 : 0.21 * aspect, compact ? 0.40 : 0.13, 0);
    globeMaterial.uniforms.uReveal.value = reveal;
    haloMaterial.uniforms.uReveal.value = reveal;
    haloMaterial.uniforms.uRadius.value = size;
    particleUniforms.uTime.value = time;
    const moving = time < settledTime + 0.3 || time > scatterStart;
    trails.forEach(trail => { trail.visible = moving; });
    arcs.visible = time > 2.1 && time < scatterStart + 0.6;
    pulses.visible = arcs.visible;
    timing.uArcTime.value = time;
    timing.uFade.value = 1 - smoothstep(scatterStart - 0.4, scatterStart + 0.5, time);
    timing.uRadius.value = size;
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
    particleUniforms.uPixel.value = viewport.x / width;
    particleUniforms.uAspect.value = aspect;
    pulses.material.uniforms.uPixel.value = viewport.x / width;
    arcs.material.uniforms.uHalfWidth.value = 6.5 / height;
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
    const small = window.innerWidth <= 700;
    pointGeometry = createParticleGeometry(day, night, small ? 15000 : 36000, small ? 4000 : 9000);
    pointMaterials.forEach((material, index) => {
      const points = new Points(pointGeometry, material);
      points.frustumCulled = false;
      points.renderOrder = index === 0 ? 2 : 1;
      if (index > 0) trails.push(points);
      globeGroup.add(points);
    });
    ready = true;
    if (paused) time = settledTime;
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
      pointGeometry?.dispose();
      pointMaterials.forEach(material => material.dispose());
      arcs.geometry.dispose();
      arcs.material.dispose();
      pulses.geometry.dispose();
      pulses.material.dispose();
      globeGeometry.dispose();
      globeMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
    },
  };
}
