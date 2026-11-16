import { geoOrthographic } from "d3-geo";
import { sampleWeatherField, type WeatherSampleField } from "@/lib/weather-earth";

export type ComparisonWindGrid = Extract<WeatherSampleField, { kind: "vector" }>;
export type GlobeBearing = { lon: number; lat: number };
export const globeRadius = (size: number, zoom: number) => size * .46 * zoom;
export const globeProjection = (size: number, bearing: GlobeBearing, zoom: number) =>
  geoOrthographic().scale(globeRadius(size, zoom))
    .translate([size / 2, size / 2]).rotate([-bearing.lon, -bearing.lat]).clipAngle(90);

type Particle = { position: [number, number]; age: number };

const radians = Math.PI / 180;
const maxAge = 65;
const frameInterval = 32;
// Wind is advanced at an accelerated display rate within the selected snapshot.
const degreesPerMeterPerSecond = .07;
const strokes = ["rgba(221, 250, 242, .46)", "rgba(210, 255, 244, .67)", "rgba(240, 255, 248, .84)"];

export function animateComparisonWind(canvas: HTMLCanvasElement, field: ComparisonWindGrid, bearing: GlobeBearing, zoom: number) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const size = canvas.width;
  const center = size / 2;
  const radius = globeRadius(size, zoom);
  const projection = globeProjection(size, bearing, zoom);
  const sinLatitude = Math.sin(bearing.lat * radians);
  const cosLatitude = Math.cos(bearing.lat * radians);
  const isVisible = ([lon, lat]: [number, number]) =>
    sinLatitude * Math.sin(lat * radians)
    + cosLatitude * Math.cos(lat * radians) * Math.cos((lon - bearing.lon) * radians) > .04;

  const seed = (): [number, number] => {
    let x: number, y: number;
    do {
      x = (Math.random() * 2 - 1) * Math.min(radius, center - 1);
      y = (Math.random() * 2 - 1) * Math.min(radius, center - 1);
    } while (Math.hypot(x, y) > radius * .97);
    return projection.invert?.([center + x, center + y]) ?? [bearing.lon, bearing.lat];
  };
  const count = Math.min(1900, Math.max(640, Math.round(canvas.clientWidth * 3.6)));
  const particles: Particle[] = Array.from({ length: count }, () => ({
    position: seed(), age: Math.floor(Math.random() * maxAge),
  }));
  let request = 0;
  let last = 0;

  function draw(now: number) {
    request = requestAnimationFrame(draw);
    if (!context || document.hidden || now - last < frameInterval) return;
    last = now;

    context.globalCompositeOperation = "destination-in";
    context.fillStyle = "rgba(0, 0, 0, .84)";
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = "source-over";
    context.lineWidth = .9;
    context.lineCap = "round";
    const paths = strokes.map(() => new Path2D());

    for (const particle of particles) {
      const [lon, lat] = particle.position;
      particle.age++;
      const wind = sampleWeatherField(field, lon, lat);
      if (particle.age > maxAge || wind?.u === undefined || wind.v === undefined || Math.abs(lat) >= 88) {
        particle.position = seed();
        particle.age = 0;
        continue;
      }
      const next: [number, number] = [
        (lon + wind.u * degreesPerMeterPerSecond / Math.cos(lat * radians) + 540) % 360 - 180,
        lat + wind.v * degreesPerMeterPerSecond,
      ];
      if (Math.abs(next[1]) >= 88 || !isVisible(next)) {
        particle.age = maxAge;
        continue;
      }
      const from = projection(particle.position);
      const to = projection(next);
      particle.position = next;
      if (!from || !to || to.some(coordinate => coordinate < 0 || coordinate > size)) {
        particle.age = maxAge;
        continue;
      }
      const path = paths[wind.value < 5 ? 0 : wind.value < 12 ? 1 : 2];
      path.moveTo(...from);
      path.lineTo(...to);
    }

    for (const [index, path] of paths.entries()) {
      context.strokeStyle = strokes[index];
      context.stroke(path);
    }
  }

  request = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(request);
    context.clearRect(0, 0, size, size);
  };
}
