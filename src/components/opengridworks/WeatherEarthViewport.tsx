"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import {
  geoGraticule10,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from "d3-geo";
import type { FeatureCollection } from "geojson";
import {
  formatWeatherValue,
  readWeatherFieldAt,
  weatherColor,
  weatherMetricMeta,
  type WeatherField,
  type WeatherMetricKey,
} from "@/lib/weather-earth";
import type { Coordinates, MapCameraState, SelectedFeature } from "@/types/opengridworks";

type HoverTooltip = {
  x: number;
  y: number;
  title: string;
  subtitle: string;
  color: string;
} | null;

type WeatherParticle = {
  x: number;
  y: number;
  xt?: number;
  yt?: number;
  age: number;
};

type WeatherScreenVector = {
  dx: number;
  dy: number;
  magnitude: number;
  styleIntensity: number;
};

type WeatherScreenField = {
  width: number;
  height: number;
  stride: number;
  maxMagnitude: number;
  intensityMax: number;
  cells: (WeatherScreenVector | null)[][];
  seeds: { x: number; y: number }[];
  valueAt: (x: number, y: number) => WeatherScreenVector | null;
  isDefined: (x: number, y: number) => boolean;
  randomize: (particle: WeatherParticle) => WeatherParticle;
};

type WeatherEarthViewportProps = {
  weatherMetric: WeatherMetricKey;
  weatherField: WeatherField | null;
  weatherWindField: WeatherField | null;
  weatherParticlesEnabled: boolean;
  weatherHighDefinition: boolean;
  screenshotRequest: number;
  onSelectFeature: (feature: SelectedFeature) => void;
  onHoverTooltip: (tooltip: HoverTooltip) => void;
  onCameraChange: (camera: MapCameraState) => void;
  onScreenshotComplete: (message: string) => void;
};

type DragState = {
  pointerId: number;
  x: number;
  y: number;
  rotate: [number, number, number];
};

const initialRotate: [number, number, number] = [-105, -22, 0];
const minScaleMultiplier = 0.36;
const maxScaleMultiplier = 2.25;
const maxParticleAge = 108;
const weatherParticleBuckets = 6;

function formatWeatherTime(value: string | null | undefined) {
  if (!value) {
    return "等待数据";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const targetWidth = Math.max(1, Math.floor(width));
  const targetHeight = Math.max(1, Math.floor(height));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  return canvas.getContext("2d");
}

function sphereRadius(width: number, height: number, scale: number) {
  return Math.max(120, Math.min(width, height) * scale);
}

function isInsideSphere(x: number, y: number, width: number, height: number, radius: number) {
  return Math.hypot(x - width / 2, y - height / 2) <= radius;
}

function drawSphereClip(context: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  context.beginPath();
  context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
  context.clip();
}

function colorForMetric(metric: WeatherMetricKey, value: number, alpha: number) {
  const color = weatherColor(metric, value, alpha);
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return [255, 255, 255, Math.round(alpha * 255)] as const;
  }
  const channels = match[1].split(",").map((part) => Number(part.trim()));
  return [
    clamp(Math.round(channels[0] ?? 255), 0, 255),
    clamp(Math.round(channels[1] ?? 255), 0, 255),
    clamp(Math.round(channels[2] ?? 255), 0, 255),
    clamp(Math.round((channels[3] ?? alpha) * 255), 0, 255),
  ] as const;
}

function fieldIntensity(field: WeatherField, metric: WeatherMetricKey, value: number) {
  const meta = weatherMetricMeta(metric);
  const [boundMin, boundMax] = meta.bounds;
  const floor = metric === "wind" || metric === "cape" || metric === "precipitableWater"
    ? Math.max(0, Math.min(field.stats.min, boundMax))
    : Math.max(boundMin, Math.min(field.stats.min, boundMax));
  const statsCeiling = Math.max(
    floor + 0.001,
    field.stats.mean * (metric === "wind" ? 2.9 : 1.55),
    field.stats.max * (metric === "wind" ? 0.72 : 0.92),
  );
  const ceiling = metric === "wind"
    ? clamp(statsCeiling, Math.max(10, field.stats.mean * 1.35), Math.max(12, Math.min(boundMax, field.stats.max)))
    : clamp(statsCeiling, floor + 1, boundMax);

  return clamp((value - floor) / Math.max(ceiling - floor, 0.001), 0, 1);
}

