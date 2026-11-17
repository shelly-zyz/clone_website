import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, LineSegments, Mesh, MeshPhongMaterial,
  ShaderMaterial, SRGBColorSpace, type Texture,
} from "three";
import type { WeatherReplay } from "@/lib/weather-replay/model";
import { gridCoordinate, type GeographicProjection, type ReplayArea } from "./replay-geography";
import { accumulationPalette, clamp, paletteColor, precipitationPalette, rainStrength, type Grid } from "./replay-textures";

function sampleGrid(values: Grid, cols: number, rows: number, x: number, y: number) {
  const col = Math.min(cols - 2, Math.floor(x));
  const row = Math.min(rows - 2, Math.floor(y));
  const u = x - col;
  const v = y - row;
  const i = row * cols + col;
  const a = values[i];
  const b = values[i + 1];
  const c = values[i + cols];
  const d = values[i + cols + 1];
  if (a == null || b == null || c == null || d == null) return null;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function createRainSurface(replay: WeatherReplay, projection: GeographicProjection, mask: Texture | null) {
  const subdivisions = 2;
  const cols = (replay.cols - 1) * subdivisions + 1;
  const rows = (replay.rows - 1) * subdivisions + 1;
  const count = cols * rows;
  const vertices = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 4);
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  const wet = new Uint8Array(count);
  const softened: (number | null)[] = new Array(replay.rows * replay.cols);
  const geo = new BufferGeometry();
  const position = new BufferAttribute(vertices, 3).setUsage(DynamicDrawUsage);
  const color = new BufferAttribute(colors, 4).setUsage(DynamicDrawUsage);
  const index = new BufferAttribute(indices, 1).setUsage(DynamicDrawUsage);
  geo.setAttribute("position", position);
  geo.setAttribute("uv", new BufferAttribute(uvs, 2));
  geo.setAttribute("color", color);
  geo.setIndex(index);
  // The texture has the same half-cell padding as the source raster.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const x = col / subdivisions;
      const y = row / subdivisions;
      const [worldX, worldZ] = projection.project(...gridCoordinate(replay, x, y));
      vertices[i * 3] = worldX;
      vertices[i * 3 + 2] = worldZ;
      uvs[i * 2] = (x + 0.5) / replay.cols;
      uvs[i * 2 + 1] = (y + 0.5) / replay.rows;
    }
  }
  const material = new MeshPhongMaterial({
    vertexColors: true, alphaMap: mask, alphaTest: 0.02, transparent: true,
    shininess: 15, specular: 0x315062, emissive: 0x142942, emissiveIntensity: 0.34,
  });
  const mesh = new Mesh(geo, material);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  const tint = new Color();
  let lastIndexCount = 0;

  function update(values: Grid, limit: number, accumulation: boolean) {
    // Smooth display height across one grid cell without filling a missing observation.
    for (let row = 0; row < replay.rows; row++) {
      for (let col = 0; col < replay.cols; col++) {
        const i = row * replay.cols + col;
        const value = values[i];
        if (value == null) {
          softened[i] = null;
          continue;
        }
        let sum = 0;
        let weights = 0;
        for (let y = Math.max(0, row - 1); y <= Math.min(replay.rows - 1, row + 1); y++) {
          for (let x = Math.max(0, col - 1); x <= Math.min(replay.cols - 1, col + 1); x++) {
            const sample = values[y * replay.cols + x];
            if (sample == null) continue;
            const weight = (x === col ? 2 : 1) * (y === row ? 2 : 1);
            sum += sample * weight;
            weights += weight;
          }
        }
        softened[i] = value * 0.16 + sum / weights * 0.84;
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const value = sampleGrid(values, replay.cols, replay.rows, col / subdivisions, row / subdivisions);
        const height = sampleGrid(softened, replay.cols, replay.rows, col / subdivisions, row / subdivisions) ?? 0;
        const strength = Math.sqrt(clamp((height * 0.76 + (value ?? 0) * 0.24) / limit));
        wet[i] = value == null ? 0 : value > 0 ? 2 : 1;
        vertices[i * 3 + 1] = 0.019 + (accumulation ? 0.25 : 0.092) * Math.pow(clamp(height / limit), 0.78);
        const [red, green, blue] = paletteColor(accumulation ? accumulationPalette : precipitationPalette, strength);
        tint.setRGB(red / 255, green / 255, blue / 255, SRGBColorSpace);
        tint.toArray(colors, i * 4);
        colors[i * 4 + 3] = clamp(Math.pow(clamp((value ?? 0) / limit), 0.58) * 2.6);
      }
    }
    let offset = 0;
    const add = (a: number, b: number, c: number) => {
      if (!wet[a] || !wet[b] || !wet[c] || Math.max(wet[a], wet[b], wet[c]) < 2) return;
      indices[offset++] = a;
      indices[offset++] = b;
      indices[offset++] = c;
    };
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const i = row * cols + col;
        add(i, i + 1, i + cols);
        add(i + 1, i + cols + 1, i + cols);
      }
    }
    if (offset < lastIndexCount) indices.fill(0, offset, lastIndexCount);
    lastIndexCount = offset;
    geo.setDrawRange(0, offset);
    position.needsUpdate = color.needsUpdate = index.needsUpdate = true;
    geo.computeVertexNormals();
    material.opacity = accumulation ? 0.78 : 0.55;
  }

  return { mesh, update, dispose() { geo.dispose(); material.dispose(); } };
}

