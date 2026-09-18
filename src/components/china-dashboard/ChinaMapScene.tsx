"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChinaLayerCatalog } from "@/lib/china-dashboard";
import { CHINA_VOLTAGE_CLASSES, type ChinaOsmFeatureLayer, type ChinaVoltageClass } from "@/lib/china-layer-styles";
import type { RegionTheme } from "@/lib/regions/contracts";
import { normalizeRegionName } from "@/lib/regions/geometry";
import { LayerControlStrip } from "./LayerControlStrip";
import { OsmPowerTileOverlay } from "./OsmPowerTileOverlay";
import styles from "./china-dashboard.module.css";

type Position = [number, number];
type PolygonGeometry = { type: "Polygon"; coordinates: Position[][] };
type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: Position[][][] };
type ProvinceFeature = { properties?: { name?: string }; geometry: PolygonGeometry | MultiPolygonGeometry };
type ProvinceCollection = { features?: ProvinceFeature[] };

const hotspots = [
  { name: "新疆", left: "18%", top: "44%" },
  { name: "内蒙古", left: "49%", top: "34%" },
  { name: "四川", left: "45%", top: "61%" },
  { name: "山东", left: "70%", top: "50%" },
  { name: "广东", left: "64%", top: "75%" },
];

function project([longitude, latitude]: Position): Position {
  return [20 + ((longitude - 72) / 64.5) * 740, 12 + ((54.5 - latitude) / 38.5) * 420];
}

function ringPath(ring: Position[]) {
  return `${ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ")}Z`;
}

function geometryPath(geometry: ProvinceFeature["geometry"]) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .filter((polygon) => polygon[0]?.some((point) => point[1] >= 18))
    .map((polygon) => polygon.map(ringPath).join(" "))
    .join(" ");
}

