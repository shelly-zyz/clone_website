"use client";

import Image from "next/image";
import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap, type Marker } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { useEffect, useRef, useState } from "react";
import { applyRasterBasemap } from "@/lib/raster-basemap";
import { readWorkspaceCamera, replaceWorkspaceContext } from "@/lib/workspace-context";
import type { MapTheme } from "@/types/opengridworks";
import { economyMetrics, formatGrowth, type EconomyCountry, type EconomyMetric, type EconomyValue } from "./economy-data";
import styles from "./EconomyWorkspace.module.css";

const globeCenter: [number, number] = [79, 22];
const missingValue = -1000;
const bounds = "/data/natural-earth/ne_50m_admin_0_countries.geojson";
const featuredEconomies = new Set(["CHN", "USA", "DEU", "BRA", "ZAF"]);

function globeZoom(container: HTMLElement, latitude: number) {
  const diameter = Math.max(108, Math.min(container.clientWidth, container.clientHeight) * 0.88);
  // Globe scale grows toward the poles at a fixed MapLibre zoom.
  const latitudeScale = Math.max(0.2, Math.cos(latitude * Math.PI / 180));
  return Math.max(0, Math.log2(diameter * latitudeScale / 140));
}

function mapLayers(values: EconomyValue[], metric: EconomyMetric, outlook: boolean) {
  const { min, max } = economyMetrics[metric];
  const levels = new Map<string, number>();
  const points: FeatureCollection<Point, { mapId: string; level: number; amount: number }> = { type: "FeatureCollection", features: [] };

  for (const { country, value } of values) {
    if (value === null) continue;
    const level = outlook ? Math.min(1, Math.abs(value) / 9) : Math.min(1, Math.log(Math.max(value, min) / min) / Math.log(max / min));
    levels.set(country.mapId, outlook ? value : level);
    points.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: country.coordinates },
      properties: { mapId: country.mapId, level, amount: value },
    });
  }

  const [first, ...rest] = levels;
  const levelByCountry: ExpressionSpecification = first
    ? ["match", ["get", "ADM0_A3"], first[0], first[1], ...rest.flat(), missingValue]
    : ["literal", missingValue];
  const step: ExpressionSpecification = outlook
    ? ["interpolate", ["linear"], levelByCountry, -6, "#c97663", 0, "#80a4a0", 4, "#62ac80", 10, "#d4ee74"]
    : ["interpolate", ["linear"], levelByCountry, 0, "#513727", 0.5, "#a05a36", 1, "#e9a04f"];
  const fill: ExpressionSpecification = ["case", ["==", levelByCountry, missingValue], "#252b2d", step];
  return { fill, points };
}