const maxDrops = 14_000;

function random(cell: number, drop: number, salt: number) {
  let value = Math.imul(cell + 1, 0x9e3779b9) ^ Math.imul(drop + 1, 0x85ebca6b) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function createRainParticles() {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(maxDrops * 2 * 3);
  const timing = new Float32Array(maxDrops * 2 * 4);
  const appearance = new Float32Array(maxDrops * 2 * 2);
  const position = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const fall = new BufferAttribute(timing, 4).setUsage(DynamicDrawUsage);
  const glint = new BufferAttribute(appearance, 2).setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("fall", fall);
  geometry.setAttribute("glint", glint);
  const time = { value: 0 };
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { time },
    vertexShader: `
      uniform float time;
      attribute vec4 fall;
      attribute vec2 glint;
      varying float opacity;
      void main() {
        float cycle = fract(fall.x + time * fall.y);
        float height = (1.0 - cycle) * fall.z;
        float fade = smoothstep(0.0, 0.07, cycle) * (1.0 - smoothstep(0.89, 1.0, cycle));
        vec3 point = position;
        point.y = height + glint.x * fall.w;
        opacity = fade * glint.y * mix(1.0, 0.08, glint.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
      }`,
    fragmentShader: `
      varying float opacity;
      void main() {
        gl_FragColor = vec4(0.70, 0.84, 0.94, opacity);
      }`,
  });
  const mesh = new LineSegments(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;

  function update(replay: WeatherReplay, area: ReplayArea, projection: GeographicProjection, values: Grid) {
    let total = 0;
    for (const cell of area.cells) total += rainStrength(values[cell] ?? 0);
    const density = Math.min(21, maxDrops / Math.max(1, total));
    let count = 0;
    for (const cell of area.cells) {
      const strength = rainStrength(values[cell] ?? 0);
      const quota = strength * density;
      const drops = Math.floor(quota + random(cell, 0, 9721));
      const col = cell % replay.cols;
      const row = Math.floor(cell / replay.cols);
      for (let drop = 0; drop < drops && count < maxDrops; drop++) {
        const x = Math.min(replay.cols - 1, Math.max(0, col + random(cell, drop, 419) - 0.5));
        const y = Math.min(replay.rows - 1, Math.max(0, row + random(cell, drop, 751) - 0.5));
        const [lon, lat] = gridCoordinate(replay, x, y);
        if (!area.contains(lon, lat)) continue;
        const [px, pz] = projection.project(lon, lat);
        const phase = random(cell, drop, 8527);
        const speed = 0.48 + 0.42 * random(cell, drop, 3571);
        const ceiling = 0.24 + 0.17 * random(cell, drop, 509);
        const tail = 0.016 + 0.035 * random(cell, drop, 6751);
        const alpha = (0.14 + strength * 0.32) * (0.60 + random(cell, drop, 6469) * 0.40);
        for (let end = 0; end < 2; end++) {
          const i = count * 2 + end;
          positions[i * 3] = px;
          positions[i * 3 + 2] = pz;
          timing.set([phase, speed, ceiling, tail], i * 4);
          appearance.set([end, alpha], i * 2);
        }
        count++;
      }
    }
    geometry.setDrawRange(0, count * 2);
    position.needsUpdate = fall.needsUpdate = glint.needsUpdate = true;
  }

  return { mesh, update, time, dispose() { geometry.dispose(); material.dispose(); } };
}