function overlayAlphaForMetric(field: WeatherField, metric: WeatherMetricKey, value: number) {
  const intensity = fieldIntensity(field, metric, value);
  if (metric === "wind") {
    return 0.035 + Math.pow(intensity, 1.45) * 0.255;
  }
  if (metric === "cape" || metric === "mslp") {
    return 0.1 + Math.pow(intensity, 1.1) * 0.34;
  }
  return 0.09 + Math.pow(intensity, 1.18) * 0.3;
}

function particleStrokePalette(metric: WeatherMetricKey) {
  const meta = weatherMetricMeta(metric);
  const [min, max] = meta.bounds;
  const alphas = [0.18, 0.3, 0.44, 0.6, 0.78, 0.9];
  return alphas.map((alpha, index) => {
    const amount = index / Math.max(alphas.length - 1, 1);
    const value = min + (max - min) * amount;
    return weatherColor(metric, value, alpha);
  });
}

function drawBaseMap(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  projection: GeoProjection,
  scale: number,
  land: GeoPermissibleObjects | null,
  boundaries: GeoPermissibleObjects | null,
) {
  if (!canvas || width <= 0 || height <= 0) {
    return;
  }

  const context = prepareCanvas(canvas, width, height);
  if (!context) {
    return;
  }

  const radius = sphereRadius(width, height, scale);
  const path = geoPath(projection, context);
  context.clearRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.4, height * 0.35, radius * 0.08, width / 2, height / 2, radius);
  glow.addColorStop(0, "#101c26");
  glow.addColorStop(0.58, "#07101a");
  glow.addColorStop(0.9, "#02060d");
  glow.addColorStop(1, "#00030a");

  context.save();
  context.beginPath();
  path({ type: "Sphere" });
  context.fillStyle = glow;
  context.fill();
  context.shadowColor = "rgba(95, 210, 255, 0.3)";
  context.shadowBlur = 22;
  context.strokeStyle = "rgba(154, 221, 246, 0.34)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();

  context.save();
  drawSphereClip(context, width, height, radius);

  context.beginPath();
  path(geoGraticule10());
  context.strokeStyle = "rgba(125, 166, 184, 0.085)";
  context.lineWidth = 0.5;
  context.stroke();

  if (land) {
    context.beginPath();
    path(land);
    context.fillStyle = "rgba(35, 47, 52, 0.2)";
    context.fill();
  }

  if (boundaries) {
    context.beginPath();
    path(boundaries);
    context.strokeStyle = "rgba(188, 211, 220, 0.16)";
    context.lineWidth = 0.54;
    context.stroke();
  }

  context.restore();
}

function drawOverlay(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  projection: GeoProjection,
  scale: number,
  field: WeatherField | null,
  metric: WeatherMetricKey,
  highDefinition: boolean,
) {
  if (!canvas || width <= 0 || height <= 0) {
    return;
  }

  const context = prepareCanvas(canvas, width, height);
  if (!context) {
    return;
  }

  context.clearRect(0, 0, width, height);
  if (!field) {
    return;
  }

  const radius = sphereRadius(width, height, scale);
  const image = context.createImageData(width, height);
  const stride = highDefinition ? 1 : 2;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (!isInsideSphere(x + 0.5, y + 0.5, width, height, radius)) {
        continue;
      }
      const coord = projection.invert?.([x + 0.5, y + 0.5]);
      if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) {
        continue;
      }
      const sample = readWeatherFieldAt(field, coord[0], coord[1]);
      if (!sample) {
        continue;
      }
      const alpha = overlayAlphaForMetric(field, metric, sample.value);
      const [r, g, b, a] = colorForMetric(metric, sample.value, alpha);
      for (let yy = y; yy < Math.min(height, y + stride); yy += 1) {
        for (let xx = x; xx < Math.min(width, x + stride); xx += 1) {
          const index = (yy * width + xx) * 4;
          image.data[index] = r;
          image.data[index + 1] = g;
          image.data[index + 2] = b;
          image.data[index + 3] = a;
        }
      }
    }
  }

  context.putImageData(image, 0, 0);
}

