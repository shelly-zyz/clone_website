"use client";

import { GlobeLoading } from "./GlobeLoading";
import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap, type Marker } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { useEffect, useRef, useState } from "react";
import {
  globeBoundaryLayers, globeContinentLabels, globeCountryLabels, globeGeographySources,
  globeGlyphs, globeProvinceLabels, globeSky,
} from "@/lib/globe-geography";
import { observeMapViewport, overviewZoom } from "@/lib/globe-viewport";
import { applyRasterBasemap } from "@/lib/raster-basemap";
import { readWorkspaceCamera, replaceWorkspaceContext } from "@/lib/workspace-context";
import type { MapTheme } from "@/types/opengridworks";
import { economyMetrics, formatGrowth, type EconomyCountry, type EconomyMetric, type EconomyValue } from "./economy-data";
import { GlobeMapAttribution } from "./GlobeMapAttribution";
import styles from "./EconomyWorkspace.module.css";

const globeCenter: [number, number] = [79, 22];
const missingValue = -1000;
const maxZoom = 8;
const featuredEconomies = new Set(["CHN", "USA", "DEU", "BRA", "ZAF"]);

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
    ? ["interpolate", ["linear"], levelByCountry, -6, "#f56d52", 0, "#598f89", 4, "#37ce77", 10, "#d4f54b"]
    : ["interpolate", ["linear"], levelByCountry, 0, "#653019", 0.5, "#d46a25", 1, "#ffad32"];
  const fill: ExpressionSpecification = ["case", ["==", levelByCountry, missingValue], "#252b2d", step];
  return { fill, points };
}

export function EconomyGlobe({ active, basemap, onBasemapError, values, metric, outlook, selected, country, camera, cameraRevision = 0, onSelect }: {
  active: boolean;
  basemap: MapTheme;
  onBasemapError: () => void;
  values: EconomyValue[];
  metric: EconomyMetric;
  outlook: boolean;
  selected: EconomyCountry | undefined;
  country: string;
  camera?: string;
  cameraRevision?: number;
  onSelect: (code: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap>(null);
  const initialCamera = useRef(camera);
  const appliedCamera = useRef<string | undefined>(undefined);
  const appliedCameraRevision = useRef(0);
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
        zoom: camera ? Math.min(maxZoom, camera.zoom) : overviewZoom(element, "globe", globeCenter[1]),
        pitch: camera?.pitch ?? 0,
        bearing: camera?.bearing ?? 0,
        minZoom: -2,
        trackResize: false,
        maxZoom,
        dragRotate: false,
        touchPitch: false,
        attributionControl: false,
        style: {
          version: 8,
          glyphs: globeGlyphs,
          projection: { type: "globe" },
          sky: globeSky,
          sources: {
            ...globeGeographySources,
            indicators: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#020711" } },
            { id: "countries", type: "fill", source: "ne-countries", paint: {
              "fill-color": "#25262a",
              "fill-opacity": 0.42,
              "fill-color-transition": { duration: 210 },
            } },
            ...globeBoundaryLayers,
            { id: "selected-country", type: "line", source: "ne-countries", filter: ["==", ["get", "ADM0_A3"], ""],
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
            globeCountryLabels,
            globeProvinceLabels,
            globeContinentLabels,
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
    const stopObservingViewport = observeMapViewport(view);
    return () => {
      clearTimeout(firstPaint);
      stopObservingViewport();
      view.getCanvas().removeEventListener("webglcontextlost", onContextLoss);
      view.getCanvas().removeEventListener("webglcontextrestored", onContextRestore);
      view.off("moveend", saveCamera);
      map.current = null;
      view.remove();
    };
  }, []);

  useEffect(() => {
    if (!active) map.current?.stop();
  }, [active]);

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
    view.setPaintProperty("countries", "fill-opacity", outlook ? 0.58 : 0.56);
    view.setPaintProperty("selected-country", "line-color", outlook ? "#e3ff7e" : "#ffdb96");
    view.setPaintProperty("indicator-glow", "circle-color", outlook ? "#b5ef79" : "#efaa64");
    view.setPaintProperty("indicator-points", "circle-color", outlook
      ? ["case", ["<", ["get", "amount"], 0], "#ffc2a3", "#e5ff9c"]
      : ["interpolate", ["linear"], ["get", "level"], 0, "#b98150", 1, "#ffe9b2"]);
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
    if (!view || !active || status !== "ready") return;
    view.setFilter("selected-country", ["==", ["get", "ADM0_A3"], selected?.mapId ?? ""]);
    if (country && !selected) return;
    if (cameraRevision !== appliedCameraRevision.current) {
      appliedCamera.current = undefined;
      appliedCameraRevision.current = cameraRevision;
    }
    if (camera && camera !== appliedCamera.current) {
      const restored = readWorkspaceCamera(camera);
      appliedCamera.current = camera;
      if (restored) {
        view.jumpTo({ ...restored, zoom: Math.min(maxZoom, restored.zoom) });
        return;
      }
    }
    if (!camera) appliedCamera.current = undefined;
    const center = selected?.coordinates ?? globeCenter;
    const zoom = overviewZoom(view.getContainer(), "globe", center[1]) + (selected ? 0.13 : 0);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    view.easeTo({ center, zoom, duration: reducedMotion ? 0 : 360 });
  }, [active, camera, cameraRevision, country, selected, status]);

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
      {active && status === "ready" && <GlobeMapAttribution map={map} />}
      {status === "loading" && <GlobeLoading label="正在加载经济地球" />}
      {status === "unavailable" && <p className={styles.mapError} role="status">当前浏览器无法绘制地球。仍可从列表选择经济体。</p>}
    </section>
  );
}
