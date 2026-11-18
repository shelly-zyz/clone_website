"use client";

import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map, type MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { useEffect, useRef, useState } from "react";
import { observeMapViewport } from "@/lib/globe-viewport";
import { GlobeMapAttribution } from "./GlobeMapAttribution";
import styles from "./WeatherResourceScene.module.css";

type ProvinceMarker = { id: string; iso: string; coordinates: [number, number]; value: number };
const center: [number, number] = [105, 33];

export function ScenarioProvinceGlobe({ regions, selected, onSelect }: {
  regions: ProvinceMarker[]; selected: string; onSelect: (region: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const click = useRef(onSelect);
  const markers = useRef(regions);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => { click.current = onSelect; markers.current = regions; }, [onSelect, regions]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const zoom = Math.log2(Math.max(180, Math.min(element.offsetWidth, element.offsetHeight) * .9) / 145);
    let view: Map;
    try {
      view = new maplibregl.Map({
        container: element, center, zoom, maxZoom: 6, dragRotate: false,
        attributionControl: false, trackResize: false,
        style: {
          version: 8,
          projection: { type: "globe" },
          sources: {
            world: { type: "geojson", data: "/data/natural-earth/ne_50m_admin_0_countries.geojson", attribution: "Natural Earth" },
            provinces: { type: "geojson", data: "/data/natural-earth/ne_50m_admin_1_states_provinces.geojson" },
            points: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            { id: "ocean", type: "background", paint: { "background-color": "#123040" } },
            { id: "world", type: "fill", source: "world", paint: { "fill-color": "#254d59", "fill-outline-color": "#3f6872" } },
            { id: "regions", type: "fill", source: "provinces", filter: ["==", ["get", "adm0_a3"], "CHN"],
              paint: { "fill-color": "#437885", "fill-outline-color": "#75acb6", "fill-opacity": .86 } },
            { id: "selected", type: "line", source: "provinces", filter: ["==", ["get", "iso_3166_2"], ""],
              paint: { "line-color": "#e3ffff", "line-width": 2 } },
            { id: "points", type: "circle", source: "points", paint: {
              "circle-color": "#cbfcfa", "circle-opacity": .66,
              "circle-radius": ["interpolate", ["linear"], ["get", "value"], 0, 2, .75, 8],
            } },
          ],
        },
      });
    } catch {
      const frame = requestAnimationFrame(() => setUnavailable(true));
      return () => cancelAnimationFrame(frame);
    }
    map.current = view;
    view.once("load", () => setReady(true));
    const pick = (event: MapMouseEvent) => {
      const raw = view.queryRenderedFeatures(event.point, { layers: ["points", "regions"] })[0]?.properties;
      const iso = raw?.iso ?? raw?.iso_3166_2;
      const candidate = markers.current.find(item => item.iso === iso);
      if (candidate) click.current(candidate.id);
    };
    view.on("click", pick);
    const stopObserving = observeMapViewport(view);
    return () => {
      stopObserving();
      view.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view) return;
    const [first, ...rest] = regions;
    const color: string | ExpressionSpecification = first
      ? ["interpolate", ["linear"], ["match", ["get", "iso_3166_2"], first.iso, first.value,
        ...rest.flatMap(item => [item.iso, item.value]), -1], -1, "#253d46", 0, "#214c59", .24, "#338f9c", .5, "#98edd2", .7, "#dfffb3"]
      : "#253d46";
    view.setPaintProperty("regions", "fill-color", color);
    const points: FeatureCollection<Point> = {
      type: "FeatureCollection", features: regions.map(item => ({
        type: "Feature", geometry: { type: "Point", coordinates: item.coordinates },
        properties: { value: item.value, iso: item.iso },
      })),
    };
    view.getSource<GeoJSONSource>("points")?.setData(points);
    view.setFilter("selected", ["==", ["get", "iso_3166_2"], regions.find(item => item.id === selected)?.iso ?? ""]);
  }, [ready, regions, selected]);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view) return;
    const province = selected === "china" ? null : markers.current.find(item => item.id === selected);
    if (province) view.easeTo({ center: province.coordinates, duration: 310 });
  }, [ready, selected]);

  return (
    <div className={styles.globe} aria-label="省级风光资源地球" data-map-ready={ready}>
      <div ref={container} />
      {ready && <GlobeMapAttribution map={map} />}
      {unavailable ? <p role="status">地球不可用，可使用地区列表查看数据。</p> : null}
    </div>
  );
}