function distortedWindVector(
  projection: GeoProjection,
  lng: number,
  lat: number,
  x: number,
  y: number,
  u: number,
  v: number,
  styleIntensity: number,
): WeatherScreenVector | null {
  const h = 0.0001;
  const pLambda = projection([lng + (lng < 0 ? h : -h), lat]);
  const pPhi = projection([lng, lat + (lat < 0 ? h : -h)]);
  if (!pLambda || !pPhi) {
    return null;
  }

  const hLambda = lng < 0 ? h : -h;
  const hPhi = lat < 0 ? h : -h;
  const cosLat = Math.max(0.18, Math.cos((lat * Math.PI) / 180));
  const dxdl = ((pLambda[0] - x) / hLambda) / cosLat;
  const dydl = ((pLambda[1] - y) / hLambda) / cosLat;
  const dxdp = (pPhi[0] - x) / hPhi;
  const dydp = (pPhi[1] - y) / hPhi;
  const velocityScale = 0.0125;
  const rawDx = (u * dxdl + v * dxdp) * velocityScale;
  const rawDy = (u * dydl + v * dydp) * velocityScale;
  const rawLength = Math.hypot(rawDx, rawDy);
  if (!Number.isFinite(rawLength) || rawLength < 0.02 || rawLength > 80) {
    return null;
  }

  const cappedLength = clamp(rawLength, 0.28, 7.2);
  const amount = cappedLength / rawLength;
  return {
    dx: rawDx * amount,
    dy: rawDy * amount,
    magnitude: Math.hypot(u, v),
    styleIntensity,
  };
}

function createScreenField(
  width: number,
  height: number,
  projection: GeoProjection,
  scale: number,
  field: WeatherField | null,
  styleField: WeatherField | null,
  styleMetric: WeatherMetricKey,
  highDefinition: boolean,
): WeatherScreenField | null {
  if (!field || field.kind !== "vector") {
    return null;
  }

  const radius = sphereRadius(width, height, scale);
  const stride = highDefinition ? 3 : 5;
  const columns = Math.ceil(width / stride);
  const rows = Math.ceil(height / stride);
  const cells: (WeatherScreenVector | null)[][] = Array.from({ length: columns }, () => Array(rows).fill(null));
  const seeds: { x: number; y: number }[] = [];
  let maxMagnitude = 0;
  let magnitudeSum = 0;
  let magnitudeCount = 0;

  for (let column = 0; column < columns; column += 1) {
    const x = Math.min(width - 1, column * stride + stride / 2);
    for (let row = 0; row < rows; row += 1) {
      const y = Math.min(height - 1, row * stride + stride / 2);
      if (!isInsideSphere(x, y, width, height, radius)) {
        continue;
      }
      const coord = projection.invert?.([x, y]);
      if (!coord || Math.abs(coord[1]) > 88) {
        continue;
      }
      const sample = readWeatherFieldAt(field, coord[0], coord[1]) as { value: number; u?: number; v?: number } | null;
      if (typeof sample?.u !== "number" || typeof sample.v !== "number") {
        continue;
      }
      const styleSample = styleField ? readWeatherFieldAt(styleField, coord[0], coord[1]) : sample;
      const styleIntensity = styleField && styleSample
        ? fieldIntensity(styleField, styleMetric, styleSample.value)
        : clamp(sample.value / 45, 0, 1);
      const vector = distortedWindVector(projection, coord[0], coord[1], x, y, sample.u, sample.v, styleIntensity);
      cells[column][row] = vector;
      if (vector) {
        maxMagnitude = Math.max(maxMagnitude, vector.magnitude);
        magnitudeSum += vector.magnitude;
        magnitudeCount += 1;
        seeds.push({ x, y });
      }
    }
  }

  const valueAt = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return null;
    }
    const column = clamp(Math.floor(x / stride), 0, columns - 1);
    const row = clamp(Math.floor(y / stride), 0, rows - 1);
    return cells[column]?.[row] ?? null;
  };

  const meanMagnitude = magnitudeSum / Math.max(magnitudeCount, 1);
  const intensityMax = Math.max(6, Math.min(45, Math.max(maxMagnitude * 0.72, meanMagnitude * 2.8)));

  return {
    width,
    height,
    stride,
    maxMagnitude,
    intensityMax,
    cells,
    seeds,
    valueAt,
    isDefined: (x, y) => valueAt(x, y) !== null,
    randomize: (particle) => {
      if (seeds.length === 0) {
        particle.x = width / 2;
        particle.y = height / 2;
        particle.age = maxParticleAge + 1;
        return particle;
      }

      const seed = seeds[Math.floor(Math.random() * seeds.length)];
      particle.x = clamp(seed.x + (Math.random() - 0.5) * stride * 2.6, 0, width - 1);
      particle.y = clamp(seed.y + (Math.random() - 0.5) * stride * 2.6, 0, height - 1);
      particle.xt = undefined;
      particle.yt = undefined;
      particle.age = Math.floor(Math.random() * maxParticleAge);
      return particle;
    },
  };
}