export function ChinaMapScene({
  layers,
  provinces,
  scope,
  scopeNote,
  theme,
  onScopeChange,
  onNotice,
  onLayerContextChange,
}: {
  layers: ChinaLayerCatalog | null;
  provinces: string[];
  scope: string;
  scopeNote: string;
  theme: RegionTheme;
  onScopeChange: (scope: string) => void;
  onNotice: (message: string) => void;
  onLayerContextChange: (layer: string) => void;
}) {
  const [features, setFeatures] = useState<ProvinceFeature[]>([]);
  const [activeLayers, setActiveLayers] = useState(() => new Set(["terrain", "provinces", "osm-power"]));
  const [featureLayers, setFeatureLayers] = useState<Record<ChinaOsmFeatureLayer, boolean>>({
    lines: true,
    substations: true,
    plants: false,
    generators: false,
  });
  const [voltages, setVoltages] = useState<ReadonlySet<ChinaVoltageClass>>(() => new Set(CHINA_VOLTAGE_CLASSES));
  const [detail, setDetail] = useState<"overview" | "detail">("overview");
  const [tileStatus, setTileStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let active = true;
    fetch("/data/china-dashboard/provinces.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("province geometry unavailable");
        return response.json() as Promise<ProvinceCollection>;
      })
      .then((collection) => { if (active) setFeatures(collection.features ?? []); })
      .catch(() => { if (active) onNotice("省级地形素材不可用，地图未使用伪造边界。") });
    return () => { active = false; };
  }, [onNotice]);

  const paths = useMemo(() => features.map((feature) => ({
    name: feature.properties?.name ?? "未命名省份",
    path: geometryPath(feature.geometry),
  })).filter((item) => item.path), [features]);

  const toggleLayer = (id: string, status: string, detailText: string) => {
    onLayerContextChange(id);
    const renderableLayers = new Set(["terrain", "provinces", "osm-power"]);
    if (status !== "available" || !renderableLayers.has(id)) {
      onNotice(detailText);
      return;
    }
    setActiveLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectProvince = (name: string) => onScopeChange(normalizeRegionName(name));
  const themeLabel = theme === "power" ? "电力资产" : theme === "weather" ? "气象摘要" : "碳排放摘要";

  return (
    <section className={styles.mapStage} aria-label="彩色土地地貌中国省级地图">
      <div className={styles.mapMeta}>
        <div><p className={styles.eyebrow}>SPATIAL ANALYSIS</p><h2>{scope} · {themeLabel}</h2><span>范围：<b>{scope}</b> · {scopeNote}</span></div>
        <p><strong>点击省界固定地区，再切换专题比较</strong>地图样本、预报与研究估算分别标识</p>
      </div>

      <div className={styles.mapPerspective}>
        <div className={styles.mapPlane}>
          <svg viewBox="0 0 780 450" role="img" aria-label={`${scope}彩色地貌和省级边界`}>
            <defs>
              <pattern id="chinaTerrain" width="780" height="450" patternUnits="userSpaceOnUse">
                <image href="/data/china-dashboard/terrain.jpg" width="780" height="450" preserveAspectRatio="xMidYMid slice" />
              </pattern>
              <clipPath id="chinaClip">{paths.map((item) => <path d={item.path} key={`clip-${item.name}`} fillRule="evenodd" />)}</clipPath>
              <filter id="mapGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <g className={styles.provinceDepth}>{paths.map((item) => <path d={item.path} key={`depth-${item.name}`} fillRule="evenodd" />)}</g>
            {activeLayers.has("terrain") ? (
              <g className={styles.provinceFaces}>{paths.map((item) => <path d={item.path} key={item.name} fillRule="evenodd" role="button" tabIndex={0} aria-label={`选择${item.name}`} onClick={() => selectProvince(item.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectProvince(item.name); }} className={scope === normalizeRegionName(item.name) ? styles.selectedProvince : ""} />)}</g>
            ) : <g className={styles.provinceFallback}>{paths.map((item) => <path d={item.path} key={item.name} fillRule="evenodd" role="button" tabIndex={0} aria-label={`选择${item.name}`} onClick={() => selectProvince(item.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectProvince(item.name); }} />)}</g>}
            {activeLayers.has("terrain") ? <image className={styles.reliefOverlay} href="/data/china-dashboard/relief.jpg" width="780" height="450" preserveAspectRatio="xMidYMid slice" clipPath="url(#chinaClip)" /> : null}
            {activeLayers.has("provinces") ? <g className={styles.provinceOutlines}>{paths.map((item) => <path d={item.path} key={`outline-${item.name}`} fillRule="evenodd" />)}</g> : null}
          </svg>
          <OsmPowerTileOverlay
            visible={activeLayers.has("osm-power")}
            featureLayers={featureLayers}
            voltages={voltages}
            detail={detail}
            onStatus={setTileStatus}
          />
          <div className={styles.mapHotspots}>
            {hotspots.map((point) => <button key={point.name} type="button" aria-label={point.name} className={`${styles.hotspot} ${scope === point.name ? styles.hotspotActive : ""}`} style={{ left: point.left, top: point.top }} onClick={() => onScopeChange(point.name)} />)}
          </div>
        </div>
      </div>

      <div className={styles.layerStrip}>
        {(layers?.layers ?? []).map((layer) => (
          <button
            key={layer.id}
            type="button"
            className={`${activeLayers.has(layer.id) ? styles.layerActive : ""} ${layer.status !== "available" || !["terrain", "provinces", "osm-power"].includes(layer.id) ? styles.layerLocked : ""}`}
            onClick={() => toggleLayer(layer.id, layer.status, layer.detail)}
            title={layer.detail}
          >{layer.label}{layer.status === "partial" ? " · 部分" : layer.status === "unavailable" ? " · 待接入" : ""}</button>
        ))}
      </div>
      <LayerControlStrip
        visible={activeLayers.has("osm-power")}
        featureLayers={featureLayers}
        voltages={voltages}
        detail={detail}
        status={tileStatus}
        onFeatureToggle={(layer) => setFeatureLayers((current) => ({ ...current, [layer]: !current[layer] }))}
        onVoltageToggle={(voltage) => setVoltages((current) => {
          const next = new Set(current);
          if (next.has(voltage)) next.delete(voltage); else next.add(voltage);
          return next;
        })}
        onDetailChange={setDetail}
      />
      <nav className={styles.provinceShortcuts} aria-label="省份快捷范围">
        {provinces.map((province) => <button key={province} type="button" className={scope === province ? styles.provinceActive : ""} onClick={() => onScopeChange(province)}>{province}</button>)}
      </nav>
    </section>
  );
}