export function EconomyGlobe({ basemap, onBasemapError, values, metric, outlook, selected, country, camera, onSelect, onReady }: {
  basemap: MapTheme;
  onBasemapError: () => void;
  values: EconomyValue[];
  metric: EconomyMetric;
  outlook: boolean;
  selected: EconomyCountry | undefined;
  country: string;
  camera?: string;
  onSelect: (code: string) => void;
  onReady?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap>(null);
  const initialCamera = useRef(camera);
  const appliedCamera = useRef<string | undefined>(undefined);
  const previousLayout = useRef(outlook);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const camera = readWorkspaceCamera(initialCamera.current);
    appliedCamera.current = undefined;
    let view: MapLibreMap;
    try {
      view = new maplibregl.Map({
        container: element,
        center: camera?.center ?? globeCenter,
        zoom: camera ? Math.min(6, camera.zoom) : globeZoom(element, globeCenter[1]),
        pitch: camera?.pitch ?? 0,
        bearing: camera?.bearing ?? 0,
        minZoom: 0,
        maxZoom: 6,
        dragRotate: false,
        touchPitch: false,
        attributionControl: { compact: true, customAttribution: "Natural Earth" },
        style: {
          version: 8,
          projection: { type: "globe" },
          sky: {
            "sky-color": "#101821",
            "horizon-color": "#1e293b",
            "fog-color": "#0f172a",
            "atmosphere-blend": 0.28,
          },
          sources: {
            countries: { type: "geojson", data: bounds },
            indicators: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#020711" } },
            { id: "countries", type: "fill", source: "countries", paint: {
              "fill-color": "#25262a",
              "fill-opacity": 0.42,
              "fill-color-transition": { duration: 210 },
            } },
            { id: "borders", type: "line", source: "countries", paint: { "line-color": "#8e735b", "line-opacity": 0.38, "line-width": 0.7 } },
            { id: "selected-country", type: "line", source: "countries", filter: ["==", ["get", "ADM0_A3"], ""],
              paint: { "line-color": "#ffdb96", "line-width": 2, "line-opacity": 0.96 } },
            { id: "indicator-glow", type: "circle", source: "indicators", paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "level"], 0, 4, 1, 18],
              "circle-color": "#efaa64", "circle-opacity": 0.52, "circle-blur": 0.9,
            } },
            { id: "indicator-points", type: "circle", source: "indicators", paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "level"], 0, 1.3, 1, 5.8],
              "circle-color": ["interpolate", ["linear"], ["get", "level"], 0, "#b98150", 1, "#ffe9b2"],
              "circle-opacity": 0.96, "circle-blur": 0.18,
            } },
          ],
        },
      });
    } catch {
      const request = requestAnimationFrame(() => setStatus("unavailable"));
      return () => cancelAnimationFrame(request);
    }

    map.current = view;
    const firstPaint = window.setTimeout(() => { if (view.isStyleLoaded()) setStatus("ready"); }, 2200);
    view.once("load", () => {
      clearTimeout(firstPaint);
      setStatus("ready");
    });
    const saveCamera = () => {
      const params = new URLSearchParams(window.location.search);
      if (window.location.pathname !== "/workspace" || params.get("topic") !== "economy") return;
      const center = view.getCenter().wrap();
      const values = [center.lng, center.lat, view.getZoom(), view.getPitch(), view.getBearing()];
      replaceWorkspaceContext({ camera: values.map(value => Number(value.toFixed(4))).join(",") });
    };
    view.on("moveend", saveCamera);
    const onContextLoss = () => setStatus("unavailable");
    const onContextRestore = () => {
      if (view.isStyleLoaded()) setStatus("ready");
      else view.once("style.load", () => setStatus("ready"));
    };
    view.getCanvas().addEventListener("webglcontextlost", onContextLoss);
    view.getCanvas().addEventListener("webglcontextrestored", onContextRestore);
    const observer = new ResizeObserver(() => view.resize());
    observer.observe(element);
    return () => {
      clearTimeout(firstPaint);
      observer.disconnect();
      view.getCanvas().removeEventListener("webglcontextlost", onContextLoss);
      view.getCanvas().removeEventListener("webglcontextrestored", onContextRestore);
      view.off("moveend", saveCamera);
      map.current = null;
      view.remove();
    };
  }, []);

  useEffect(() => {
    if (status !== "loading") onReady?.();
  }, [onReady, status]);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready") return;
    applyRasterBasemap(view, basemap, "countries");
    if (basemap.key !== "nasa") return;
    const source = view.getSource<maplibregl.RasterTileSource>("basemap-raster");
    source?.once("error", onBasemapError);
    return () => { source?.off("error", onBasemapError); };
  }, [basemap, onBasemapError, status]);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready") return;
    view.setPaintProperty("background", "background-color", outlook ? "#143d3c" : basemap.background);
    if (view.getLayer("basemap-raster")) {
      const rasterOpacity = outlook ? basemap.rasterOpacity * 0.39 : basemap.rasterOpacity;
      view.setPaintProperty("basemap-raster", "raster-opacity", rasterOpacity);
    }
    view.setSky({
      "sky-color": outlook ? "#1a3c38" : "#101821",
      "horizon-color": outlook ? "#537e6b" : "#1e293b",
      "fog-color": outlook ? "#234f49" : "#0f172a",
      "atmosphere-blend": outlook ? 0.35 : 0.28,
    });
    view.setPaintProperty("countries", "fill-opacity", outlook ? 0.73 : 0.42);
    view.setPaintProperty("borders", "line-color", outlook ? "#a7c9aa" : "#8e735b");
    view.setPaintProperty("selected-country", "line-color", outlook ? "#e3ff7e" : "#ffdb96");
    view.setPaintProperty("indicator-glow", "circle-color", outlook ? "#b5ef79" : "#efaa64");
    view.setPaintProperty("indicator-points", "circle-color", outlook
      ? ["case", ["<", ["get", "amount"], 0], "#ffc2a3", "#e5ff9c"]
      : ["interpolate", ["linear"], ["get", "level"], 0, "#b98150", 1, "#ffe9b2"]);
  }, [basemap, outlook, status]);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready" || previousLayout.current === outlook) return;
    previousLayout.current = outlook;
    view.resize();
    const zoom = globeZoom(view.getContainer(), view.getCenter().lat);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    view.easeTo({ zoom, duration: reducedMotion ? 0 : 240 });
  }, [outlook, status]);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready") return;
    const { fill, points } = mapLayers(values, metric, outlook);
    view.setPaintProperty("countries", "fill-color", fill);
    view.getSource<maplibregl.GeoJSONSource>("indicators")?.setData(points);
    const mapCodes = new Map(values.map(({ country: item }) => [item.mapId, item.code]));
    const pickCountry = (event: maplibregl.MapMouseEvent) => {
      const features = view.queryRenderedFeatures(event.point, { layers: ["indicator-points", "countries"] });
      for (const { properties } of features) {
        const mapId: unknown = properties.mapId ?? properties.ADM0_A3;
        const code = typeof mapId === "string" ? mapCodes.get(mapId) : undefined;
        if (code) { onSelect(code); return; }
      }
    };
    view.on("click", pickCountry);
    return () => { view.off("click", pickCountry); };
  }, [metric, onSelect, outlook, status, values]);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready") return;
    view.setFilter("selected-country", ["==", ["get", "ADM0_A3"], selected?.mapId ?? ""]);
    if (country && !selected) return;
    if (camera && camera !== appliedCamera.current) {
      const restored = readWorkspaceCamera(camera);
      appliedCamera.current = camera;
      if (restored) {
        view.jumpTo({ ...restored, zoom: Math.min(6, restored.zoom) });
        return;
      }
    }
    if (!camera) appliedCamera.current = undefined;
    const center = selected?.coordinates ?? globeCenter;
    const zoom = globeZoom(view.getContainer(), center[1]) + (selected ? 0.13 : 0);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    view.easeTo({ center, zoom, duration: reducedMotion ? 0 : 360 });
  }, [camera, country, selected, status]);

  useEffect(() => {
    const view = map.current;
    if (!view || status !== "ready" || !outlook) return;
    const labels = selected
      ? values.filter(({ country: item }) => item.code === selected.code)
      : values.filter(({ country: item }) => featuredEconomies.has(item.code));
    const markers: Marker[] = [];
    for (const { country: item, value } of labels) {
      if (value === null) continue;
      const element = document.createElement("div");
      element.className = styles.marker;
      element.setAttribute("aria-hidden", "true");
      const name = document.createElement("b");
      name.textContent = item.label;
      const amount = document.createElement("span");
      amount.textContent = formatGrowth(value);
      element.append(name, amount);
      markers.push(new maplibregl.Marker({ element, anchor: "bottom-left", offset: [4, -3], opacityWhenCovered: 0 })
        .setLngLat(item.coordinates).addTo(view));
    }
    return () => markers.forEach(marker => marker.remove());
  }, [outlook, selected, status, values]);

  return (
    <section className={styles.viewport} data-outlook={outlook} aria-label="交互式经济地球">
      <div className={styles.map} ref={container} data-ready={status === "ready"} />
      {status !== "ready" && (
        <div className={styles.mapPlaceholder}>
          <Image src="/images/opengridworks/globes/economy.webp" alt="" width={240} height={240} unoptimized loading="eager" />
          <p role="status">{status === "unavailable" ? "当前浏览器无法绘制地球。仍可从列表选择经济体。" : "正在绘制全球经济指标…"}</p>
        </div>
      )}
    </section>
  );
}
