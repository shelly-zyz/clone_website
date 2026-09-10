"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef } from "react";
import maplibregl, { type LayerSpecification, type Map } from "maplibre-gl";
import {
  buildChinaOsmLayerDefinitions,
  buildVoltageFilter,
  CHINA_OSM_TILE_SOURCE,
  CHINA_OSM_TILESET_VERSION,
  type ChinaOsmFeatureLayer,
  type ChinaVoltageClass,
} from "@/lib/china-layer-styles";
import styles from "./china-dashboard.module.css";

const sourceId = "china-osm-power";
const healthTileUrl = `/api/data/vector-tiles/${CHINA_OSM_TILESET_VERSION}/3/7/3.pbf`;

export function OsmPowerTileOverlay({
  visible,
  featureLayers,
  voltages,
  detail,
  onStatus,
}: {
  visible: boolean;
  featureLayers: Record<ChinaOsmFeatureLayer, boolean>;
  voltages: ReadonlySet<ChinaVoltageClass>;
  detail: "overview" | "detail";
  onStatus: (status: "idle" | "loading" | "ready" | "error") => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const statusRef = useRef(onStatus);
  const initialConfigRef = useRef({ visible, featureLayers, voltages });

  useEffect(() => { statusRef.current = onStatus; }, [onStatus]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    statusRef.current("loading");
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [{ id: "transparent", type: "background", paint: { "background-color": "rgba(0,0,0,0)" } }] },
      center: [104.2, 36.1],
      zoom: 3.05,
      minZoom: 3,
      maxZoom: 5,
      attributionControl: false,
      interactive: false,
      canvasContextAttributes: { preserveDrawingBuffer: false, antialias: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      const initialConfig = initialConfigRef.current;
      map.addSource(sourceId, CHINA_OSM_TILE_SOURCE);
      for (const definition of buildChinaOsmLayerDefinitions()) {
        map.addLayer({
          id: definition.id,
          type: definition.type,
          source: sourceId,
          "source-layer": definition.sourceLayer,
          minzoom: definition.minzoom,
          paint: definition.paint,
          layout: { visibility: "visible" },
        } as LayerSpecification);
        map.setLayoutProperty(definition.id, "visibility", initialConfig.visible && initialConfig.featureLayers[definition.kind] ? "visible" : "none");
      }
      map.setFilter("china-osm-line-glow", buildVoltageFilter(Array.from(initialConfig.voltages)) as never);
      map.setFilter("china-osm-line-main", buildVoltageFilter(Array.from(initialConfig.voltages)) as never);
      window.requestAnimationFrame(() => map.resize());
      fetch(healthTileUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Tile health check returned ${response.status}`);
          statusRef.current("ready");
        })
        .catch(() => statusRef.current("error"));
    });

    map.on("sourcedata", (event) => {
      if (event.sourceId === sourceId && event.isSourceLoaded) statusRef.current("ready");
    });
    map.on("idle", () => {
      if (map.getSource(sourceId) && map.isSourceLoaded(sourceId)) statusRef.current("ready");
    });
    map.on("error", (event) => {
      const detail = event as typeof event & { sourceId?: string };
      if (detail.sourceId === sourceId || /vector-tiles|china-osm-power/i.test(event.error?.message ?? "")) statusRef.current("error");
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(sourceId)) return;
    for (const definition of buildChinaOsmLayerDefinitions()) {
      if (!map.getLayer(definition.id)) continue;
      const enabled = visible && featureLayers[definition.kind];
      map.setLayoutProperty(definition.id, "visibility", enabled ? "visible" : "none");
    }
    const filter = buildVoltageFilter(Array.from(voltages));
    map.setFilter("china-osm-line-glow", filter as never);
    map.setFilter("china-osm-line-main", filter as never);
  }, [featureLayers, visible, voltages]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    statusRef.current("loading");
    map.easeTo({ center: [104.2, 36.1], zoom: detail === "overview" ? 3.05 : 4.7, duration: 420 });
  }, [detail]);

  return <div ref={containerRef} className={`${styles.osmTileOverlay} ${visible ? styles.osmTileVisible : ""}`} aria-hidden="true" />;
}