function buildParticles(field: WeatherScreenField, count: number) {
  return Array.from({ length: count }, () => field.randomize({
    x: 0,
    y: 0,
    age: Math.floor(Math.random() * maxParticleAge),
  }));
}

function animateParticles(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  scale: number,
  particles: WeatherParticle[],
  field: WeatherScreenField,
  metric: WeatherMetricKey,
) {
  const context = prepareCanvas(canvas, width, height);
  if (!context || field.width !== width || field.height !== height || field.seeds.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = "rgba(0, 0, 0, 0.965)";
  context.fillRect(0, 0, width, height);
  context.restore();

  const buckets: WeatherParticle[][] = Array.from({ length: weatherParticleBuckets }, () => []);
  particles.forEach((particle) => {
    if (particle.age > maxParticleAge || !field.isDefined(particle.x, particle.y)) {
      field.randomize(particle).age = 0;
    }

    const vector = field.valueAt(particle.x, particle.y);
    if (!vector) {
      particle.age = maxParticleAge + 1;
      return;
    }

    const nextX = particle.x + vector.dx;
    const nextY = particle.y + vector.dy;
    if (field.isDefined(nextX, nextY)) {
      particle.xt = nextX;
      particle.yt = nextY;
      const styleAmount = metric === "wind" ? vector.magnitude / field.intensityMax : vector.styleIntensity;
      const bucket = clamp(Math.floor(styleAmount * buckets.length), 0, buckets.length - 1);
      buckets[bucket].push(particle);
    } else {
      particle.x = nextX;
      particle.y = nextY;
    }
    particle.age += 1;
  });

  const strokes = particleStrokePalette(metric);

  context.save();
  drawSphereClip(context, width, height, sphereRadius(width, height, scale));
  context.globalCompositeOperation = "lighter";
  context.lineWidth = width < 700 ? 0.82 : 0.95;
  context.lineCap = "round";

  buckets.forEach((bucket, index) => {
    if (bucket.length === 0) {
      return;
    }
    context.beginPath();
    context.strokeStyle = strokes[index];
    bucket.forEach((particle) => {
      if (typeof particle.xt !== "number" || typeof particle.yt !== "number") {
        return;
      }
      context.moveTo(particle.x, particle.y);
      context.lineTo(particle.xt, particle.yt);
      particle.x = particle.xt;
      particle.y = particle.yt;
    });
    context.stroke();
  });
  context.restore();
}

function clearCanvas(canvas: HTMLCanvasElement | null, width: number, height: number) {
  if (!canvas) {
    return;
  }
  const context = prepareCanvas(canvas, width, height);
  context?.clearRect(0, 0, width, height);
}

export function WeatherEarthViewport({
  weatherMetric,
  weatherField,
  weatherWindField,
  weatherParticlesEnabled,
  weatherHighDefinition,
  screenshotRequest,
  onSelectFeature,
  onHoverTooltip,
  onCameraChange,
  onScreenshotComplete,
}: WeatherEarthViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const latestScreenshotRef = useRef(0);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [viewState, setViewState] = useState<{ rotate: [number, number, number]; scale: number }>({
    rotate: initialRotate,
    scale: 0.46,
  });
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [boundaries, setBoundaries] = useState<GeoPermissibleObjects | null>(null);

  const projection = useMemo(() => {
    const radius = sphereRadius(size.width, size.height, viewState.scale);
    return geoOrthographic()
      .translate([size.width / 2, size.height / 2])
      .scale(radius)
      .rotate(viewState.rotate)
      .clipAngle(90)
      .precision(0.2);
  }, [size.height, size.width, viewState.rotate, viewState.scale]);

  useEffect(() => {
    const rotate = viewState.rotate;
    onCameraChange({
      center: [-rotate[0], -rotate[1]] as Coordinates,
      zoom: viewState.scale * 4,
      pitch: 0,
      bearing: rotate[2],
    });
  }, [onCameraChange, viewState]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/data/geojson?path=/data/natural-earth/ne_50m_admin_0_countries.geojson").then((response) => response.json() as Promise<FeatureCollection>),
      fetch("/api/data/geojson?path=/data/natural-earth/ne_50m_admin_0_boundary_lines_land.geojson").then((response) => response.json() as Promise<FeatureCollection>),
    ]).then(([landData, boundaryData]) => {
      if (!cancelled) {
        setLand(landData as unknown as GeoPermissibleObjects);
        setBoundaries(boundaryData as unknown as GeoPermissibleObjects);
      }
    }).catch(() => {
      if (!cancelled) {
        setLand(null);
        setBoundaries(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const resize = () => {
      const rect = container.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    drawBaseMap(baseCanvasRef.current, size.width, size.height, projection, viewState.scale, land, boundaries);
    drawOverlay(overlayCanvasRef.current, size.width, size.height, projection, viewState.scale, weatherField, weatherMetric, weatherHighDefinition);
    clearCanvas(particlesCanvasRef.current, size.width, size.height);
  }, [boundaries, land, projection, size.height, size.width, viewState.scale, weatherField, weatherHighDefinition, weatherMetric]);

  useEffect(() => {
    const canvas = particlesCanvasRef.current;
    if (!canvas || !weatherParticlesEnabled || !weatherWindField) {
      clearCanvas(canvas, size.width, size.height);
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearCanvas(canvas, size.width, size.height);
      return;
    }

    const screenField = createScreenField(
      size.width,
      size.height,
      projection,
      viewState.scale,
      weatherWindField,
      weatherField,
      weatherMetric,
      weatherHighDefinition,
    );
    if (!screenField) {
      clearCanvas(canvas, size.width, size.height);
      return;
    }

    const minParticles = size.width < 700 ? 760 : 1800;
    const maxParticles = size.width < 700 ? 2600 : 7200;
    const particleBudget = (size.width * Math.min(size.width, size.height)) / (weatherHighDefinition ? 165 : 225);
    const particleCount = Math.round(clamp(particleBudget, minParticles, maxParticles));
    const particles = buildParticles(screenField, particleCount);
    let stopped = false;
    let frame = 0;

    const draw = () => {
      if (stopped) {
        return;
      }
      animateParticles(canvas, size.width, size.height, viewState.scale, particles, screenField, weatherMetric);
      frame = window.requestAnimationFrame(draw);
    };

    clearCanvas(canvas, size.width, size.height);
    draw();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      clearCanvas(canvas, size.width, size.height);
    };
  }, [projection, size.height, size.width, viewState.scale, weatherField, weatherHighDefinition, weatherMetric, weatherParticlesEnabled, weatherWindField]);

  useEffect(() => {
    if (screenshotRequest === 0 || screenshotRequest === latestScreenshotRef.current) {
      return;
    }
    latestScreenshotRef.current = screenshotRequest;

    const base = baseCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    const particles = particlesCanvasRef.current;
    if (!base || !overlay || !particles) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.fillStyle = "#02060d";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(base, 0, 0);
    context.drawImage(overlay, 0, 0);
    context.drawImage(particles, 0, 0);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "opengridworks-weather-earth.png";
    link.click();
    onScreenshotComplete("已从当前气象地球视图导出截图。");
  }, [onScreenshotComplete, screenshotRequest, size.height, size.width]);

  const sampleAtPoint = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !weatherField) {
      return null;
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (!isInsideSphere(x, y, size.width, size.height, sphereRadius(size.width, size.height, viewState.scale))) {
      return null;
    }
    const coord = projection.invert?.([x, y]);
    if (!coord) {
      return null;
    }
    const sample = readWeatherFieldAt(weatherField, coord[0], coord[1]);
    if (!sample) {
      return null;
    }
    return { x, y, coord, sample };
  }, [projection, size.height, size.width, viewState.scale, weatherField]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotate: [...viewState.rotate] as [number, number, number],
    };
    clearCanvas(particlesCanvasRef.current, size.width, size.height);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const sensitivity = 72 / sphereRadius(size.width, size.height, viewState.scale);
      setViewState((state) => ({
        ...state,
        rotate: [
          drag.rotate[0] + (event.clientX - drag.x) * sensitivity,
          clamp(drag.rotate[1] - (event.clientY - drag.y) * sensitivity, -88, 88),
          drag.rotate[2],
        ],
      }));
      return;
    }

    const hovered = sampleAtPoint(event.clientX, event.clientY);
    if (!hovered) {
      onHoverTooltip(null);
      return;
    }
    const meta = weatherMetricMeta(weatherMetric);
    onHoverTooltip({
      x: hovered.x,
      y: hovered.y,
      title: meta.label,
      subtitle: `${formatWeatherValue(weatherMetric, hovered.sample.value)} · ${formatWeatherTime(weatherField?.validTimeUtc)}`,
      color: weatherColor(weatherMetric, hovered.sample.value, 0.9),
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.035 : 0.035;
    clearCanvas(particlesCanvasRef.current, size.width, size.height);
    setViewState((state) => ({
      ...state,
      scale: clamp(state.scale + delta, minScaleMultiplier, maxScaleMultiplier),
    }));
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      return;
    }
    const picked = sampleAtPoint(event.clientX, event.clientY);
    if (!picked) {
      return;
    }
    const meta = weatherMetricMeta(weatherMetric);
    const coordinates = [picked.coord[0], picked.coord[1]] as Coordinates;
    onSelectFeature({
      id: `weather-${weatherMetric}-${picked.coord[0].toFixed(2)}-${picked.coord[1].toFixed(2)}`,
      kind: "weather",
      title: meta.label,
      subtitle: `${formatWeatherValue(weatherMetric, picked.sample.value)} · ${formatWeatherTime(weatherField?.validTimeUtc)}`,
      coordinates,
      color: weatherColor(weatherMetric, picked.sample.value, 0.9),
      rows: [
        { label: "数值", value: formatWeatherValue(weatherMetric, picked.sample.value) },
        { label: "经纬度", value: `${picked.coord[1].toFixed(2)}°, ${picked.coord[0].toFixed(2)}°` },
        { label: "有效时间", value: formatWeatherTime(weatherField?.validTimeUtc) },
      ],
      source: weatherField?.source ?? "GFS",
    });
  };

  const meta = weatherMetricMeta(weatherMetric);
  return (
    <section
      ref={containerRef}
      className="og-weather-earth"
      aria-label="气象地球视图"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onClick={handleClick}
    >
      <canvas ref={baseCanvasRef} className="og-weather-earth-layer" />
      <canvas ref={overlayCanvasRef} className="og-weather-earth-layer og-weather-earth-overlay" />
      <canvas ref={particlesCanvasRef} className="og-weather-earth-layer og-weather-earth-particles" />
      <div className="og-weather-earth-readout" aria-hidden="true">
        <span>覆盖 {meta.shortLabel}</span>
        <span>动画 风场</span>
        <strong>{formatWeatherTime(weatherField?.validTimeUtc)}</strong>
      </div>
    </section>
  );
}
