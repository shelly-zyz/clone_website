"use client";

import { geoGraticule, geoOrthographic, geoPath } from "d3-geo";
import type { MultiLineString, MultiPolygon } from "geojson";
import { useEffect, useRef } from "react";

export type IntroScene = "overview" | "weather" | "power" | "carbon";

type PreviewAsset = {
  land: MultiPolygon;
  borders: MultiLineString;
  points: [longitude: number, latitude: number, shade: number][];
};

const scenes = {
  overview: { longitude: 57, latitude: 24, colors: ["#5abfbc", "#82dce5", "#f3b16b"] },
  weather: { longitude: -151, latitude: 22, colors: ["#5d93cf", "#8edff2", "#c1f8ed"] },
  power: { longitude: 112, latitude: 34, colors: ["#6ba5b1", "#81e1dc", "#ffbc70"] },
  carbon: { longitude: -32, latitude: 15, colors: ["#648992", "#ed916d", "#ffc191"] },
} as const;

const toRadians = Math.PI / 180;
const graticule = geoGraticule().step([20, 20])();

export function IntroGlobe({ scene }: { scene: IntroScene }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeScene = useRef(scene);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    activeScene.current = scene;
    redraw.current();
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const projection = geoOrthographic().clipAngle(90).precision(0.65);
    const path = geoPath(projection, context);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = new AbortController();
    let asset: PreviewAsset | undefined;
    let dots: { x: number; y: number; z: number; shade: number }[] = [];
    let longitude: number = scenes.overview.longitude;
    let latitude: number = scenes.overview.latitude;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let elapsed = 0;

    function draw(time: number) {
      if (!asset || !context || !width || !height) return;
      const delta = last ? Math.min(time - last, 80) : 0;
      last = time;
      elapsed += delta;
      const view = activeScene.current;
      const target = scenes[view];
      const drift = motion.matches ? 0 : view === "overview" ? elapsed * 0.0025 : 7 * Math.sin(elapsed / 7000);
      const difference = ((target.longitude + drift - longitude + 540) % 360 + 360) % 360 - 180;
      const easing = motion.matches ? 1 : 1 - Math.exp(-delta / 390);
      longitude = (longitude + difference * easing + 540) % 360 - 180;
      latitude += (target.latitude - latitude) * easing;

      const x = width / 2;
      const y = height / 2;
      const radius = Math.min(width, height) * 0.462;
      context.clearRect(0, 0, width, height);
      projection.translate([x, y]).scale(radius).rotate([-longitude, -latitude]);

      const atmosphere = context.createRadialGradient(x, y, radius * 0.85, x, y, radius * 1.075);
      atmosphere.addColorStop(0, "rgba(53, 139, 159, 0)");
      atmosphere.addColorStop(0.66, "rgba(83, 193, 211, .25)");
      atmosphere.addColorStop(0.8, "rgba(41, 115, 143, .095)");
      atmosphere.addColorStop(1, "rgba(16, 60, 84, 0)");
      context.fillStyle = atmosphere;
      context.fillRect(0, 0, width, height);

      context.save();
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.clip();
      const ocean = context.createRadialGradient(x - radius * 0.4, y - radius * 0.57, 0, x, y, radius * 1.17);
      ocean.addColorStop(0, "#152d38");
      ocean.addColorStop(0.47, "#091a25");
      ocean.addColorStop(1, "#030910");
      context.fillStyle = ocean;
      context.fillRect(0, 0, width, height);

      context.beginPath();
      path(asset.land);
      context.fillStyle = "rgba(56, 112, 118, .27)";
      context.fill();
      context.strokeStyle = "rgba(152, 223, 218, .32)";
      context.lineWidth = 0.6;
      context.stroke();

      context.beginPath();
      path(graticule);
      context.strokeStyle = "rgba(132, 191, 213, .16)";
      context.lineWidth = 0.45;
      context.stroke();

      context.beginPath();
      path(asset.borders);
      context.strokeStyle = "rgba(145, 203, 200, .26)";
      context.lineWidth = 0.55;
      context.stroke();

      const lon = longitude * toRadians;
      const lat = latitude * toRadians;
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      for (const dot of dots) {
        const forward = dot.x * cosLon + dot.y * sinLon;
        const depth = forward * cosLat + dot.z * sinLat;
        if (depth <= 0) continue;
        const screenX = x + radius * (dot.y * cosLon - dot.x * sinLon);
        const screenY = y + radius * (forward * sinLat - dot.z * cosLat);
        const size = dot.shade === 9 ? 1.8 : dot.shade >= 6 ? 1.2 : 0.8;
        context.fillStyle = target.colors[dot.shade >= 8 ? 2 : dot.shade >= 5 ? 1 : 0];
        const alpha = Math.min(0.94, (0.27 + dot.shade * 0.069) * (0.47 + depth * 0.7));
        if (dot.shade === 9) {
          context.globalAlpha = alpha * 0.17;
          context.fillRect(screenX - 1.8, screenY - 1.8, 5.4, 5.4);
        }
        context.globalAlpha = alpha;
        context.fillRect(screenX, screenY, size, size);
      }

      context.globalAlpha = 1;
      const shadow = context.createLinearGradient(x, y - radius, x + radius * 0.34, y + radius);
      shadow.addColorStop(0.14, "rgba(1, 5, 11, 0)");
      shadow.addColorStop(0.66, "rgba(1, 5, 11, .24)");
      shadow.addColorStop(1, "rgba(1, 5, 11, .86)");
      context.fillStyle = shadow;
      context.fillRect(0, 0, width, height);
      context.restore();

      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      const edge = context.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
      edge.addColorStop(0, "rgba(163, 240, 245, .75)");
      edge.addColorStop(0.58, "rgba(80, 173, 198, .27)");
      edge.addColorStop(1, "rgba(65, 117, 148, .12)");
      context.strokeStyle = edge;
      context.lineWidth = 1;
      context.stroke();
    }

    function schedule() {
      if (!frame && asset && !document.hidden) frame = requestAnimationFrame(animate);
    }

    function animate(time: number) {
      frame = 0;
      if (!last || motion.matches || time - last >= 30) draw(time);
      if (!motion.matches) schedule();
    }

    function resize() {
      if (!canvas || !context) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now());
      schedule();
    }

    function restart() {
      last = 0;
      cancelAnimationFrame(frame);
      frame = 0;
      schedule();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    redraw.current = schedule;

    // Fixed, simplified Natural Earth geometry and decorative samples, independent of workspace APIs.
    void fetch("/intro/world-v1.json", { cache: "force-cache", signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("Intro globe asset unavailable");
        return response.json() as Promise<PreviewAsset>;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        asset = data;
        dots = data.points.map(([lng, lat, shade]) => {
          const lambda = lng * toRadians;
          const phi = lat * toRadians;
          return { x: Math.cos(phi) * Math.cos(lambda), y: Math.cos(phi) * Math.sin(lambda), z: Math.sin(phi), shade };
        });
        resize();
      })
      .catch(() => {
        // The CSS globe remains visible if the optional geographic asset cannot load.
      });

    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", restart);
      redraw.current = () => {};
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />;
}
