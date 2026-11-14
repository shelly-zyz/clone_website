"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import maplibregl, {
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type Map,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import {
  Activity,
  Bookmark,
  Camera,
  CalendarDays,
  Check,
  Circle,
  Database,
  Globe2,
  Grid2X2,
  ImageIcon,
  Info,
  Layers,
  Map as MapIcon,
  Pause,
  Plane,
  Play,
  RadioTower,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Type,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GlobeNavigation } from "@/components/opengridworks/GlobeNavigation";
import { WeatherReplayPlayer } from "@/app/visualization/weather-replay/WeatherReplayPlayer";
import { replayViews, type WeatherScene } from "@/lib/weather-replay/views";
import { WeatherSceneSwitcher } from "./WeatherSceneSwitcher";
import { WeatherSidebarFilters } from "@/components/opengridworks/WeatherSidebarFilters";
import { WorkspaceFilterSelect, WorkspaceSidebar } from "@/components/opengridworks/WorkspaceSidebar";
import { XiaoyunAssistant } from "@/components/opengridworks/XiaoyunAssistant";
import { globeTopicOrder, globeTopics, type WorkspaceTopic } from "@/lib/globe-topics";
import {
  buildCarbonHeatCollection,
  carbonColor,
  carbonSectorLabels,
  formatCarbonTotal,
  formatCarbonValue,
  loadCarbonFrame,
  loadCarbonManifest,
  sampleCarbonFrame,
  type CarbonFrame,
  type CarbonManifest,
} from "@/lib/carbon-earth";
import {
  capacityFactorPercent,
  generationLabel,
  loadClimateVreManifest,
  loadClimateVreSummary,
  type ClimateVreManifest,
  type ClimateVreSummary,
  type ClimateVreSummaryRow,
  type VreTechnology,
} from "@/lib/climate-vre";
import {
  capacityToRadius,
  getMockMapDataset,
  getRegionForCoordinates,
  getRegionStats,
} from "@/lib/mock-map-data";
import {
  defaultWeatherMetric,
  formatWeatherValue,
  sampleWeatherField as sampleWeatherGrid,
  weatherColor,
  weatherMetricMeta,
  type WeatherField,
  type WeatherMetricKey,
} from "@/lib/weather-earth";
import { applyRasterBasemap } from "@/lib/raster-basemap";
import countryCenters from "@/lib/country-centers.generated.json";
import type {
  Coordinates,
  CustomLayerKey,
  DataCenterAsset,
  EnergyAsset,
  LabelPreset,
  LabelSettings,
  LayerKey,
  LegendHover,
  MapCameraState,
  MapTheme,
  MapThemeKey,
  RegionMeta,
  RegionTarget,
  RegionTargetId,
  RegionStats,
  SelectedFeature,
  SourceLayerKey,
  TechnologyKey,
  ToolbarPanel,
  VoltageClass,
} from "@/types/opengridworks";

type BooleanRecord<T extends string> = Record<T, boolean>;

type ProjectMode = Exclude<WorkspaceTopic, "economy">;
const EconomyWorkspace = dynamic(() => import("@/components/opengridworks/EconomyWorkspace").then((module) => module.EconomyWorkspace));
type MapProperties = Record<string, string | number | boolean>;
type PointCollection = FeatureCollection<Point, MapProperties>;
type LineCollection = FeatureCollection<LineString, MapProperties>;

type CountryLabelCenter = {
  code: string;
  name: string;
  continent: string;
  pop: number;
  center: [number, number];
};

type FocusRequest = {
  nonce: number;
  center: Coordinates;
  zoom: number;
  pitch?: number;
  bearing?: number;
};

type HoverTooltip = {
  x: number;
  y: number;
  title: string;
  subtitle: string;
  color: string;
} | null;

type LegendSectionKey =
  | "generation"
  | "technology"
  | "size"
  | "dataCenters"
  | "fiber"
  | "transmission"
  | "openInfraPower"
  | "substations"
  | "plannedUpgrades"
  | "gasPipelines";

type GenerationTechnology = "total" | VreTechnology;
type GenerationTimeMode = "annual" | "monthly";

type GenerationFrame = {
  technology: GenerationTechnology;
  mode: GenerationTimeMode;
  year: number;
  month: number;
};

type GenerationHeatmapEntry = {
  isoCode: string;
  regionId: string;
  label: string;
  valueGwh: number;
  capacityMw: number;
  capacityFactor: number;
  normalized: number;
};

type GenerationHeatmapData = {
  entries: GenerationHeatmapEntry[];
  maxGwh: number;
  nationalGwh: number;
  topRegion: GenerationHeatmapEntry | null;
  lowestNonZeroRegion: GenerationHeatmapEntry | null;
};

type DatabaseMapAssets = {
  energyAssets: EnergyAsset[];
  dataCenters: DataCenterAsset[];
};

const mapDataset = getMockMapDataset();
const {
  dataCenters,
  energyAssets,
  gasPipelines,
  gridLines,
  landingPoints,
  layerGroups,
  mapThemes,
  plannedUpgrades,
  regionTargets,
  regions,
  sizeBreakpoints,
  sourceLayers,
  submarineCables,
  substations,
  technologies,
  voltageClasses,
} = mapDataset;

const bubbleScale = 1;
const defaultRegion = regions[0];
const defaultMapTheme = mapThemes.find((theme) => theme.key === "nasa") ?? mapThemes[0];
const economyMapThemes: MapTheme[] = [
  ...mapThemes.filter(({ key }) => key === "nasa" || key === "cartoDark" || key === "satellite"),
  {
    key: "hillshade",
    label: "暗色地形",
    description: "Esri 地貌晕渲",
    tileUrls: ["https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri, Vantor, Airbus DS, USGS, NGA, NASA, CGIAR and the GIS User Community",
    background: "#0b111a",
    rasterOpacity: 0.9,
    rasterSaturation: -1,
    rasterContrast: 0.12,
    rasterBrightnessMax: 0.72,
  },
];
const globeSpinStepDurationMs = 1000;
const globeSpinSecondsPerCycle = 240;
const globeSpinMaxZoom = 2.5;
const defaultGenerationFrame: GenerationFrame = {
  technology: "total",
  mode: "annual",
  year: 2026,
  month: 1,
};

const generationTechnologyLabels: Record<GenerationTechnology, string> = {
  total: "合计",
  wind: "风电",
  solar: "光伏",
};

const generationModeLabels: Record<GenerationTimeMode, string> = {
  annual: "年度",
  monthly: "月度",
};

const initialLabelSettings: LabelSettings = {
  preset: "zoom-v2",
  showLabels: true,
  substationLabels: true,
  basemapTextLabels: true,
  linesOnly: false,
  colorByLineType: true,
  enhancedVisibility: false,
  bigLabels: false,
  lineLabelSize: 96,
  countryBorders: true,
  stateBorders: true,
  provinceLabels: true,
};

const orbitBeacons = [
  {
    id: "noaa-20",
    label: "NOAA 20",
    subtitle: "JPSS (Polar Weather)",
    altitude: "846.6 km",
    velocity: "7.43 km/s",
    coordinates: "-50.53° / 41.74°",
    lngLat: [-50.53, 41.74] as Coordinates,
    delay: "0s",
  },
  {
    id: "sentinel-3b",
    label: "SENTINEL-3B",
    subtitle: "Ocean & Land Mission",
    altitude: "814.5 km",
    velocity: "7.47 km/s",
    coordinates: "18.22° / 72.31°",
    lngLat: [18.22, 72.31] as Coordinates,
    delay: "0.7s",
  },
  {
    id: "sentinel-1a",
    label: "SENTINEL-1A",
    subtitle: "C-Band SAR",
    altitude: "693.0 km",
    velocity: "7.55 km/s",
    coordinates: "-119.44° / 33.92°",
    lngLat: [-119.44, 33.92] as Coordinates,
    delay: "1.1s",
  },
  {
    id: "suomi-npp",
    label: "SUOMI NPP",
    subtitle: "Earth Observation",
    altitude: "824.1 km",
    velocity: "7.46 km/s",
    coordinates: "37.82° / -6.14°",
    lngLat: [37.82, -6.14] as Coordinates,
    delay: "1.6s",
  },
] as const;

function enabledRecord<T extends string>(keys: readonly T[]): BooleanRecord<T> {
  return keys.reduce((state, key) => {
    state[key] = true;
    return state;
  }, {} as BooleanRecord<T>);
}

function technologyState() {
  return enabledRecord(technologies.map((item) => item.key));
}

function hiddenTechnologyState() {
  return technologies.reduce((state, item) => {
    state[item.key] = false;
    return state;
  }, {} as BooleanRecord<TechnologyKey>);
}

function hiddenLayerState() {
  return layerGroups.reduce((state, item) => {
    state[item.key] = false;
    return state;
  }, {} as BooleanRecord<LayerKey>);
}

function legendSectionState() {
  return {
    generation: false,
    technology: false,
    size: false,
    dataCenters: false,
    fiber: false,
    transmission: false,
    openInfraPower: false,
    substations: false,
    plannedUpgrades: false,
    gasPipelines: false,
  } satisfies BooleanRecord<LegendSectionKey>;
}

function generationFocusLegendState() {
  return {
    generation: true,
    technology: false,
    size: false,
    dataCenters: false,
    fiber: false,
    transmission: false,
    openInfraPower: false,
    substations: false,
    plannedUpgrades: false,
    gasPipelines: false,
  } satisfies BooleanRecord<LegendSectionKey>;
}

function sourceLayerState() {
  return enabledRecord(sourceLayers.map((item) => item.key));
}

function voltageState() {
  return voltageClasses.reduce((state, item) => {
    state[item.key] = item.key !== "low";
    return state;
  }, {} as BooleanRecord<VoltageClass>);
}

function hiddenVoltageState() {
  return voltageClasses.reduce((state, item) => {
    state[item.key] = false;
    return state;
  }, {} as BooleanRecord<VoltageClass>);
}

function formatMw(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}GW`;
  }

  return `${value.toLocaleString()}MW`;
}

function formatOptionalMw(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? formatMw(value) : "未知";
}

function formatWeatherTime(value: string | null | undefined) {
  if (!value) return "等待数据";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

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

function generationTechnologyName(technology: GenerationTechnology) {
  return generationTechnologyLabels[technology];
}

function generationModeName(mode: GenerationTimeMode) {
  return generationModeLabels[mode];
}

function generationIsoCode(regionId: string) {
  return regionId.startsWith("cn-") ? `CN-${regionId.slice(3).toUpperCase()}` : null;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function generationFrameHours(frame: GenerationFrame) {
  if (frame.mode === "monthly") {
    return daysInMonth(frame.year, frame.month) * 24;
  }

  return (frame.year % 4 === 0 ? 366 : 365) * 24;
}

function rowGenerationGwh(row: ClimateVreSummaryRow, frame: GenerationFrame) {
  if (frame.mode === "monthly") {
    return numericOrNull(row.monthlyMeans.find((item) => item.month === frame.month)?.generationGwh) ?? 0;
  }

  return numericOrNull(row.annualGenerationGwh) ?? 0;
}

function buildGenerationHeatmapData(summary: ClimateVreSummary | null, frame: GenerationFrame): GenerationHeatmapData | null {
  if (!summary) {
    return null;
  }

  const rowsByRegion = new globalThis.Map<string, Partial<Record<VreTechnology, ClimateVreSummaryRow>>>();
  summary.annual
    .filter((row) => row.year === frame.year && row.regionId !== "china")
    .forEach((row) => {
      const rows = rowsByRegion.get(row.regionId) ?? {};
      rows[row.technology] = row;
      rowsByRegion.set(row.regionId, rows);
    });

  const hours = generationFrameHours(frame);
  const entries = Array.from(rowsByRegion.entries())
    .map(([regionId, rows]) => {
      const selectedRows: ClimateVreSummaryRow[] = frame.technology === "total"
        ? [rows.wind, rows.solar].filter((row): row is ClimateVreSummaryRow => Boolean(row))
        : rows[frame.technology] ? [rows[frame.technology] as ClimateVreSummaryRow] : [];
      const isoCode = generationIsoCode(regionId);
      const firstRow = selectedRows[0];

      if (!isoCode || !firstRow) {
        return null;
      }

      const valueGwh = selectedRows.reduce((sum, row) => sum + rowGenerationGwh(row, frame), 0);
      const capacityMw = selectedRows.reduce((sum, row) => sum + (numericOrNull(row.capacityMw) ?? 0), 0);
      const capacityFactor = capacityMw > 0 && hours > 0 ? valueGwh * 1000 / (capacityMw * hours) : 0;

      return {
        isoCode,
        regionId,
        label: firstRow.regionLabel,
        valueGwh,
        capacityMw,
        capacityFactor,
        normalized: 0,
      } satisfies GenerationHeatmapEntry;
    })
    .filter((entry): entry is GenerationHeatmapEntry => Boolean(entry));

  const maxGwh = Math.max(...entries.map((entry) => entry.valueGwh), 0);
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    normalized: maxGwh > 0 ? Math.sqrt(entry.valueGwh / maxGwh) : 0,
  }));
  const sortedNonZero = normalizedEntries.filter((entry) => entry.valueGwh > 0).sort((a, b) => a.valueGwh - b.valueGwh);

  return {
    entries: normalizedEntries,
    maxGwh,
    nationalGwh: normalizedEntries.reduce((sum, entry) => sum + entry.valueGwh, 0),
    topRegion: sortedNonZero.at(-1) ?? null,
    lowestNonZeroRegion: sortedNonZero[0] ?? null,
  };
}

function mixChannel(start: number, end: number, amount: number) {
  return Math.round(start + (end - start) * amount);
}

function mixRgb(start: [number, number, number], end: [number, number, number], amount: number) {
  return [
    mixChannel(start[0], end[0], amount),
    mixChannel(start[1], end[1], amount),
    mixChannel(start[2], end[2], amount),
  ] as const;
}

function generationHeatColor(normalized: number) {
  if (normalized <= 0) {
    return "rgba(8, 145, 178, 0.08)";
  }

  const stops: { value: number; rgb: [number, number, number] }[] = [
    { value: 0, rgb: [8, 145, 178] },
    { value: 0.42, rgb: [34, 211, 238] },
    { value: 0.72, rgb: [45, 212, 191] },
    { value: 1, rgb: [251, 191, 36] },
  ];
  const nextIndex = stops.findIndex((stop) => normalized <= stop.value);
  const upper = stops[nextIndex === -1 ? stops.length - 1 : nextIndex];
  const lower = stops[Math.max(0, (nextIndex === -1 ? stops.length - 1 : nextIndex) - 1)];
  const span = Math.max(upper.value - lower.value, 0.001);
  const [r, g, b] = mixRgb(lower.rgb, upper.rgb, (normalized - lower.value) / span);
  const alpha = Math.min(0.9, 0.18 + normalized * 0.72);

  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function generationHeatColorExpression(data: GenerationHeatmapData | null) {
  if (!data || data.entries.length === 0) {
    return "rgba(0, 0, 0, 0)";
  }

  const matchPairs = data.entries.flatMap((entry) => [entry.isoCode, generationHeatColor(entry.normalized)]);
  return [
    "case",
    ["==", ["get", "adm0_a3"], "CHN"],
    ["match", ["get", "iso_3166_2"], ...matchPairs, "rgba(8, 145, 178, 0.05)"],
    "rgba(0, 0, 0, 0)",
  ] as unknown as ExpressionSpecification;
}

function generationFrameText(frame: GenerationFrame) {
  return frame.mode === "monthly" ? `${frame.year} 年 ${frame.month} 月` : `${frame.year} 年`;
}

function generationFrameSubtitle(entry: GenerationHeatmapEntry, frame: GenerationFrame) {
  return `${generationFrameText(frame)} · ${generationTechnologyName(frame.technology)} · ${generationLabel(entry.valueGwh)} · 容量因子 ${capacityFactorPercent(entry.capacityFactor)}`;
}

function generationFeatureFromEntry(entry: GenerationHeatmapEntry, frame: GenerationFrame, coordinates: Coordinates): SelectedFeature {
  return {
    id: `generation-${entry.regionId}-${frame.technology}-${frame.mode}-${frame.year}-${frame.month}`,
    kind: "energy",
    title: `${entry.label}发电量`,
    subtitle: generationFrameSubtitle(entry, frame),
    coordinates,
    color: generationHeatColor(entry.normalized),
    rows: [
      { label: "时间", value: generationFrameText(frame) },
      { label: "类型", value: generationTechnologyName(frame.technology) },
      { label: "估算发电量", value: generationLabel(entry.valueGwh) },
      { label: "映射装机", value: formatMw(entry.capacityMw) },
      { label: "容量因子", value: capacityFactorPercent(entry.capacityFactor) },
    ],
    source: "GFDL-ESM4 SSP126 VRE projection",
  };
}

function nextGenerationFrame(frame: GenerationFrame, years: number[]) {
  if (frame.mode === "monthly") {
    return {
      ...frame,
      month: frame.month >= 12 ? 1 : frame.month + 1,
    };
  }

  const minYear = years[0] ?? 2021;
  const maxYear = years.at(-1) ?? 2060;
  return {
    ...frame,
    year: frame.year >= maxYear ? minYear : frame.year + 1,
  };
}

function localizeStatus(value: string) {
  const statuses: Record<string, string> = {
    Operating: "运行中",
    Planned: "规划中",
    Construction: "建设中",
    Permitting: "许可审批中",
    Engineering: "工程设计中",
    Planning: "规划中",
    Conceptual: "概念阶段",
    Disused: "已停用",
    "Mapped in OSM": "已在 OSM 标注",
  };

  return statuses[value] ?? value;
}

function localizeSourceLayer(value: string) {
  return sourceLayers.find((layer) => layer.key === value)?.label ?? value;
}

function localizeTechnology(value: string) {
  return technologies.find((item) => item.key === value)?.label ?? value;
}

function localizePipelineKind(value: string) {
  const kinds: Record<string, string> = {
    Interstate: "跨州管线",
    Intrastate: "州内管线",
  };

  return kinds[value] ?? value;
}

function technologyColor(key: TechnologyKey) {
  return technologies.find((item) => item.key === key)?.color ?? "#aab6c6";
}

function voltageColor(key: VoltageClass) {
  return voltageClasses.find((item) => item.key === key)?.color ?? "#00e5ff";
}

function voltageColorForKv(value: number) {
  return voltageClasses.find((item) => value >= item.minKv)?.color ?? "#00e5ff";
}

function getGeoJsonSource(map: Map, sourceId: string) {
  const source = map.getSource(sourceId);
  if (!source || !("setData" in source)) {
    return null;
  }

  return source as GeoJSONSource;
}

function emptyPointCollection(): PointCollection {
  return { type: "FeatureCollection", features: [] };
}

function emptyLineCollection(): LineCollection {
  return { type: "FeatureCollection", features: [] };
}

function countryLabelRank(population: number) {
  if (population >= 1_000_000_000) return 1;
  if (population >= 100_000_000) return 2;
  if (population >= 30_000_000) return 3;
  if (population >= 5_000_000) return 4;
  return 7;
}

function buildCountryLabelCollection(): PointCollection {
  const centers = countryCenters as unknown as CountryLabelCenter[];
  const features: Feature<Point, MapProperties>[] = centers
    .filter((country) => country.code !== "ATA" && country.continent !== "Seven seas (open ocean)")
    .map((country) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: country.center },
      properties: {
        code: country.code,
        name: country.name,
        population: country.pop,
        rank: countryLabelRank(country.pop),
      },
    }));

  return { type: "FeatureCollection", features } satisfies PointCollection;
}

function buildContinentLabelCollection(): PointCollection {
  const labels: Array<{ label: string; coordinates: Coordinates }> = [
    { label: "NORTH AMERICA", coordinates: [-104, 48] },
    { label: "SOUTH AMERICA", coordinates: [-60, -18] },
    { label: "EUROPE", coordinates: [16, 53] },
    { label: "AFRICA", coordinates: [19, 2] },
    { label: "ASIA", coordinates: [84, 43] },
    { label: "OCEANIA", coordinates: [137, -24] },
    { label: "ANTARCTICA", coordinates: [20, -76] },
  ];

  return {
    type: "FeatureCollection",
    features: labels.map((label) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: label.coordinates },
      properties: { label: label.label },
    })),
  };
}

function plantRadiusByCapacityExpression(scale: number) {
  return [
    "interpolate",
    ["linear"],
    ["get", "capacityMw"],
    50,
    capacityToRadius(50, scale),
    100,
    capacityToRadius(100, scale),
    500,
    capacityToRadius(500, scale),
    1000,
    capacityToRadius(1000, scale),
    2500,
    capacityToRadius(2500, scale),
    5000,
    capacityToRadius(5000, scale),
  ] as ExpressionSpecification;
}

function plantHaloRadiusByCapacityExpression(scale: number, zoomScale: number) {
  return [
    "interpolate",
    ["linear"],
    ["get", "capacityMw"],
    50,
    capacityToRadius(50, scale) + (0.35 * zoomScale),
    100,
    capacityToRadius(100, scale) + (0.45 * zoomScale),
    500,
    capacityToRadius(500, scale) + (0.65 * zoomScale),
    1000,
    capacityToRadius(1000, scale) + (0.85 * zoomScale),
    2500,
    capacityToRadius(2500, scale) + (1.1 * zoomScale),
    5000,
    capacityToRadius(5000, scale) + (1.35 * zoomScale),
  ] as ExpressionSpecification;
}

function plantRadiusExpression(scale: number) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    1,
    plantRadiusByCapacityExpression(scale * 0.18),
    2.2,
    plantRadiusByCapacityExpression(scale * 0.26),
    3.6,
    plantRadiusByCapacityExpression(scale * 0.4),
    5,
    plantRadiusByCapacityExpression(scale * 0.56),
  ] as ExpressionSpecification;
}

function plantHaloRadiusExpression(scale: number) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    1,
    plantHaloRadiusByCapacityExpression(scale * 0.18, 0.18),
    2.2,
    plantHaloRadiusByCapacityExpression(scale * 0.26, 0.26),
    3.6,
    plantHaloRadiusByCapacityExpression(scale * 0.4, 0.4),
    5,
    plantHaloRadiusByCapacityExpression(scale * 0.56, 0.56),
  ] as ExpressionSpecification;
}

function dataCenterIconSizeByCapacityExpression(scale: number) {
  return [
    "interpolate",
    ["linear"],
    ["get", "capacityMw"],
    50,
    0.26 * scale,
    200,
    0.38 * scale,
    600,
    0.56 * scale,
  ] as ExpressionSpecification;
}

function dataCenterIconSizeExpression() {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    1,
    dataCenterIconSizeByCapacityExpression(0.58),
    2.2,
    dataCenterIconSizeByCapacityExpression(0.66),
    3.6,
    dataCenterIconSizeByCapacityExpression(0.82),
    5,
    dataCenterIconSizeByCapacityExpression(1),
  ] as ExpressionSpecification;
}

function angularDistanceDegrees(from: Coordinates, to: Coordinates) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const fromLat = toRadians(from[1]);
  const toLat = toRadians(to[1]);
  const deltaLng = toRadians(to[0] - from[0]);
  const cosine = Math.sin(fromLat) * Math.sin(toLat) + Math.cos(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);

  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

const baseMapStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  projection: { type: "globe" },
  sources: {
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": defaultMapTheme.background,
      },
    },
  ],
};

const openInfraPowerSourceId = "openinframap-power";
const openInfraPowerTileTemplate = "/api/data/vector-tiles/china-260517-osm-z3-5-20260519-plants-generators/{z}/{x}/{y}.pbf";
const openInfraBasemapSourceId = "openinframap-basemap";
const openInfraBasemapTileTemplate = "https://openinframap.org/20250311/{z}/{x}/{y}.mvt";
const cartoBasemapSourceId = "carto-basemap";
const cartoBasemapTileJsonUrl = "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json";
const chinaTransmissionPreviewSourceId = "china-transmission-preview";
const chinaTransmissionPreviewUrl = "/api/data/geojson?path=/data/osm-power/china-transmission-preview.geojson";
const chinaTransmissionDetailSourceId = "china-transmission-detail-preview";
const chinaTransmissionDetailUrl = "/api/data/geojson?path=/data/osm-power/china-transmission-detail-preview.geojson";
const chinaTransmissionDetailMinZoom = 3;
const chinaTransmissionPreviewLayerIds = ["china-transmission-preview-glow", "china-transmission-preview-main"];
const chinaTransmissionDetailLayerIds = ["china-transmission-detail-glow", "china-transmission-detail-main"];
const localOsmTransmissionLayerIds = ["oim-power-line-glow", "oim-power-line-main"];
const localOsmSubstationLayerIds = ["oim-power-substation-point"];
const localOsmAssetLayerIds = ["oim-power-plant-point"];
const transmissionOverlayLayerIds = [
  ...chinaTransmissionPreviewLayerIds,
  ...chinaTransmissionDetailLayerIds,
  ...localOsmTransmissionLayerIds,
];
const initiallyHiddenBusinessLayerIds = [
  ...transmissionOverlayLayerIds,
  ...localOsmSubstationLayerIds,
  ...localOsmAssetLayerIds,
];

const openInfraAttribution = "OpenStreetMap contributors";
const naturalEarthAttribution = "Natural Earth";
const naturalEarthSources = {
  countries: "/api/data/geojson?path=/data/natural-earth/ne_50m_admin_0_countries.geojson",
  countryLines: "/api/data/geojson?path=/data/natural-earth/ne_50m_admin_0_boundary_lines_land.geojson",
  admin1Polygons: "/api/data/geojson?path=/data/natural-earth/ne_50m_admin_1_states_provinces.geojson",
  admin1Lines: "/api/data/geojson?path=/data/natural-earth/ne_50m_admin_1_states_provinces_lines.geojson",
};

function localPowerTileUrl() {
  if (typeof window === "undefined") {
    return openInfraPowerTileTemplate;
  }

  return `${window.location.origin}${openInfraPowerTileTemplate}`;
}

function oimNumber(field: string) {
  return ["to-number", ["get", field], 0] as unknown as ExpressionSpecification;
}

function oimVoltageKv() {
  const localKv = oimNumber("voltageKv");
  const rawVoltage = oimNumber("voltage");

  return [
    "case",
    [">", localKv, 0],
    localKv,
    [">", rawVoltage, 2000],
    ["/", rawVoltage, 1000],
    rawVoltage,
  ] as unknown as ExpressionSpecification;
}

function oimVoltageClass() {
  const voltageKv = oimVoltageKv();

  return [
    "case",
    [">", voltageKv, 0],
    [
      "case",
        [">=", voltageKv, 1000],
        "1000",
        [">=", voltageKv, 735],
        "1000",
        [">=", voltageKv, 500],
        "750",
        [">=", voltageKv, 345],
        "500",
        [">=", voltageKv, 230],
        "220",
        [">=", voltageKv, 100],
        "110",
        [">=", voltageKv, 31],
        "35",
      "low",
    ],
    ["coalesce", ["get", "voltageClass"], "low"],
  ] as unknown as ExpressionSpecification;
}

function oimVoltageColor() {
  const voltageKv = oimVoltageKv();

  return [
    "case",
    ["any", ["==", ["get", "frequency"], "0"], ["==", ["get", "frequency"], 0]],
    "#4e01b5",
    [
      "step",
      voltageKv,
      "#59606d",
      31,
      "#7f6ab1",
      100,
      "#5f68bd",
      230,
      "#3b78bd",
      345,
      "#238fba",
      500,
      "#4bc4cf",
      735,
      "#dbe8ee",
    ],
  ] as unknown as ExpressionSpecification;
}

function transmissionPreviewColor() {
  return [
    "match",
    oimVoltageClass(),
    "1000",
    "#f8fafc",
    "750",
    "#22d3ee",
    "500",
    "#0ea5e9",
    "220",
    "#3b82f6",
    "110",
    "#6366f1",
    "35",
    "#a855f7",
    "low",
    "#9333ea",
    "#22d3ee",
  ] as unknown as ExpressionSpecification;
}

function transmissionPreviewLineWidth(glow: boolean) {
  const classWidth = [
    "match",
    oimVoltageClass(),
    "1000",
    glow ? 3 : 1.22,
    "750",
    glow ? 2.55 : 1.02,
    glow ? 2 : 0.78,
  ];

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    1.4,
    ["*", 0.72, classWidth],
    2.6,
    ["*", 0.92, classWidth],
    4,
    ["*", 1.12, classWidth],
    6,
    ["*", 1.35, classWidth],
  ] as unknown as ExpressionSpecification;
}

function transmissionDetailLineWidth(glow: boolean) {
  const classWidth = [
    "match",
    oimVoltageClass(),
    "500",
    glow ? 1.5 : 0.44,
    "220",
    glow ? 1.28 : 0.38,
    "110",
    glow ? 1.08 : 0.3,
    "35",
    glow ? 0.86 : 0.22,
    "low",
    glow ? 0.68 : 0.16,
    glow ? 1 : 0.28,
  ];

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,
    ["*", 0.74, classWidth],
    4.6,
    classWidth,
    6,
    ["*", 1.22, classWidth],
  ] as unknown as ExpressionSpecification;
}

function transmissionDetailOpacity(glow: boolean) {
  const classOpacity = [
    "match",
    oimVoltageClass(),
    "500",
    1,
    "220",
    0.9,
    "110",
    0.82,
    "35",
    0.68,
    "low",
    0.48,
    0.75,
  ];

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,
    ["*", glow ? 0.08 : 0.2, classOpacity],
    4.6,
    ["*", glow ? 0.2 : 0.54, classOpacity],
    6,
    ["*", glow ? 0.28 : 0.7, classOpacity],
  ] as unknown as ExpressionSpecification;
}

function oimLineWidth(glow: boolean) {
  const voltageKv = oimVoltageKv();
  const voltageWidth = [
    "interpolate",
    ["linear"],
    voltageKv,
    31,
    glow ? 0.42 : 0.18,
    100,
    glow ? 0.62 : 0.28,
    230,
    glow ? 0.9 : 0.42,
    345,
    glow ? 1.3 : 0.62,
    500,
    glow ? 1.9 : 0.88,
    735,
    glow ? 2.45 : 1.15,
  ];

  return glow
    ? ([
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      ["*", 0.5, voltageWidth],
      4.5,
      ["*", 0.72, voltageWidth],
      6,
      voltageWidth,
    ] as unknown as ExpressionSpecification)
    : ([
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      ["*", 0.55, voltageWidth],
      4.5,
      ["*", 0.8, voltageWidth],
      6,
      voltageWidth,
    ] as unknown as ExpressionSpecification);
}

function oimSubstationRadius() {
  return [
    "interpolate",
    ["linear"],
    oimVoltageKv(),
    31,
    1.8,
    100,
    2.4,
    230,
    3,
    345,
    4,
    500,
    4.7,
    735,
    5.4,
  ] as unknown as ExpressionSpecification;
}

function localizedAdminName() {
  return ["coalesce", ["get", "name_zh"], ["get", "name_zht"], ["get", "name_en"], ["get", "name"]] as unknown as ExpressionSpecification;
}

function voltageClassFilter(visibleClasses: BooleanRecord<VoltageClass>): FilterSpecification {
  const activeClasses = voltageClasses
    .filter((item) => visibleClasses[item.key])
    .map((item) => item.key);
  return ["in", oimVoltageClass(), ["literal", activeClasses]] as unknown as FilterSpecification;
}

function applyMapTheme(map: Map, theme: MapTheme) {
  if (map.isStyleLoaded()) {
    applyRasterBasemap(map, theme, map.getLayer("grid-lines-glow") ? "grid-lines-glow" : undefined);
  }
}

function buildEnergyCollection(
  visibleTechnologies: BooleanRecord<TechnologyKey>,
  activeSizeMin: number | null,
) {
  const features: Feature<Point, MapProperties>[] = energyAssets
    .filter((asset) => visibleTechnologies[asset.technology])
    .filter((asset) => activeSizeMin === null || asset.capacityMw >= activeSizeMin)
    .map((asset) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [asset.lng, asset.lat] },
      properties: {
        id: asset.id,
        kind: "energy",
        name: asset.name,
        technology: asset.technology,
        label: technologies.find((item) => item.key === asset.technology)?.label ?? "其他",
        capacityMw: asset.capacityMw,
        status: asset.status,
        countryCode: asset.countryCode,
        source: asset.source,
        owner: asset.owner ?? "",
        operator: asset.operator ?? "",
        sourceId: asset.sourceId ?? "",
        commissioningYear: asset.commissioningYear ?? 0,
        river: asset.river ?? "",
        mainBasin: asset.mainBasin ?? "",
        color: technologyColor(asset.technology),
      },
    }));

  return { type: "FeatureCollection", features } satisfies PointCollection;
}

function buildDataCenterCollection(visibleLayers: BooleanRecord<LayerKey>) {
  const features: Feature<Point, MapProperties>[] = dataCenters
    .filter((asset) => asset.kind === "data-center" ? visibleLayers.dataCenters : visibleLayers.internetExchanges)
    .map((asset) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [asset.lng, asset.lat] },
      properties: {
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        operator: asset.operator,
        capacityMw: asset.capacityMw ?? 0,
        capacityKnown: Boolean(asset.capacityMw),
        countryCode: asset.countryCode,
        source: asset.source,
        city: asset.city ?? "",
        status: asset.status ?? "",
        updated: asset.updated ?? "",
        reviewSource: asset.review_source ?? "",
        reviewedAt: asset.reviewed_at ?? "",
        coordinateConfidence: asset.coordinate_confidence ?? "",
        color: asset.kind === "data-center" ? "#f8fafc" : "#64748b",
      },
    }));

  return { type: "FeatureCollection", features } satisfies PointCollection;
}

function buildGridLineCollection(
  visibleLayers: BooleanRecord<LayerKey>,
  visibleSourceLayers: BooleanRecord<SourceLayerKey>,
  visibleVoltageClasses: BooleanRecord<VoltageClass>,
) {
  const transmissionFeatures: Feature<LineString, MapProperties>[] = gridLines
    .filter(() => visibleLayers.transmission)
    .filter((line) => visibleSourceLayers[line.sourceLayer])
    .filter((line) => visibleVoltageClasses[line.voltageClass])
    .map((line) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line.coordinates },
      properties: {
        id: line.id,
        kind: "grid-line",
        name: line.name,
        voltageKv: line.voltageKv,
        voltageClass: line.voltageClass,
        sourceLayer: line.sourceLayer,
        status: line.status,
        networkTier: line.networkTier ?? "regional",
        color: voltageColor(line.voltageClass),
      },
    }));

  const upgradeFeatures: Feature<LineString, MapProperties>[] = plannedUpgrades
    .filter(() => visibleLayers.plannedUpgrades)
    .map((upgrade) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: upgrade.coordinates },
      properties: {
        id: upgrade.id,
        kind: "upgrade",
        name: upgrade.name,
        stage: upgrade.stage,
        countryCode: upgrade.countryCode,
        source: upgrade.source,
        color: "#ffb800",
      },
    }));

  const pipelineFeatures: Feature<LineString, MapProperties>[] = gasPipelines
    .filter(() => visibleLayers.gasPipelines)
    .map((pipeline) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: pipeline.coordinates },
      properties: {
        id: pipeline.id,
        kind: "pipeline",
        name: pipeline.name,
        pipelineKind: pipeline.kind,
        source: pipeline.source,
        color: pipeline.kind === "Interstate" ? "#ff6600" : "#fb923c",
      },
    }));

  const cableFeatures: Feature<LineString, MapProperties>[] = submarineCables
    .filter(() => visibleLayers.submarineCables || visibleLayers.fiber)
    .map((cable) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: cable.coordinates },
      properties: {
        id: cable.id,
        kind: "submarine-cable",
        name: cable.name,
        operator: cable.operator,
        source: cable.source,
        lengthKm: cable.lengthKm,
        readyForService: cable.readyForService,
        color: "#22d3ee",
      },
    }));

  return {
    type: "FeatureCollection",
    features: [...transmissionFeatures, ...upgradeFeatures, ...pipelineFeatures, ...cableFeatures],
  } satisfies LineCollection;
}

function buildCustomLayerCollection(visibleCustomLayers: BooleanRecord<CustomLayerKey>) {
  const features: Feature<LineString, MapProperties>[] = [];

  if (visibleCustomLayers.customCorridor) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[-124.4, 37.7], [-112.2, 39.7], [-96.4, 41.1], [-77.5, 39.2], [-5.2, 48.4], [2.3, 48.9]],
      },
      properties: {
        id: "custom-ai-load-corridor",
        kind: "upgrade",
        name: "Custom AI Load Corridor",
        stage: "早期测试",
        countryCode: "Demo",
        source: "自定义图层演示",
        color: "#ff00c8",
      },
    });
  }

  if (visibleCustomLayers.customHeatmap) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[101.2, 36.4], [108.6, 34.2], [116.4, 39.9], [139.8, 35.7]],
      },
      properties: {
        id: "custom-asia-demand-band",
        kind: "upgrade",
        name: "Asia Demand Band",
        stage: "早期测试",
        countryCode: "Demo",
        source: "自定义图层演示",
        color: "#00ffbf",
      },
    });
  }

  return { type: "FeatureCollection", features } satisfies LineCollection;
}

function buildSubstationCollection(
  visibleLayers: BooleanRecord<LayerKey>,
  visibleSourceLayers: BooleanRecord<SourceLayerKey>,
  visibleSubstationClasses: BooleanRecord<VoltageClass>,
) {
  const features: Feature<Point, MapProperties>[] = substations
    .filter(() => visibleLayers.substations)
    .filter((substation) => visibleSourceLayers[substation.sourceLayer])
    .filter((substation) => visibleSubstationClasses[substation.voltageClass])
    .map((substation) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [substation.lng, substation.lat] },
      properties: {
        id: substation.id,
        kind: "substation",
        name: substation.name,
        voltageClass: substation.voltageClass,
        sourceLayer: substation.sourceLayer,
        color: voltageColor(substation.voltageClass),
      },
    }));

  return { type: "FeatureCollection", features } satisfies PointCollection;
}

function buildLandingPointCollection(visibleLayers: BooleanRecord<LayerKey>) {
  const features: Feature<Point, MapProperties>[] = landingPoints
    .filter(() => visibleLayers.landingPoints || visibleLayers.fiber)
    .map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      properties: {
        id: point.id,
        kind: "landing-point",
        name: point.name,
        cableId: point.cableId,
        countryCode: point.countryCode,
        color: "#67e8f9",
      },
    }));

  return { type: "FeatureCollection", features } satisfies PointCollection;
}

function readString(properties: Record<string, unknown>, key: string) {
  const value = properties[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function readFirstString(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readString(properties, key);

    if (value) {
      return value;
    }
  }

  return "";
}

function readNumber(properties: Record<string, unknown>, key: string) {
  const value = properties[key];

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const numericValue = value.match(/\d+(?:\.\d+)?/)?.[0];
    return numericValue ? Number(numericValue) : 0;
  }

  return Number(value) || 0;
}

function readVoltageKv(properties: Record<string, unknown>) {
  const localKv = readNumber(properties, "voltageKv");

  if (localKv > 0) {
    return localKv;
  }

  const rawVoltage = readNumber(properties, "voltage");
  return rawVoltage > 2000 ? rawVoltage / 1000 : rawVoltage;
}

function openInfraFeatureToSelected(
  feature: MapGeoJSONFeature,
  properties: Record<string, unknown>,
  fallbackCoordinates: Coordinates,
): SelectedFeature | null {
  if (feature.source !== openInfraPowerSourceId || !feature.layer.id.startsWith("oim-power-")) {
    return null;
  }

  const layerId = feature.layer.id;
  const name = readString(properties, "name");
  const ref = readString(properties, "ref");
  const voltage = readVoltageKv(properties);
  const color = voltage ? voltageColorForKv(voltage) : "#67e8f9";
  const title = name || ref || "本地 OSM 电力要素";
  const url = readString(properties, "url");
  const status = readString(properties, "construction") === "true" ? "Construction" : readString(properties, "disused") === "true" ? "Disused" : "Mapped in OSM";

  if (layerId.includes("power-line")) {
    return {
      id: readString(properties, "id") || title,
      kind: "grid-line",
      title,
      subtitle: voltage ? `${voltage}kV OpenStreetMap 线路` : "OpenStreetMap 电力线路",
      coordinates: fallbackCoordinates,
      color,
      source: openInfraAttribution,
      rows: [
        { label: "电压", value: voltage ? `${voltage} kV` : "未知" },
        { label: "参考编号", value: ref || "未列明" },
        { label: "状态", value: localizeStatus(status) },
        { label: "OSM 对象", value: url || "本地 OSM 瓦片" },
      ],
    };
  }

  if (layerId.includes("substation")) {
    return {
      id: readString(properties, "id") || title,
      kind: "substation",
      title,
      subtitle: voltage ? `${voltage}kV 变电站` : "OpenStreetMap 变电站",
      coordinates: fallbackCoordinates,
      color,
      source: openInfraAttribution,
      rows: [
        { label: "电压", value: voltage ? `${voltage} kV` : "未知" },
        { label: "类型", value: readString(properties, "substation") || "变电站" },
        { label: "状态", value: localizeStatus(status) },
        { label: "OSM 对象", value: url || "本地 OSM 瓦片" },
      ],
    };
  }

  const outputMw = readNumber(properties, "output");
  const plantSource = readFirstString(properties, ["plant:source", "plant_source", "generator:source", "generator_source", "source"]);

  return {
    id: readString(properties, "id") || title,
    kind: "energy",
    title,
    subtitle: plantSource ? `${localizeTechnology(plantSource)} 电源项目` : "OpenStreetMap 电源项目",
    coordinates: fallbackCoordinates,
    color: plantSource ? technologyColor(plantSource as TechnologyKey) : "#dbe4f0",
    source: openInfraAttribution,
    rows: [
      { label: "装机容量", value: outputMw ? formatMw(outputMw) : "未知" },
      { label: "能源类型", value: plantSource ? localizeTechnology(plantSource) : "未列明" },
      { label: "标注方式", value: readString(properties, "method") || "未列明" },
      { label: "OSM 对象", value: url || "本地 OSM 瓦片" },
    ],
  };
}

function featureToSelected(
  feature: MapGeoJSONFeature,
  fallbackCoordinates: Coordinates,
): SelectedFeature {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const openInfraFeature = openInfraFeatureToSelected(feature, properties, fallbackCoordinates);

  if (openInfraFeature) {
    return openInfraFeature;
  }

  const kind = readString(properties, "kind");
  const color = readString(properties, "color") || "#67e8f9";
  const title = readString(properties, "name") || "地图要素";

  if (kind === "energy") {
    const capacityMw = readNumber(properties, "capacityMw");
    return {
      id: readString(properties, "id"),
      kind: "energy",
      title,
      subtitle: readString(properties, "label"),
      coordinates: fallbackCoordinates,
      color,
      source: readString(properties, "source"),
      rows: [
        { label: "装机容量", value: formatMw(capacityMw) },
        { label: "状态", value: localizeStatus(readString(properties, "status")) },
        { label: "业主", value: readString(properties, "owner") || "未知" },
        { label: "运营方", value: readString(properties, "operator") || "未知" },
        { label: "来源 ID", value: readString(properties, "sourceId") || "未列明" },
        { label: "投运年份", value: readNumber(properties, "commissioningYear") ? String(readNumber(properties, "commissioningYear")) : "未知" },
        { label: "国家/地区", value: readString(properties, "countryCode") },
      ],
    };
  }

  if (kind === "data-center" || kind === "internet-exchange") {
    return {
      id: readString(properties, "id"),
      kind,
      title,
      subtitle: readString(properties, "operator"),
      coordinates: fallbackCoordinates,
      color,
      source: readString(properties, "source"),
      rows: [
        { label: "负荷", value: readString(properties, "capacityKnown") === "true" ? formatMw(readNumber(properties, "capacityMw")) : "未知" },
        { label: "城市", value: readString(properties, "city") || "未知" },
        { label: "坐标可信度", value: readString(properties, "coordinateConfidence") || "未知" },
        { label: "国家/地区", value: readString(properties, "countryCode") },
      ],
    };
  }

  if (kind === "grid-line") {
    return {
      id: readString(properties, "id"),
      kind: "grid-line",
      title,
      subtitle: `${readNumber(properties, "voltageKv")}kV 输电线路`,
      coordinates: fallbackCoordinates,
      color,
      rows: [
        { label: "状态", value: localizeStatus(readString(properties, "status")) },
        { label: "来源图层", value: localizeSourceLayer(readString(properties, "sourceLayer")) },
      ],
    };
  }

  if (kind === "substation") {
    return {
      id: readString(properties, "id"),
      kind: "substation",
      title,
      subtitle: "变电站",
      coordinates: fallbackCoordinates,
      color,
      rows: [
        { label: "电压等级", value: readString(properties, "voltageClass") },
        { label: "来源图层", value: localizeSourceLayer(readString(properties, "sourceLayer")) },
      ],
    };
  }

  if (kind === "upgrade") {
    return {
      id: readString(properties, "id"),
      kind: "upgrade",
      title,
      subtitle: "规划升级项目",
      coordinates: fallbackCoordinates,
      color,
      source: readString(properties, "source"),
      rows: [
        { label: "阶段", value: localizeStatus(readString(properties, "stage")) },
        { label: "国家/地区", value: readString(properties, "countryCode") },
      ],
    };
  }

  if (kind === "pipeline") {
    return {
      id: readString(properties, "id"),
      kind: "pipeline",
      title,
      subtitle: "天然气管线",
      coordinates: fallbackCoordinates,
      color,
      source: readString(properties, "source"),
      rows: [{ label: "类型", value: localizePipelineKind(readString(properties, "pipelineKind")) }],
    };
  }

  if (kind === "submarine-cable") {
    return {
      id: readString(properties, "id"),
      kind: "submarine-cable",
      title,
      subtitle: readString(properties, "operator"),
      coordinates: fallbackCoordinates,
      color,
      source: readString(properties, "source"),
      rows: [
        { label: "长度", value: `${readNumber(properties, "lengthKm").toLocaleString()} km` },
        { label: "投运时间", value: readString(properties, "readyForService") },
      ],
    };
  }

  return {
    id: readString(properties, "id"),
    kind: "landing-point",
    title,
    subtitle: "登陆点",
    coordinates: fallbackCoordinates,
    color,
    rows: [{ label: "国家/地区", value: readString(properties, "countryCode") }],
  };
}

function addDiamondImage(map: Map, id: string, fill: string, frame: string, glow: string) {
  if (map.hasImage(id)) {
    return;
  }

  const pixelRatio = 2;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size * pixelRatio;
  canvas.height = size * pixelRatio;
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  context.scale(pixelRatio, pixelRatio);
  context.translate(size / 2, size / 2);
  context.shadowColor = glow;
  context.shadowBlur = 16;
  context.fillStyle = frame;
  context.beginPath();
  context.moveTo(0, -18);
  context.lineTo(18, 0);
  context.lineTo(0, 18);
  context.lineTo(-18, 0);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(103, 232, 249, 0.95)";
  context.lineWidth = 2.5;
  context.stroke();
  context.fillStyle = fill;
  context.beginPath();
  context.moveTo(0, -11.5);
  context.lineTo(11.5, 0);
  context.lineTo(0, 11.5);
  context.lineTo(-11.5, 0);
  context.closePath();
  context.fill();
  map.addImage(id, context.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio });
}

function addInteractiveLayers(map: Map) {
  map.addSource("energy-assets", { type: "geojson", data: emptyPointCollection() });
  map.addSource("carbon-emissions", { type: "geojson", data: emptyPointCollection() });
  map.addSource("data-centers", { type: "geojson", data: emptyPointCollection() });
  map.addSource("grid-lines", { type: "geojson", data: emptyLineCollection() });
  map.addSource(chinaTransmissionPreviewSourceId, {
    type: "geojson",
    data: emptyLineCollection(),
    attribution: openInfraAttribution,
  });
  map.addSource(chinaTransmissionDetailSourceId, {
    type: "geojson",
    data: emptyLineCollection(),
    attribution: openInfraAttribution,
  });
  map.addSource("custom-layers", { type: "geojson", data: emptyLineCollection() });
  map.addSource("substations", { type: "geojson", data: emptyPointCollection() });
  map.addSource("landing-points", { type: "geojson", data: emptyPointCollection() });
  map.addSource("country-label-points", {
    type: "geojson",
    data: buildCountryLabelCollection(),
    attribution: naturalEarthAttribution,
  });
  map.addSource("continent-label-points", {
    type: "geojson",
    data: buildContinentLabelCollection(),
    attribution: naturalEarthAttribution,
  });
  map.addSource("ne-countries", { type: "geojson", data: naturalEarthSources.countries, attribution: naturalEarthAttribution });
  map.addSource("ne-country-lines", { type: "geojson", data: naturalEarthSources.countryLines, attribution: naturalEarthAttribution });
  map.addSource("ne-admin1-polygons", { type: "geojson", data: naturalEarthSources.admin1Polygons, attribution: naturalEarthAttribution });
  map.addSource("ne-admin1-lines", { type: "geojson", data: naturalEarthSources.admin1Lines, attribution: naturalEarthAttribution });
  map.addSource(cartoBasemapSourceId, {
    type: "vector",
    url: cartoBasemapTileJsonUrl,
    attribution: "CARTO, OpenStreetMap contributors",
  });
  map.addSource(openInfraBasemapSourceId, {
    type: "vector",
    tiles: [openInfraBasemapTileTemplate],
    maxzoom: 15,
    attribution: openInfraAttribution,
  });
  map.addSource(openInfraPowerSourceId, {
    type: "vector",
    tiles: [localPowerTileUrl()],
    minzoom: 3,
    maxzoom: 5,
    bounds: [73.258153, 18.217487, 135.112781, 53.965489],
    attribution: openInfraAttribution,
  });
  addDiamondImage(map, "og-diamond-data", "#f8fafc", "#00e5ff", "rgba(0, 229, 255, 0.95)");
  addDiamondImage(map, "og-diamond-ix", "#dbe4f0", "#00a3ff", "rgba(0, 163, 255, 0.76)");

  map.addLayer({
    id: "grid-lines-glow",
    type: "line",
    source: "grid-lines",
    paint: {
      "line-color": ["get", "color"],
      "line-width": [
        "case",
        ["==", ["get", "kind"], "grid-line"],
        [
          "*",
          ["interpolate", ["linear"], ["get", "voltageKv"], 31, 0.9, 100, 1.25, 230, 1.8, 345, 2.7, 500, 3.8, 735, 4.8],
          ["case", ["==", ["get", "networkTier"], "interconnector"], 1.12, ["==", ["get", "networkTier"], "backbone"], 1.04, 1],
        ],
        ["==", ["get", "kind"], "submarine-cable"],
        0.65,
        1.2,
      ],
      "line-opacity": [
        "case",
        ["==", ["get", "kind"], "submarine-cable"],
        0.16,
        ["==", ["get", "networkTier"], "local"],
        0.08,
        0.22,
      ],
      "line-blur": ["case", ["==", ["get", "kind"], "submarine-cable"], 1.4, 5],
    },
  });

  map.addLayer({
    id: "grid-lines-main",
    type: "line",
    source: "grid-lines",
    paint: {
      "line-color": ["get", "color"],
      "line-width": [
        "case",
        ["==", ["get", "kind"], "grid-line"],
        [
          "*",
          ["interpolate", ["linear"], ["get", "voltageKv"], 31, 0.24, 100, 0.38, 230, 0.62, 345, 0.92, 500, 1.3, 735, 1.85],
          ["case", ["==", ["get", "networkTier"], "interconnector"], 1.16, ["==", ["get", "networkTier"], "backbone"], 1.08, 1],
        ],
        ["==", ["get", "kind"], "submarine-cable"],
        0.34,
        0.72,
      ],
      "line-opacity": ["case", ["==", ["get", "kind"], "submarine-cable"], 0.38, ["==", ["get", "networkTier"], "local"], 0.42, 0.72],
    },
  });

  map.addLayer({
    id: "grid-lines-highlight",
    type: "line",
    source: "grid-lines",
    filter: ["all", ["==", ["get", "kind"], "grid-line"], [">=", ["get", "voltageKv"], 500]],
    paint: {
      "line-color": ["case", [">=", ["get", "voltageKv"], 735], "#ffffff", "#67e8f9"],
      "line-width": [
        "*",
        ["interpolate", ["linear"], ["get", "voltageKv"], 500, 0.32, 735, 0.54, 1000, 0.72],
        ["case", ["==", ["get", "networkTier"], "interconnector"], 1.2, 1],
      ],
      "line-opacity": ["case", ["==", ["get", "networkTier"], "local"], 0, 0.56],
      "line-blur": 0.25,
    },
  });

  map.addLayer({
    id: "custom-lines-glow",
    type: "line",
    source: "custom-layers",
    paint: {
      "line-color": ["get", "color"],
      "line-width": 2.6,
      "line-opacity": 0.1,
      "line-blur": 5,
    },
  });

  map.addLayer({
    id: "custom-lines-main",
    type: "line",
    source: "custom-layers",
    paint: {
      "line-color": ["get", "color"],
      "line-width": 0.9,
      "line-opacity": 0.58,
      "line-dasharray": [1.2, 1.3],
    },
  });

  map.addLayer({
    id: "china-transmission-preview-glow",
    type: "line",
    source: chinaTransmissionPreviewSourceId,
    minzoom: 1.4,
    paint: {
      "line-color": transmissionPreviewColor(),
      "line-width": transmissionPreviewLineWidth(true),
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 1.4, 0.14, 2.6, 0.22, 4, 0.32, 6, 0.44],
      "line-blur": 4.2,
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "china-transmission-preview-main",
    type: "line",
    source: chinaTransmissionPreviewSourceId,
    minzoom: 1.4,
    paint: {
      "line-color": transmissionPreviewColor(),
      "line-width": transmissionPreviewLineWidth(false),
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 1.4, 0.7, 2.6, 0.78, 4, 0.86, 6, 0.94],
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "china-transmission-detail-glow",
    type: "line",
    source: chinaTransmissionDetailSourceId,
    minzoom: chinaTransmissionDetailMinZoom,
    paint: {
      "line-color": transmissionPreviewColor(),
      "line-width": transmissionDetailLineWidth(true),
      "line-opacity": transmissionDetailOpacity(true),
      "line-blur": 3.2,
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "china-transmission-detail-main",
    type: "line",
    source: chinaTransmissionDetailSourceId,
    minzoom: chinaTransmissionDetailMinZoom,
    paint: {
      "line-color": transmissionPreviewColor(),
      "line-width": transmissionDetailLineWidth(false),
      "line-opacity": transmissionDetailOpacity(false),
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "oim-power-line-glow",
    type: "line",
    source: openInfraPowerSourceId,
    "source-layer": "power_line",
    minzoom: 3,
    paint: {
      "line-color": oimVoltageColor(),
      "line-width": oimLineWidth(true),
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.04, 4.5, 0.09, 6, 0.14],
      "line-blur": 4.5,
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "oim-power-line-main",
    type: "line",
    source: openInfraPowerSourceId,
    "source-layer": "power_line",
    minzoom: 3,
    paint: {
      "line-color": oimVoltageColor(),
      "line-width": oimLineWidth(false),
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.24, 4.5, 0.42, 6, 0.58],
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "oim-power-plant-point",
    type: "circle",
    source: openInfraPowerSourceId,
    "source-layer": "power_plant_point",
    minzoom: 4,
    paint: {
      "circle-color": "#facc15",
      "circle-radius": [
        "interpolate",
        ["linear"],
        oimNumber("output"),
        0,
        1.1,
        100,
        1.45,
        1000,
        2.35,
        5000,
        4.6,
      ] as ExpressionSpecification,
      "circle-opacity": 0.72,
      "circle-stroke-color": "rgba(3, 7, 18, 0.86)",
      "circle-stroke-width": 0.35,
      "circle-stroke-opacity": 0.72,
      "circle-blur": 0,
    },
  });

  map.addLayer({
    id: "oim-power-substation-point",
    type: "circle",
    source: openInfraPowerSourceId,
    "source-layer": "power_substation_point",
    minzoom: 5,
    paint: {
      "circle-color": "#f8fafc",
      "circle-radius": oimSubstationRadius(),
      "circle-opacity": 0.9,
      "circle-stroke-color": oimVoltageColor(),
      "circle-stroke-width": 1.2,
    },
  });

  map.addLayer({
    id: "ne-country-fill",
    type: "fill",
    source: "ne-countries",
    paint: {
      "fill-color": [
        "case",
        ["==", ["get", "ADM0_A3"], "CHN"],
        "#123a43",
        ["match", ["get", "MAPCOLOR9"], 1, "#101820", 2, "#121c24", 3, "#151b22", 4, "#102027", 5, "#151a25", 6, "#121f20", 7, "#151f2a", 8, "#111b24", 9, "#16202a", "#101720"],
      ],
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.32, 2.4, 0.38, 5.5, 0.22],
      "fill-outline-color": "rgba(255, 255, 255, 0.12)",
    },
  });

  map.addLayer({
    id: "carbon-emissions-heatmap",
    type: "heatmap",
    source: "carbon-emissions",
    paint: {
      "heatmap-weight": [
        "interpolate",
        ["linear"],
        ["get", "weight"],
        0,
        0,
        1,
        1,
      ],
      "heatmap-intensity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.72,
        3,
        1.1,
        7,
        1.55,
      ],
      "heatmap-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        5,
        2,
        9,
        5,
        17,
        8,
        26,
      ],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(9, 92, 82, 0)",
        0.12,
        "rgba(13, 148, 136, 0.2)",
        0.3,
        "rgba(16, 185, 129, 0.55)",
        0.5,
        "rgba(163, 230, 53, 0.72)",
        0.7,
        "rgba(250, 204, 21, 0.84)",
        0.86,
        "rgba(249, 115, 22, 0.92)",
        1,
        "rgba(248, 250, 252, 0.98)",
      ],
      "heatmap-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.88,
        6,
        0.94,
        10,
        0.82,
      ],
    },
    layout: {
      visibility: "none",
    },
  });

  map.addLayer({
    id: "generation-heat-fill",
    type: "fill",
    source: "ne-admin1-polygons",
    filter: ["==", ["get", "adm0_a3"], "CHN"],
    paint: {
      "fill-color": "rgba(0, 0, 0, 0)",
      "fill-opacity": 1,
      "fill-outline-color": "rgba(103, 232, 249, 0.22)",
    },
    layout: {
      visibility: "none",
    },
  });

  map.addLayer({
    id: "generation-heat-border",
    type: "line",
    source: "ne-admin1-polygons",
    filter: ["==", ["get", "adm0_a3"], "CHN"],
    paint: {
      "line-color": "rgba(226, 232, 240, 0.5)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2.4, 0.42, 5, 0.72, 7, 1.05],
      "line-opacity": 0.58,
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: "none",
    },
  });

  map.addLayer({
    id: "generation-heat-hover",
    type: "line",
    source: "ne-admin1-polygons",
    filter: ["==", ["get", "iso_3166_2"], ""],
    paint: {
      "line-color": "#f8fafc",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2.4, 1.2, 5, 1.9, 7, 2.5],
      "line-opacity": 0.94,
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: "none",
    },
  });

  map.addLayer({
    id: "ne-land-outline-glow",
    type: "line",
    source: "ne-countries",
    paint: {
      "line-color": "rgba(44, 53, 60, 0.9)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.6, 3, 2.1, 6, 3.1],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.28, 3.5, 0.24, 7, 0.16],
      "line-blur": 1.15,
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "ne-land-outline",
    type: "line",
    source: "ne-countries",
    paint: {
      "line-color": "rgba(255, 255, 255, 0.22)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.44, 4, 0.72, 8, 1.08],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.72, 3.5, 0.58, 7, 0.42],
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  });

  map.addLayer({
    id: "ne-country-border-glow",
    type: "line",
    source: "ne-country-lines",
    paint: {
      "line-color": "#2C353C",
      "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.4, 4, 2.4, 7, 3.6],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.38, 4, 0.42, 7, 0.28],
      "line-blur": 0.6,
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: "none",
    },
  });

  map.addLayer({
    id: "ne-country-borders",
    type: "line",
    source: "ne-country-lines",
    paint: {
      "line-color": ["interpolate", ["linear"], ["zoom"], 3, "rgba(92, 94, 94, 0.9)", 6, "rgba(102, 102, 102, 0.92)"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.58, 4, 0.88, 7, 1.28],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.82, 3.5, 0.72, 7, 0.62],
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: "none",
    },
  });

  map.addLayer({
    id: "carto-country-border-casing",
    type: "line",
    source: cartoBasemapSourceId,
    "source-layer": "boundary",
    minzoom: 6,
    filter: ["all", ["any", ["==", ["get", "admin_level"], 2], ["==", ["get", "admin_level"], "2"]], ["any", ["==", ["get", "maritime"], 0], ["==", ["get", "maritime"], "0"]]],
    paint: {
      "line-color": "#2C353C",
      "line-opacity": 1,
      "line-width": 8,
      "line-offset": 0,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "carto-country-border-inner",
    type: "line",
    source: cartoBasemapSourceId,
    "source-layer": "boundary",
    minzoom: 0,
    filter: ["all", ["any", ["==", ["get", "admin_level"], 2], ["==", ["get", "admin_level"], "2"]], ["any", ["==", ["get", "maritime"], 0], ["==", ["get", "maritime"], "0"]]],
    paint: {
      "line-color": ["interpolate", ["linear"], ["zoom"], 4, "rgba(92, 94, 94, 1)", 5, "rgba(96, 96, 96, 1)", 6, "rgba(102, 102, 102, 1)"],
      "line-opacity": 1,
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 6, 1.5],
      "line-offset": 0,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "carto-state-border-soft",
    type: "line",
    source: cartoBasemapSourceId,
    "source-layer": "boundary",
    filter: ["all", ["any", ["==", ["get", "admin_level"], 4], ["==", ["get", "admin_level"], "4"]], ["any", ["==", ["get", "maritime"], 0], ["==", ["get", "maritime"], "0"]]],
    paint: {
      "line-color": "rgba(255, 255, 255, 0.22)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.55, 4, 0.95, 8, 1.35],
      "line-opacity": 1,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "carto-state-border-main",
    type: "line",
    source: cartoBasemapSourceId,
    "source-layer": "boundary",
    minzoom: 4,
    filter: ["all", ["any", ["==", ["get", "admin_level"], 4], ["==", ["get", "admin_level"], "4"]], ["any", ["==", ["get", "maritime"], 0], ["==", ["get", "maritime"], "0"]]],
    paint: {
      "line-color": "rgba(103, 103, 114, 1)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 7, 1, 8, 1, 9, 1.2],
      "line-dasharray": [1, 2, 3],
      "line-opacity": 1,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "ne-country-labels",
    type: "symbol",
    source: "country-label-points",
    minzoom: 1,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        1,
        ["interpolate", ["linear"], ["get", "rank"], 1, 10.5, 4, 8.5, 7, 7],
        2.2,
        ["interpolate", ["linear"], ["get", "rank"], 1, 13, 4, 10.5, 7, 8.5],
        4.6,
        ["interpolate", ["linear"], ["get", "rank"], 1, 17, 4, 14, 7, 11],
      ],
      "text-max-width": 10,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": ["get", "rank"],
    },
    paint: {
      "text-color": "rgba(226, 232, 240, 0.78)",
      "text-halo-color": "rgba(2, 6, 23, 0.94)",
      "text-halo-width": 1.35,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.68, 2, 0.86, 5, 0.64],
    },
  });

  map.addLayer({
    id: "ne-admin1-borders",
    type: "line",
    source: "ne-admin1-lines",
    minzoom: 1.25,
    paint: {
      "line-color": "rgba(103, 103, 114, 0.66)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 1.25, 0.24, 4, 0.42, 7, 0.72],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 1.25, 0.24, 4.5, 0.4, 7, 0.34],
      "line-dasharray": [1, 2, 3],
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: "none",
    },
  });

  map.addLayer({
    id: "oim-region-borders",
    type: "line",
    source: openInfraBasemapSourceId,
    "source-layer": "boundaries",
    minzoom: 2.4,
    filter: ["all", ["==", ["get", "kind"], "region"], ["any", ["==", ["get", "kind_detail"], 4], ["==", ["get", "kind_detail"], "4"]]],
    paint: {
      "line-color": "rgba(103, 103, 114, 0.68)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 2.4, 0.32, 4.5, 0.5, 7, 0.86],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 2.4, 0.28, 5, 0.46, 7, 0.38],
      "line-dasharray": [1, 2, 3],
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: "none",
    },
  });

  map.addLayer({
    id: "oim-region-labels",
    type: "symbol",
    source: openInfraBasemapSourceId,
    "source-layer": "places",
    minzoom: 3.35,
    maxzoom: 7.4,
    filter: ["all", ["==", ["get", "kind"], "region"], ["==", ["get", "kind_detail"], "state"], ["==", ["get", "script"], "Han"]],
    layout: {
      "text-field": ["coalesce", ["get", "name:zh-Hans"], ["get", "name"], ["get", "name:en"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 3.35, 6.3, 5.2, 8.2, 7.4, 10],
      "text-max-width": 8,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": ["to-number", ["coalesce", ["get", "min_zoom"], 6]],
      visibility: "none",
    },
    paint: {
      "text-color": "rgba(241, 245, 249, 0.82)",
      "text-halo-color": "rgba(2, 6, 23, 0.9)",
      "text-halo-width": 1.35,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 3.35, 0.28, 4.6, 0.72, 7.4, 0.58],
    },
  });

  map.addLayer({
    id: "ne-admin1-labels",
    type: "symbol",
    source: "ne-admin1-polygons",
    minzoom: 2.7,
    layout: {
      "text-field": localizedAdminName(),
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 2.7, 6.4, 5, 8.2, 7, 10.2],
      "text-max-width": 8,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": ["to-number", ["coalesce", ["get", "labelrank"], 8]],
    },
    paint: {
      "text-color": ["case", ["==", ["get", "adm0_a3"], "CHN"], "#f8fafc", "rgba(226, 232, 240, 0.68)"],
      "text-halo-color": "rgba(5, 8, 18, 0.92)",
      "text-halo-width": 0.8,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 2.7, 0.22, 5, 0.54, 7, 0.68],
    },
  });

  map.addLayer({
    id: "energy-circles",
    type: "circle",
    source: "energy-assets",
    layout: {
      "circle-sort-key": ["*", -1, ["to-number", ["get", "capacityMw"], 0]],
    },
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": plantRadiusExpression(bubbleScale),
      "circle-opacity": 0.88,
      "circle-stroke-color": "rgba(2, 6, 23, 0.88)",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, 0.2, 3.6, 0.36, 5, 0.5],
      "circle-stroke-opacity": 0.76,
      "circle-blur": 0,
    },
  });

  map.addLayer({
    id: "energy-halo",
    type: "circle",
    source: "energy-assets",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": plantHaloRadiusExpression(bubbleScale),
      "circle-opacity": 0.035,
      "circle-blur": 0.42,
    },
  }, "energy-circles");

  map.addLayer({
    id: "data-center-symbols",
    type: "symbol",
    source: "data-centers",
    layout: {
      "icon-image": ["case", ["==", ["get", "kind"], "data-center"], "og-diamond-data", "og-diamond-ix"],
      "icon-size": dataCenterIconSizeExpression(),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": 0.92,
    },
  });

  map.addLayer({
    id: "substation-circles",
    type: "circle",
    source: "substations",
    paint: {
      "circle-color": "#e2e8f0",
      "circle-radius": ["case", ["==", ["get", "voltageClass"], "1000"], 4.2, ["==", ["get", "voltageClass"], "750"], 3.8, ["==", ["get", "voltageClass"], "500"], 3.4, ["==", ["get", "voltageClass"], "220"], 3.1, 2.6],
      "circle-opacity": 0.95,
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 1.2,
    },
  });

  map.addLayer({
    id: "substation-halo",
    type: "circle",
    source: "substations",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["case", ["==", ["get", "voltageClass"], "1000"], 7.5, ["==", ["get", "voltageClass"], "750"], 6.8, ["==", ["get", "voltageClass"], "500"], 6.1, ["==", ["get", "voltageClass"], "220"], 5.4, 4.2],
      "circle-opacity": 0.18,
      "circle-blur": 0.65,
    },
  }, "substation-circles");

  map.addLayer({
    id: "landing-point-symbols",
    type: "circle",
    source: "landing-points",
    paint: {
      "circle-color": "#67e8f9",
      "circle-radius": 3.5,
      "circle-opacity": 0.92,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 0.75,
    },
  });

  map.addLayer({
    id: "line-labels",
    type: "symbol",
    source: "grid-lines",
    minzoom: 4.4,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 9.6,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#c4b5fd",
      "text-halo-color": "rgba(8, 12, 24, 0.9)",
      "text-halo-width": 1.5,
      "text-opacity": 0.76,
    },
  });

  map.addLayer({
    id: "line-voltage-labels",
    type: "symbol",
    source: "grid-lines",
    filter: ["==", ["get", "kind"], "grid-line"],
    minzoom: 3.4,
    layout: {
      "symbol-placement": "line",
      "text-field": ["concat", ["to-string", ["get", "voltageKv"]], " kV"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 3, 7.2, 5, 9.8, 7, 13.5, 9, 17],
      "text-allow-overlap": true,
      "text-ignore-placement": false,
      "text-offset": [0, -0.7],
    },
    paint: {
      "text-color": ["get", "color"],
      "text-halo-color": "rgba(5, 8, 18, 0.92)",
      "text-halo-width": 2.6,
      "text-opacity": 0.86,
    },
  });

  map.addLayer({
    id: "energy-labels",
    type: "symbol",
    source: "energy-assets",
    minzoom: 3.1,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 9,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#e2e8f0",
      "text-halo-color": "rgba(8, 12, 24, 0.9)",
      "text-halo-width": 1.5,
      "text-opacity": 0.74,
    },
  });

  map.addLayer({
    id: "substation-labels",
    type: "symbol",
    source: "substations",
    minzoom: 3.6,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 8.5,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#cbd5e1",
      "text-halo-color": "rgba(8, 12, 24, 0.9)",
      "text-halo-width": 1.2,
      "text-opacity": 0.68,
    },
  });

  map.addLayer({
    id: "continent-labels",
    type: "symbol",
    source: "continent-label-points",
    minzoom: 1,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 1, 17, 3, 21, 5, 25],
      "text-letter-spacing": 0.06,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "rgba(226, 232, 240, 0.62)",
      "text-halo-color": "rgba(2, 6, 23, 0.94)",
      "text-halo-width": 2.6,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 3, 0.78, 6, 0.5],
    },
  });

  promoteLocalOsmTransmissionLayers(map);
}

function moveLayerBefore(map: Map, layerId: string, beforeId: string) {
  if (map.getLayer(layerId) && map.getLayer(beforeId)) {
    map.moveLayer(layerId, beforeId);
  }
}

function promoteLocalOsmTransmissionLayers(map: Map) {
  transmissionOverlayLayerIds.forEach((layerId) => {
    moveLayerBefore(map, layerId, "ne-land-outline-glow");
  });
}

function setLayerVisibility(map: Map, layerId: string, visible: boolean) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function getQueryableLayers(map: Map, layerIds: string[]) {
  if (!map.isStyleLoaded()) {
    return [];
  }

  return layerIds.filter((layerId) => Boolean(map.getLayer(layerId)));
}

const interactiveLayerPriority = [
  "energy-circles",
  "oim-power-plant-point",
  "data-center-symbols",
  "landing-point-symbols",
  "substation-circles",
  "oim-power-substation-point",
  "substation-halo",
  "grid-lines-main",
  "china-transmission-preview-main",
  "china-transmission-detail-main",
  "oim-power-line-main",
  "custom-lines-main",
];

function prioritizeInteractiveFeatures(features: MapGeoJSONFeature[]) {
  return [...features].sort((first, second) => {
    const firstPriority = interactiveLayerPriority.indexOf(first.layer.id);
    const secondPriority = interactiveLayerPriority.indexOf(second.layer.id);

    return (firstPriority === -1 ? interactiveLayerPriority.length : firstPriority)
      - (secondPriority === -1 ? interactiveLayerPriority.length : secondPriority);
  });
}

function queryInteractiveFeatures(
  map: Map,
  point: MapMouseEvent["point"],
  layerIds: string[],
  hitRadius = 0,
) {
  try {
    const directHits = map.queryRenderedFeatures(point, { layers: layerIds });

    if (directHits.length > 0 || hitRadius <= 0) {
      return prioritizeInteractiveFeatures(directHits);
    }

    return prioritizeInteractiveFeatures(map.queryRenderedFeatures([
      [point.x - hitRadius, point.y - hitRadius],
      [point.x + hitRadius, point.y + hitRadius],
    ], { layers: layerIds }));
  } catch {
    return [];
  }
}

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
};

type WeatherScreenField = {
  width: number;
  height: number;
  stride: number;
  cells: (WeatherScreenVector | null)[][];
  seeds: { x: number; y: number }[];
  valueAt: (x: number, y: number) => WeatherScreenVector | null;
  isDefined: (x: number, y: number) => boolean;
  randomize: (particle: WeatherParticle) => WeatherParticle;
};

function prepareWeatherCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const targetWidth = Math.floor(width * pixelRatio);
  const targetHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { context, width, height };
}

function clearWeatherCanvas(canvas: HTMLCanvasElement) {
  const prepared = prepareWeatherCanvas(canvas);
  if (!prepared) {
    return;
  }
  prepared.context.clearRect(0, 0, prepared.width, prepared.height);
}

function weatherGlobeClipCircle(map: Map, width: number, height: number) {
  const zoom = map.getZoom();
  if (zoom >= 3.1) {
    return null;
  }

  const center = map.project(map.getCenter());
  const radius = Math.min(Math.max(width, height), Math.min(width, height) * 0.54 * Math.pow(2, zoom - defaultRegion.zoom));
  return { x: center.x, y: center.y, radius: Math.max(120, radius) };
}

function isInsideWeatherGlobe(map: Map, width: number, height: number, x: number, y: number) {
  const clip = weatherGlobeClipCircle(map, width, height);
  if (!clip) {
    return true;
  }
  return Math.hypot(x - clip.x, y - clip.y) <= clip.radius;
}

function clipWeatherGlobe(map: Map, context: CanvasRenderingContext2D, width: number, height: number) {
  const clip = weatherGlobeClipCircle(map, width, height);
  if (!clip) {
    return;
  }

  context.beginPath();
  context.arc(clip.x, clip.y, clip.radius, 0, Math.PI * 2);
  context.clip();
}

function drawWeatherOverlayCanvas(
  map: Map,
  canvas: HTMLCanvasElement,
  activeProject: ProjectMode,
  field: WeatherField | null,
  metric: WeatherMetricKey,
  highDefinition: boolean,
) {
  const prepared = prepareWeatherCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  context.clearRect(0, 0, width, height);
  if (activeProject !== "weather" || !field) {
    return;
  }

  const step = highDefinition ? 4 : 7;
  context.save();
  clipWeatherGlobe(map, context, width, height);
  context.globalCompositeOperation = "screen";
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const lngLat = map.unproject([x + step / 2, y + step / 2]);
      const sample = sampleWeatherGrid(field, lngLat.lng, lngLat.lat);
      if (!sample) {
        continue;
      }
      context.fillStyle = weatherColor(metric, sample.value, metric === "wind" ? 0.34 : 0.48);
      context.fillRect(x, y, step + 1, step + 1);
    }
  }
  context.restore();
}

function carbonCanvasColor(value: number, scaleMax: number) {
  const [red, green, blue, alpha] = carbonColor(value, scaleMax, 0.82);
  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
}

function createWeatherScreenField(
  map: Map,
  width: number,
  height: number,
  field: WeatherField,
  highDefinition: boolean,
): WeatherScreenField | null {
  if (field.kind !== "vector") {
    return null;
  }

  const stride = highDefinition ? 3 : 5;
  const columns = Math.ceil(width / stride);
  const rows = Math.ceil(height / stride);
  const cells: (WeatherScreenVector | null)[][] = Array.from({ length: columns }, () => Array(rows).fill(null));
  const seeds: { x: number; y: number }[] = [];

  for (let column = 0; column < columns; column += 1) {
    const x = Math.min(width - 1, column * stride + stride / 2);
    for (let row = 0; row < rows; row += 1) {
      const y = Math.min(height - 1, row * stride + stride / 2);
      if (!isInsideWeatherGlobe(map, width, height, x, y)) {
        continue;
      }
      const vector = projectWeatherWindVector(map, field, x, y);
      cells[column][row] = vector;
      if (vector) {
        seeds.push({ x, y });
      }
    }
  }

  const valueAt = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return null;
    }
    const column = Math.max(0, Math.min(columns - 1, Math.floor(x / stride)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(y / stride)));
    return cells[column]?.[row] ?? null;
  };

  const screenField: WeatherScreenField = {
    width,
    height,
    stride,
    cells,
    seeds,
    valueAt,
    isDefined: (x, y) => valueAt(x, y) !== null,
    randomize: (particle) => {
      if (seeds.length === 0) {
        particle.x = width / 2;
        particle.y = height / 2;
        particle.age = 120;
        return particle;
      }

      const seed = seeds[Math.floor(Math.random() * seeds.length)];
      particle.x = Math.max(0, Math.min(width - 1, seed.x + (Math.random() - 0.5) * stride));
      particle.y = Math.max(0, Math.min(height - 1, seed.y + (Math.random() - 0.5) * stride));
      particle.xt = undefined;
      particle.yt = undefined;
      particle.age = Math.floor(Math.random() * 90);
      return particle;
    },
  };

  return screenField;
}

function projectWeatherWindVector(
  map: Map,
  field: WeatherField,
  x: number,
  y: number,
): WeatherScreenVector | null {
  const lngLat = map.unproject([x, y]);
  if (!Number.isFinite(lngLat.lng) || !Number.isFinite(lngLat.lat) || Math.abs(lngLat.lat) > 86) {
    return null;
  }

  const sample = sampleWeatherGrid(field, lngLat.lng, lngLat.lat);
  const vectorSample = sample as { value?: number; u?: number; v?: number } | null;
  if (!vectorSample || typeof vectorSample.u !== "number" || typeof vectorSample.v !== "number") {
    return null;
  }

  const base = map.project([lngLat.lng, lngLat.lat]);
  if (!Number.isFinite(base.x) || !Number.isFinite(base.y)) {
    return null;
  }

  const cosLat = Math.max(0.16, Math.cos((lngLat.lat * Math.PI) / 180));
  const degreesPerUnit = 0.035;
  const targetLng = wrapWeatherLongitude(lngLat.lng + (vectorSample.u * degreesPerUnit) / cosLat);
  const targetLat = Math.max(-86, Math.min(86, lngLat.lat + vectorSample.v * degreesPerUnit));
  const target = map.project([targetLng, targetLat]);
  const rawDx = target.x - base.x;
  const rawDy = target.y - base.y;
  const rawLength = Math.hypot(rawDx, rawDy);
  if (!Number.isFinite(rawLength) || rawLength < 0.01 || rawLength > 80) {
    return null;
  }

  const magnitude = Math.max(0, vectorSample.value ?? Math.hypot(vectorSample.u, vectorSample.v));
  const cappedLength = Math.max(0.28, Math.min(7.2, rawLength));
  const scale = cappedLength / rawLength;
  return {
    dx: rawDx * scale,
    dy: rawDy * scale,
    magnitude,
  };
}

function wrapWeatherLongitude(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function buildWeatherParticles(field: WeatherScreenField, count: number) {
  return Array.from({ length: count }, () => field.randomize({
    x: 0,
    y: 0,
    age: Math.floor(Math.random() * 90),
  }));
}

function animateWeatherParticles(
  map: Map,
  canvas: HTMLCanvasElement,
  particles: WeatherParticle[],
  field: WeatherScreenField,
) {
  const prepared = prepareWeatherCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  if (field.width !== width || field.height !== height || field.seeds.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = "rgba(0, 0, 0, 0.9)";
  context.fillRect(0, 0, width, height);
  context.restore();

  const buckets: WeatherParticle[][] = [[], [], [], []];
  context.save();
  clipWeatherGlobe(map, context, width, height);
  context.globalCompositeOperation = "lighter";
  context.lineWidth = 1.15;

  particles.forEach((particle) => {
    if (particle.age > 110 || !field.isDefined(particle.x, particle.y)) {
      field.randomize(particle).age = 0;
    }

    const vector = field.valueAt(particle.x, particle.y);
    if (!vector) {
      particle.age = 111;
      return;
    }

    const nextX = particle.x + vector.dx;
    const nextY = particle.y + vector.dy;
    if (field.isDefined(nextX, nextY)) {
      particle.xt = nextX;
      particle.yt = nextY;
      const bucketIndex = Math.max(0, Math.min(buckets.length - 1, Math.floor(vector.magnitude / 9)));
      buckets[bucketIndex].push(particle);
    } else {
      particle.x = nextX;
      particle.y = nextY;
    }
    particle.age += 1;
  });

  const strokes = [
    "rgba(103, 232, 249, 0.26)",
    "rgba(165, 243, 252, 0.38)",
    "rgba(224, 242, 254, 0.54)",
    "rgba(255, 255, 255, 0.72)",
  ];

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

function EarthProjectViewport({ onLoad }: { onLoad: (document: Document | null) => void }) {
  return (
    <section className="og-earth-project" aria-label="earth 原版气象项目">
      <iframe
        title="earth 原版气象可视化"
        src="/earth/index.html?workspace"
        className="og-earth-project-frame"
        loading="eager"
        onLoad={(event) => onLoad(event.currentTarget.contentDocument)}
      />
    </section>
  );
}

function MapViewport({
  activeProject,
  visibleTechnologies,
  visibleLayers,
  visibleCustomLayers,
  visibleSourceLayers,
  visibleVoltageClasses,
  visibleSubstationClasses,
  activeSizeMin,
  dataVersion,
  activeMapTheme,
  bubbleScale: currentBubbleScale,
  hoveredLegend,
  labelSettings,
  generationHeatmapActive,
  generationHeatmapData,
  generationFrame,
  weatherMetric,
  weatherField,
  weatherWindField,
  weatherParticlesEnabled,
  weatherHighDefinition,
  carbonFrame,
  focusRequest,
  screenshotRequest,
  cinematic,
  onSelectFeature,
  onHoverTooltip,
  onRegionHover,
  onCameraChange,
  onScreenshotComplete,
}: {
  activeProject: ProjectMode;
  visibleTechnologies: BooleanRecord<TechnologyKey>;
  visibleLayers: BooleanRecord<LayerKey>;
  visibleCustomLayers: BooleanRecord<CustomLayerKey>;
  visibleSourceLayers: BooleanRecord<SourceLayerKey>;
  visibleVoltageClasses: BooleanRecord<VoltageClass>;
  visibleSubstationClasses: BooleanRecord<VoltageClass>;
  activeSizeMin: number | null;
  dataVersion: number;
  activeMapTheme: MapThemeKey;
  bubbleScale: number;
  hoveredLegend: LegendHover | null;
  labelSettings: LabelSettings;
  generationHeatmapActive: boolean;
  generationHeatmapData: GenerationHeatmapData | null;
  generationFrame: GenerationFrame;
  weatherMetric: WeatherMetricKey;
  weatherField: WeatherField | null;
  weatherWindField: WeatherField | null;
  weatherParticlesEnabled: boolean;
  weatherHighDefinition: boolean;
  carbonFrame: CarbonFrame | null;
  focusRequest: FocusRequest | null;
  screenshotRequest: number;
  cinematic: boolean;
  onSelectFeature: (feature: SelectedFeature) => void;
  onHoverTooltip: (tooltip: HoverTooltip) => void;
  onRegionHover: (regionId: RegionTargetId) => void;
  onCameraChange: (camera: MapCameraState) => void;
  onScreenshotComplete: (message: string) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const weatherOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const weatherParticlesRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const selectRef = useRef(onSelectFeature);
  const hoverRef = useRef(onHoverTooltip);
  const regionHoverRef = useRef(onRegionHover);
  const cameraRef = useRef(onCameraChange);
  const screenshotRef = useRef(onScreenshotComplete);
  const basemapFallbackRef = useRef(false);
  const generationActiveRef = useRef(generationHeatmapActive);
  const generationDataRef = useRef(generationHeatmapData);
  const generationFrameRef = useRef(generationFrame);
  const activeProjectRef = useRef(activeProject);
  const weatherMetricRef = useRef(weatherMetric);
  const weatherFieldRef = useRef(weatherField);
  const carbonFrameRef = useRef(carbonFrame);
  const chinaTransmissionPreviewLoadedRef = useRef(false);
  const chinaTransmissionDetailLoadedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(defaultRegion.zoom);
  const [orbitPositions, setOrbitPositions] = useState<Record<string, { left: number; top: number; visible: boolean; cardSide: "left" | "right" }>>({});

  useEffect(() => {
    selectRef.current = onSelectFeature;
    hoverRef.current = onHoverTooltip;
    regionHoverRef.current = onRegionHover;
    cameraRef.current = onCameraChange;
    screenshotRef.current = onScreenshotComplete;
    generationActiveRef.current = generationHeatmapActive;
    generationDataRef.current = generationHeatmapData;
    generationFrameRef.current = generationFrame;
    activeProjectRef.current = activeProject;
    weatherMetricRef.current = weatherMetric;
    weatherFieldRef.current = weatherField;
    carbonFrameRef.current = carbonFrame;
  }, [activeProject, carbonFrame, generationFrame, generationHeatmapActive, generationHeatmapData, onCameraChange, onHoverTooltip, onRegionHover, onScreenshotComplete, onSelectFeature, weatherField, weatherMetric]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: baseMapStyle,
      center: defaultRegion.center,
      zoom: defaultRegion.zoom,
      pitch: defaultRegion.pitch,
      bearing: defaultRegion.bearing,
      attributionControl: false,
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
      },
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), "bottom-right");

    const applyViewportPadding = () => {
      map.setPadding({
        top: 0,
        right: 0,
        bottom: 0,
        left: window.innerWidth >= 900 ? 360 : 0,
      });
    };

    const interactiveLayerIds = [
      "energy-circles",
      "data-center-symbols",
      "grid-lines-main",
      "china-transmission-preview-main",
      "china-transmission-detail-main",
      "custom-lines-main",
      "oim-power-line-main",
      "oim-power-plant-point",
      "oim-power-substation-point",
      "substation-circles",
      "substation-halo",
      "landing-point-symbols",
    ];

    map.on("load", () => {
      map.setProjection({ type: "globe" });
      applyViewportPadding();
      map.setSky({
        "sky-color": "#101821",
        "horizon-color": "#1e293b",
        "fog-color": "#0f172a",
        "atmosphere-blend": 0.28,
      });
      applyMapTheme(map, defaultMapTheme);
      addInteractiveLayers(map);
      initiallyHiddenBusinessLayerIds.forEach((layerId) => setLayerVisibility(map, layerId, false));
      window.requestAnimationFrame(() => map.resize());
      setReady(true);
      cameraRef.current({
        center: [map.getCenter().lng, map.getCenter().lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    });

    const handleMouseMove = (event: MapMouseEvent) => {
      regionHoverRef.current(getRegionForCoordinates(event.lngLat.lng, event.lngLat.lat).id);
      if (activeProjectRef.current === "carbon") {
        const activeCarbonFrame = carbonFrameRef.current;
        const value = activeCarbonFrame
          ? sampleCarbonFrame(activeCarbonFrame, event.lngLat.lng, event.lngLat.lat)
          : 0;
        if (activeCarbonFrame && value > 0) {
          map.getCanvas().style.cursor = "crosshair";
          hoverRef.current({
            x: event.point.x,
            y: event.point.y,
            title: `${carbonSectorLabels[activeCarbonFrame.sector] ?? activeCarbonFrame.sector}排放`,
            subtitle: `${formatCarbonValue(value)} · ${activeCarbonFrame.date}`,
            color: carbonCanvasColor(value, Math.max(activeCarbonFrame.stats.p99, 1)),
          });
        } else {
          map.getCanvas().style.cursor = "";
          hoverRef.current(null);
        }
        return;
      }
      if (activeProjectRef.current === "weather") {
        const field = weatherFieldRef.current;
        const metric = weatherMetricRef.current;
        const sample = field ? sampleWeatherGrid(field, event.lngLat.lng, event.lngLat.lat) : null;
        if (sample && field) {
          const meta = weatherMetricMeta(metric);
          map.getCanvas().style.cursor = "crosshair";
          hoverRef.current({
            x: event.point.x,
            y: event.point.y,
            title: meta.label,
            subtitle: `${formatWeatherValue(metric, sample.value)} · ${formatWeatherTime(field?.validTimeUtc)}`,
            color: weatherColor(metric, sample.value, 0.9),
          });
        } else {
          map.getCanvas().style.cursor = "";
          hoverRef.current(null);
        }
        return;
      }
      if (generationActiveRef.current) {
        const heatFeatures = getQueryableLayers(map, ["generation-heat-fill"]).length > 0
          ? map.queryRenderedFeatures(event.point, { layers: ["generation-heat-fill"] })
          : [];
        const heatFeature = heatFeatures[0];
        const isoCode = heatFeature?.properties ? readString(heatFeature.properties as Record<string, unknown>, "iso_3166_2") : "";
        const heatEntry = generationDataRef.current?.entries.find((entry) => entry.isoCode === isoCode);

        if (heatEntry) {
          map.getCanvas().style.cursor = "pointer";
          map.setFilter("generation-heat-hover", ["==", ["get", "iso_3166_2"], isoCode]);
          hoverRef.current({
            x: event.point.x,
            y: event.point.y,
            title: `${heatEntry.label}发电量`,
            subtitle: generationFrameSubtitle(heatEntry, generationFrameRef.current),
            color: generationHeatColor(heatEntry.normalized),
          });
          return;
        }

        if (map.getLayer("generation-heat-hover")) {
          map.setFilter("generation-heat-hover", ["==", ["get", "iso_3166_2"], ""]);
        }
      }

      const queryableLayers = getQueryableLayers(map, interactiveLayerIds);

      if (queryableLayers.length === 0) {
        map.getCanvas().style.cursor = "";
        hoverRef.current(null);
        return;
      }

      const features = queryInteractiveFeatures(map, event.point, queryableLayers, 6);
      const feature = features[0];

      if (!feature) {
        map.getCanvas().style.cursor = "";
        hoverRef.current(null);
        return;
      }

      const selected = featureToSelected(feature, [event.lngLat.lng, event.lngLat.lat]);
      map.getCanvas().style.cursor = "pointer";
      hoverRef.current({
        x: event.point.x,
        y: event.point.y,
        title: selected.title,
        subtitle: selected.subtitle,
        color: selected.color,
      });
    };

    const handleClick = (event: MapMouseEvent) => {
      if (activeProjectRef.current === "carbon") {
        const activeCarbonFrame = carbonFrameRef.current;
        const value = activeCarbonFrame
          ? sampleCarbonFrame(activeCarbonFrame, event.lngLat.lng, event.lngLat.lat)
          : 0;
        if (activeCarbonFrame && value > 0) {
          selectRef.current({
            id: `carbon-${activeCarbonFrame.sector}-${activeCarbonFrame.date}-${event.lngLat.lng.toFixed(2)}-${event.lngLat.lat.toFixed(2)}`,
            kind: "carbon",
            title: `${carbonSectorLabels[activeCarbonFrame.sector] ?? activeCarbonFrame.sector}排放`,
            subtitle: `${formatCarbonValue(value)} · ${activeCarbonFrame.date}`,
            coordinates: [event.lngLat.lng, event.lngLat.lat],
            color: carbonCanvasColor(value, Math.max(activeCarbonFrame.stats.p99, 1)),
            rows: [
              { label: "日期", value: activeCarbonFrame.date },
              { label: "部门", value: carbonSectorLabels[activeCarbonFrame.sector] ?? activeCarbonFrame.sector },
              { label: "网格排放", value: formatCarbonValue(value) },
              { label: "经纬度", value: `${event.lngLat.lat.toFixed(2)}°, ${event.lngLat.lng.toFixed(2)}°` },
              { label: "空间分辨率", value: "0.1° × 0.1°" },
            ],
            source: "GRACED / Carbon Monitor",
          });
        }
        return;
      }
      if (activeProjectRef.current === "weather") {
        const field = weatherFieldRef.current;
        const metric = weatherMetricRef.current;
        const sample = field ? sampleWeatherGrid(field, event.lngLat.lng, event.lngLat.lat) : null;
        if (sample && field) {
          const meta = weatherMetricMeta(metric);
          selectRef.current({
            id: `weather-${metric}-${event.lngLat.lng.toFixed(2)}-${event.lngLat.lat.toFixed(2)}`,
            kind: "weather",
            title: meta.label,
            subtitle: `${formatWeatherValue(metric, sample.value)} · ${formatWeatherTime(field.validTimeUtc)}`,
            coordinates: [event.lngLat.lng, event.lngLat.lat],
            color: weatherColor(metric, sample.value, 0.9),
            rows: [
              { label: "模式", value: "大气" },
              { label: "高度", value: "地表" },
              { label: "覆盖", value: meta.label },
              { label: "数值", value: formatWeatherValue(metric, sample.value) },
              { label: "有效时间", value: formatWeatherTime(field.validTimeUtc) },
            ],
            source: field.source,
          });
        }
        return;
      }
      if (generationActiveRef.current) {
        const heatFeatures = getQueryableLayers(map, ["generation-heat-fill"]).length > 0
          ? map.queryRenderedFeatures(event.point, { layers: ["generation-heat-fill"] })
          : [];
        const heatFeature = heatFeatures[0];
        const isoCode = heatFeature?.properties ? readString(heatFeature.properties as Record<string, unknown>, "iso_3166_2") : "";
        const heatEntry = generationDataRef.current?.entries.find((entry) => entry.isoCode === isoCode);

        if (heatEntry) {
          selectRef.current(generationFeatureFromEntry(heatEntry, generationFrameRef.current, [event.lngLat.lng, event.lngLat.lat]));
          return;
        }
      }

      const queryableLayers = getQueryableLayers(map, interactiveLayerIds);

      if (queryableLayers.length === 0) {
        return;
      }

      const features = queryInteractiveFeatures(map, event.point, queryableLayers, 12);
      const feature = features[0];

      if (feature) {
        selectRef.current(featureToSelected(feature, [event.lngLat.lng, event.lngLat.lat]));
      }
    };

    const handleMoveEnd = () => {
      const zoom = map.getZoom();
      setMapZoom(zoom);
      cameraRef.current({
        center: [map.getCenter().lng, map.getCenter().lat],
        zoom,
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    };

    const handleMapError = (event: { error?: Error }) => {
      const message = event.error?.message ?? "";
      if (basemapFallbackRef.current || !/gibs\.earthdata\.nasa\.gov|VIIRS_CityLights/i.test(message)) {
        return;
      }

      const fallbackTheme = mapThemes.find((theme) => theme.key === "cartoDark");
      if (fallbackTheme) {
        basemapFallbackRef.current = true;
        applyMapTheme(map, fallbackTheme);
      }
    };

    map.on("mousemove", handleMouseMove);
    map.on("click", handleClick);
    map.on("moveend", handleMoveEnd);
    map.on("error", handleMapError);
    window.addEventListener("resize", applyViewportPadding);
    map.on("mouseleave", () => {
      if (map.getLayer("generation-heat-hover")) {
        map.setFilter("generation-heat-hover", ["==", ["get", "iso_3166_2"], ""]);
      }
      hoverRef.current(null);
      regionHoverRef.current("global");
    });

    return () => {
      window.removeEventListener("resize", applyViewportPadding);
      map.off("error", handleMapError);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    getGeoJsonSource(map, "energy-assets")?.setData(buildEnergyCollection(visibleTechnologies, activeSizeMin));
    getGeoJsonSource(map, "data-centers")?.setData(buildDataCenterCollection(visibleLayers));
    getGeoJsonSource(map, "grid-lines")?.setData(
      buildGridLineCollection(visibleLayers, visibleSourceLayers, visibleVoltageClasses),
    );
    getGeoJsonSource(map, "custom-layers")?.setData(buildCustomLayerCollection(visibleCustomLayers));
    getGeoJsonSource(map, "substations")?.setData(
      buildSubstationCollection(visibleLayers, visibleSourceLayers, visibleSubstationClasses),
    );
    getGeoJsonSource(map, "landing-points")?.setData(buildLandingPointCollection(visibleLayers));
  }, [
    activeSizeMin,
    dataVersion,
    ready,
    visibleCustomLayers,
    visibleLayers,
    visibleSourceLayers,
    visibleSubstationClasses,
    visibleTechnologies,
    visibleVoltageClasses,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    const heatmapVisible = activeProject === "carbon" && Boolean(carbonFrame);
    getGeoJsonSource(map, "carbon-emissions")?.setData(
      carbonFrame ? buildCarbonHeatCollection(carbonFrame) : emptyPointCollection(),
    );
    setLayerVisibility(map, "carbon-emissions-heatmap", heatmapVisible);
  }, [activeProject, carbonFrame, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    const heatmapVisible = generationHeatmapActive && Boolean(generationHeatmapData?.entries.length);
    setLayerVisibility(map, "generation-heat-fill", heatmapVisible);
    setLayerVisibility(map, "generation-heat-border", heatmapVisible);
    setLayerVisibility(map, "generation-heat-hover", heatmapVisible);
    map.setPaintProperty("generation-heat-fill", "fill-color", generationHeatColorExpression(generationHeatmapData));
  }, [generationHeatmapActive, generationHeatmapData, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    if (visibleLayers.transmission && !chinaTransmissionPreviewLoadedRef.current) {
      getGeoJsonSource(map, chinaTransmissionPreviewSourceId)?.setData(chinaTransmissionPreviewUrl);
      chinaTransmissionPreviewLoadedRef.current = true;
    }

    if (
      visibleLayers.transmission &&
      !chinaTransmissionDetailLoadedRef.current &&
      map.getZoom() >= chinaTransmissionDetailMinZoom
    ) {
      getGeoJsonSource(map, chinaTransmissionDetailSourceId)?.setData(chinaTransmissionDetailUrl);
      chinaTransmissionDetailLoadedRef.current = true;
    }

    transmissionOverlayLayerIds.forEach((layerId) => {
      setLayerVisibility(map, layerId, visibleLayers.transmission);
    });
    localOsmSubstationLayerIds.forEach((layerId) => {
      setLayerVisibility(map, layerId, visibleLayers.substations);
    });
    localOsmAssetLayerIds.forEach((layerId) => {
      setLayerVisibility(map, layerId, visibleLayers.openInfraPower);
    });
  }, [mapZoom, ready, visibleLayers.openInfraPower, visibleLayers.substations, visibleLayers.transmission]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    const lineFilter = voltageClassFilter(visibleVoltageClasses);
    const substationFilter = voltageClassFilter(visibleSubstationClasses);
    map.setFilter("china-transmission-preview-glow", lineFilter);
    map.setFilter("china-transmission-preview-main", lineFilter);
    map.setFilter("china-transmission-detail-glow", lineFilter);
    map.setFilter("china-transmission-detail-main", lineFilter);
    map.setFilter("oim-power-line-glow", lineFilter);
    map.setFilter("oim-power-line-main", lineFilter);
    map.setFilter("oim-power-substation-point", substationFilter);
  }, [ready, visibleSubstationClasses, visibleVoltageClasses]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    const theme = mapThemes.find((item) => item.key === activeMapTheme) ?? defaultMapTheme;
    applyMapTheme(map, theme);
  }, [activeMapTheme, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    map.setPaintProperty("energy-circles", "circle-radius", plantRadiusExpression(currentBubbleScale));
    map.setPaintProperty("energy-halo", "circle-radius", plantHaloRadiusExpression(currentBubbleScale));
  }, [currentBubbleScale, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    const technologyHover = hoveredLegend?.kind === "technology" ? hoveredLegend.key : null;
    const sizeHover = hoveredLegend?.kind === "size" ? hoveredLegend.minMw : null;
    const layerHover = hoveredLegend?.kind === "layer" ? hoveredLegend.key : null;
    const voltageHover = hoveredLegend?.kind === "voltage" ? hoveredLegend.key : null;
    const substationHover = hoveredLegend?.kind === "substation" ? hoveredLegend.key : null;

    map.setPaintProperty(
      "energy-circles",
      "circle-opacity",
      technologyHover
        ? ["case", ["==", ["get", "technology"], technologyHover], 0.98, 0.14]
        : sizeHover
          ? ["case", [">=", ["get", "capacityMw"], sizeHover], 0.98, 0.12]
          : layerHover
            ? 0.18
            : 0.86,
    );
    map.setPaintProperty("energy-halo", "circle-opacity", technologyHover || sizeHover ? 0.08 : 0.035);
    map.setPaintProperty(
      "grid-lines-main",
      "line-opacity",
      voltageHover
        ? ["case", ["==", ["get", "voltageClass"], voltageHover], 0.95, 0.12]
        : layerHover === "transmission" || layerHover === "plannedUpgrades" || layerHover === "gasPipelines" || layerHover === "submarineCables" || layerHover === "fiber"
          ? 0.95
          : technologyHover || substationHover
            ? 0.18
            : 0.78,
    );
    map.setPaintProperty(
      "grid-lines-highlight",
      "line-opacity",
      voltageHover
        ? ["case", ["==", ["get", "voltageClass"], voltageHover], 0.9, 0.04]
        : layerHover === "transmission"
          ? 0.96
          : layerHover || technologyHover || sizeHover || substationHover
            ? 0.1
            : 0.86,
    );
    map.setPaintProperty(
      "substation-circles",
      "circle-opacity",
      substationHover ? ["case", ["==", ["get", "voltageClass"], substationHover], 1, 0.12] : layerHover === "substations" ? 1 : 0.95,
    );
    map.setPaintProperty(
      "substation-halo",
      "circle-opacity",
      substationHover ? ["case", ["==", ["get", "voltageClass"], substationHover], 0.34, 0.04] : layerHover === "substations" ? 0.34 : 0.22,
    );
    map.setPaintProperty(
      "data-center-symbols",
      "icon-opacity",
      layerHover === "dataCenters" || layerHover === "internetExchanges" || layerHover === "fiber" ? 1 : technologyHover || voltageHover ? 0.28 : 0.92,
    );
    map.setPaintProperty(
      "custom-lines-main",
      "line-opacity",
      layerHover === "plannedUpgrades" || layerHover === "fiber" ? 0.98 : 0.86,
    );
    map.setPaintProperty(
      "oim-power-line-main",
      "line-opacity",
      voltageHover
        ? ["case", ["==", oimVoltageClass(), voltageHover], 0.82, 0.06]
        : layerHover === "transmission"
          ? 0.72
          : layerHover || technologyHover || sizeHover || substationHover
            ? 0.12
            : 0.58,
    );
    map.setPaintProperty(
      "oim-power-line-glow",
      "line-opacity",
      voltageHover
        ? ["case", ["==", oimVoltageClass(), voltageHover], 0.24, 0.02]
        : layerHover === "transmission"
          ? 0.16
          : layerHover || technologyHover || sizeHover || substationHover
            ? 0.025
            : 0.12,
    );
    map.setPaintProperty(
      "oim-power-plant-point",
      "circle-opacity",
      layerHover === "openInfraPower" ? 0.96 : layerHover || voltageHover || substationHover ? 0.22 : 0.78,
    );
    map.setPaintProperty(
      "oim-power-substation-point",
      "circle-opacity",
      layerHover === "openInfraPower" ? 0.96 : layerHover || technologyHover || sizeHover ? 0.22 : 0.82,
    );
  }, [hoveredLegend, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    const lineColor = labelSettings.colorByLineType ? ["get", "color"] : "#67e8f9";
    map.setPaintProperty("grid-lines-main", "line-color", lineColor);
    map.setPaintProperty("grid-lines-glow", "line-color", lineColor);
    map.setPaintProperty("grid-lines-highlight", "line-color", labelSettings.colorByLineType ? ["case", [">=", ["get", "voltageKv"], 735], "#ffffff", "#67e8f9"] : "#f8fafc");
    map.setLayoutProperty("line-labels", "text-size", labelSettings.lineLabelSize / 10);
    map.setPaintProperty("line-labels", "text-halo-width", labelSettings.enhancedVisibility ? 2.2 : 1.15);
    map.setPaintProperty("line-labels", "text-opacity", labelSettings.showLabels && !labelSettings.linesOnly ? 0.68 : 0.78);
    map.setPaintProperty("line-voltage-labels", "text-halo-width", labelSettings.enhancedVisibility ? 2.6 : 1.9);
    map.setPaintProperty("line-voltage-labels", "text-opacity", labelSettings.showLabels ? 0.76 : 0);
    map.setLayoutProperty("energy-labels", "text-size", labelSettings.bigLabels ? 11.5 : 9);
    map.setPaintProperty("energy-labels", "text-halo-width", labelSettings.enhancedVisibility ? 2.2 : 1.15);
    map.setLayoutProperty("substation-labels", "text-size", labelSettings.bigLabels ? 10.4 : 8.5);
    map.setPaintProperty("substation-labels", "text-halo-width", labelSettings.enhancedVisibility ? 2 : 1);

    setLayerVisibility(map, "energy-labels", labelSettings.showLabels && !labelSettings.linesOnly);
    setLayerVisibility(map, "substation-labels", labelSettings.showLabels && labelSettings.substationLabels && !labelSettings.linesOnly);
    setLayerVisibility(map, "line-labels", labelSettings.showLabels);
    setLayerVisibility(map, "line-voltage-labels", labelSettings.showLabels);
    setLayerVisibility(map, "ne-country-fill", labelSettings.countryBorders);
    setLayerVisibility(map, "ne-land-outline-glow", labelSettings.countryBorders);
    setLayerVisibility(map, "ne-land-outline", labelSettings.countryBorders);
    setLayerVisibility(map, "ne-country-border-glow", false);
    setLayerVisibility(map, "ne-country-borders", false);
    setLayerVisibility(map, "carto-country-border-casing", labelSettings.countryBorders);
    setLayerVisibility(map, "carto-country-border-inner", labelSettings.countryBorders);
    setLayerVisibility(map, "carto-state-border-soft", labelSettings.stateBorders);
    setLayerVisibility(map, "carto-state-border-main", labelSettings.stateBorders);
    setLayerVisibility(map, "ne-country-labels", labelSettings.showLabels && labelSettings.basemapTextLabels && labelSettings.countryBorders);
    setLayerVisibility(map, "continent-labels", labelSettings.showLabels && labelSettings.basemapTextLabels && labelSettings.countryBorders);
    setLayerVisibility(map, "ne-admin1-borders", false);
    setLayerVisibility(map, "oim-region-borders", false);
    setLayerVisibility(map, "oim-region-labels", false);
    setLayerVisibility(map, "ne-admin1-labels", labelSettings.showLabels && labelSettings.provinceLabels && !labelSettings.linesOnly);
    map.setPaintProperty("ne-admin1-labels", "text-halo-width", labelSettings.enhancedVisibility ? 1.35 : 0.8);
    map.setLayoutProperty(
      "ne-admin1-labels",
      "text-size",
      labelSettings.bigLabels
        ? ["interpolate", ["linear"], ["zoom"], 2.7, 7.4, 5, 9.6, 7, 12]
        : ["interpolate", ["linear"], ["zoom"], 2.7, 6.4, 5, 8.2, 7, 10.2],
    );
  }, [labelSettings, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusRequest) {
      return;
    }

    map.flyTo({
      center: focusRequest.center,
      zoom: focusRequest.zoom,
      pitch: focusRequest.pitch ?? 35,
      bearing: focusRequest.bearing ?? map.getBearing(),
      speed: 0.65,
      curve: 1.35,
      essential: true,
    });
  }, [focusRequest, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || cinematic) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const canvas = map.getCanvas();
    let pointerIsDown = false;
    let wheelResumeTimer = 0;

    const spinGlobe = () => {
      if (pointerIsDown || wheelResumeTimer || map.isMoving() || map.getZoom() > globeSpinMaxZoom) {
        return;
      }

      const center = map.getCenter();
      map.easeTo({
        center: [center.lng - (360 / globeSpinSecondsPerCycle), center.lat],
        duration: globeSpinStepDurationMs,
        easing: (progress) => progress,
        essential: false,
      });
    };

    const pauseForPointer = () => {
      pointerIsDown = true;
      map.stop();
    };

    const resumeAfterPointer = () => {
      pointerIsDown = false;
      spinGlobe();
    };

    const pauseForWheel = () => {
      window.clearTimeout(wheelResumeTimer);
      wheelResumeTimer = window.setTimeout(() => {
        wheelResumeTimer = 0;
        spinGlobe();
      }, globeSpinStepDurationMs);
    };

    canvas.addEventListener("pointerdown", pauseForPointer);
    canvas.addEventListener("wheel", pauseForWheel, { passive: true });
    window.addEventListener("pointerup", resumeAfterPointer);
    window.addEventListener("pointercancel", resumeAfterPointer);
    map.on("moveend", spinGlobe);
    spinGlobe();

    return () => {
      canvas.removeEventListener("pointerdown", pauseForPointer);
      canvas.removeEventListener("wheel", pauseForWheel);
      window.removeEventListener("pointerup", resumeAfterPointer);
      window.removeEventListener("pointercancel", resumeAfterPointer);
      map.off("moveend", spinGlobe);
      window.clearTimeout(wheelResumeTimer);
      map.stop();
    };
  }, [cinematic, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = weatherOverlayRef.current;
    if (!map || !ready || !canvas) {
      return;
    }

    const draw = () => {
      drawWeatherOverlayCanvas(map, canvas, activeProject, weatherField, weatherMetric, weatherHighDefinition);
    };

    draw();
    map.on("moveend", draw);
    map.on("zoomend", draw);
    window.addEventListener("resize", draw);

    return () => {
      map.off("moveend", draw);
      map.off("zoomend", draw);
      window.removeEventListener("resize", draw);
    };
  }, [activeProject, ready, weatherField, weatherHighDefinition, weatherMetric]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = weatherParticlesRef.current;
    if (!map || !ready || !canvas || activeProject !== "weather" || !weatherWindField || !weatherParticlesEnabled) {
      if (canvas) {
        clearWeatherCanvas(canvas);
      }
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearWeatherCanvas(canvas);
      return;
    }

    let stopped = false;
    let paused = false;
    let frame = 0;
    let resumeTimer = 0;
    let screenField: WeatherScreenField | null = null;
    let particles: WeatherParticle[] = [];

    const rebuildField = () => {
      if (stopped) {
        return;
      }
      const prepared = prepareWeatherCanvas(canvas);
      if (!prepared) {
        return;
      }
      screenField = createWeatherScreenField(map, prepared.width, prepared.height, weatherWindField, weatherHighDefinition);
      const targetCount = Math.round(Math.min(2200, Math.max(520, (prepared.width * prepared.height) / (weatherHighDefinition ? 760 : 1200))));
      particles = screenField ? buildWeatherParticles(screenField, targetCount) : [];
      clearWeatherCanvas(canvas);
      paused = false;
    };

    const pauseAnimation = () => {
      paused = true;
      clearWeatherCanvas(canvas);
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(rebuildField, 260);
    };

    rebuildField();
    map.on("movestart", pauseAnimation);
    map.on("zoomstart", pauseAnimation);
    map.on("moveend", rebuildField);
    map.on("zoomend", rebuildField);
    window.addEventListener("resize", rebuildField);

    const drawFrame = () => {
      if (stopped) {
        return;
      }
      if (!paused && screenField) {
        animateWeatherParticles(map, canvas, particles, screenField);
      }
      frame = window.requestAnimationFrame(drawFrame);
    };

    drawFrame();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(resumeTimer);
      map.off("movestart", pauseAnimation);
      map.off("zoomstart", pauseAnimation);
      map.off("moveend", rebuildField);
      map.off("zoomend", rebuildField);
      window.removeEventListener("resize", rebuildField);
      clearWeatherCanvas(canvas);
    };
  }, [activeProject, ready, weatherHighDefinition, weatherParticlesEnabled, weatherWindField]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || screenshotRequest === 0) {
      return;
    }

    const dataUrl = map.getCanvas().toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "opengridworks-map.png";
    link.click();
    screenshotRef.current("已从当前地图画布导出截图。");
  }, [ready, screenshotRequest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) {
      return;
    }

    let frame = 0;
    const updateOrbitPositions = () => {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const container = map.getContainer();
        const width = container.clientWidth;
        const height = container.clientHeight;
        const center = map.getCenter();
        const centerCoordinates: Coordinates = [center.lng, center.lat];

        setOrbitPositions(Object.fromEntries(orbitBeacons.map((beacon) => {
          const point = map.project(beacon.lngLat);
          const onFacingHemisphere = angularDistanceDegrees(centerCoordinates, beacon.lngLat) < 96;
          const visible = onFacingHemisphere && point.x > -96 && point.x < width + 96 && point.y > -96 && point.y < height + 96;

          return [
            beacon.id,
            {
              left: Math.round(point.x),
              top: Math.round(point.y),
              visible,
              cardSide: point.x > width * 0.62 ? "left" : "right",
            },
          ];
        })));
      });
    };

    updateOrbitPositions();
    map.on("move", updateOrbitPositions);
    map.on("zoom", updateOrbitPositions);
    map.on("rotate", updateOrbitPositions);
    map.on("pitch", updateOrbitPositions);
    map.on("resize", updateOrbitPositions);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      map.off("move", updateOrbitPositions);
      map.off("zoom", updateOrbitPositions);
      map.off("rotate", updateOrbitPositions);
      map.off("pitch", updateOrbitPositions);
      map.off("resize", updateOrbitPositions);
    };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !cinematic) {
      return;
    }

    let index = 0;
    const timer = window.setInterval(() => {
      const target = regionTargets[index % regionTargets.length];
      map.flyTo({
        center: target.center,
        zoom: target.zoom,
        pitch: Math.max(target.pitch, 40),
        bearing: target.bearing + 18,
        speed: 0.42,
        curve: 1.45,
        essential: true,
      });
      index += 1;
    }, 4200);

    return () => window.clearInterval(timer);
  }, [cinematic, ready]);

  return (
    <div className="og-map-viewport" aria-label={activeProject === "carbon" ? "交互式碳排放地球" : "交互式电源项目地图"}>
      <div className="og-starfield" aria-hidden="true" />
      <div ref={mapContainerRef} className="og-maplibre-container" />
      <canvas
        ref={weatherOverlayRef}
        className={`og-weather-canvas og-weather-overlay ${activeProject === "weather" ? "is-active" : ""}`}
        aria-hidden="true"
      />
      <canvas
        ref={weatherParticlesRef}
        className={`og-weather-canvas og-weather-particles ${activeProject === "weather" && weatherParticlesEnabled ? "is-active" : ""}`}
        aria-hidden="true"
      />
      <div className="og-orbit-beacons" aria-label="轨道观测点">
        {activeProject === "carbon" ? null : orbitBeacons.map((beacon) => {
          const position = orbitPositions[beacon.id] ?? { left: -999, top: -999, visible: false, cardSide: "right" as const };

          return (
            <button
              className={`og-orbit-beacon og-orbit-beacon--${position.cardSide} ${position.visible ? "" : "is-hidden"}`}
              key={beacon.id}
              style={{
                "--beacon-left": `${position.left}px`,
                "--beacon-top": `${position.top}px`,
                "--beacon-delay": beacon.delay,
              } as CSSProperties}
              type="button"
              aria-label={`${beacon.label} 轨道观测点`}
              aria-hidden={!position.visible}
              tabIndex={position.visible ? 0 : -1}
            >
              <span className="og-orbit-trail" aria-hidden="true" />
              <span className="og-orbit-dot" aria-hidden="true" />
              <span className="og-orbit-label">{beacon.label}</span>
              <span className="og-orbit-card" role="tooltip">
                <strong>{beacon.label}</strong>
                <span>{beacon.subtitle}</span>
                <span><b>Altitude</b>{beacon.altitude}</span>
                <span><b>Velocity</b>{beacon.velocity}</span>
                <span><b>Lat / Lon</b>{beacon.coordinates}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="og-map-vignette" />
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
  disabled = false,
  active = false,
  className = "",
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`og-icon-button ${active ? "is-active" : ""} ${className}`}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
    </button>
  );
}

function TogglePill({ enabled }: { enabled: boolean }) {
  return <span className={`og-toggle-pill ${enabled ? "is-on" : ""}`}>{enabled ? "开" : "关"}</span>;
}

function LegendSection({
  title,
  children,
  enabled,
  onToggle,
  open = true,
  onOpenToggle,
}: {
  title: string;
  children: React.ReactNode;
  enabled?: boolean;
  onToggle?: () => void;
  open?: boolean;
  onOpenToggle?: () => void;
}) {
  return (
    <section className={`og-legend-section ${open ? "" : "is-collapsed"}`}>
      <div className="og-section-title">
        <button type="button" onClick={onOpenToggle ?? onToggle} aria-expanded={open}>
          {title}
        </button>
        {typeof enabled === "boolean" && onToggle ? (
          <button
            className="og-section-enabled-toggle"
            type="button"
            aria-label={`${title}${enabled ? "已开启" : "已关闭"}`}
            aria-pressed={enabled}
            onClick={onToggle}
          >
            {enabled ? "开" : "关"}
          </button>
        ) : null}
      </div>
      {open ? children : null}
    </section>
  );
}

function SizeLegend({
  activeSizeMin,
  bubbleScale: currentBubbleScale,
  camera,
  onSizeFilter,
  onHover,
}: {
  activeSizeMin: number | null;
  bubbleScale: number;
  camera: MapCameraState;
  onSizeFilter: (minMw: number | null) => void;
  onHover: (hover: LegendHover | null) => void;
}) {
  const chartWidth = 158;
  const chartHeight = 88;
  const originX = 48;
  const originY = 43;
  const labelX = 118;
  const maxRadius = capacityToRadius(sizeBreakpoints[0].minMw, currentBubbleScale);
  const rows = sizeBreakpoints.map((breakpoint, index) => {
    const radius = capacityToRadius(breakpoint.minMw, currentBubbleScale);
    const inset = maxRadius - radius;
    const cx = originX + inset * 0.7;
    const cy = originY + inset * 0.9;
    const guideY = 12 + index * 12 + 6;
    const yDelta = guideY - cy;
    const guideStart = cx + Math.sqrt(Math.max(radius * radius - yDelta * yDelta, 0));

    return {
      ...breakpoint,
      cx,
      cy,
      radius,
      guideY,
      guideStart,
    };
  });

  return (
    <div className="og-size-legend" aria-label="电源项目规模比例尺">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="气泡大小比例尺">
        <g className="og-size-rings">
          {rows.map((row) => (
            <circle
              key={row.minMw}
              className={activeSizeMin === row.minMw ? "is-active" : ""}
              cx={row.cx}
              cy={row.cy}
              r={row.radius}
            />
          ))}
        </g>
        <g className="og-size-guides">
          {rows.map((row) => (
            <path key={row.minMw} d={`M ${row.guideStart} ${row.guideY} H ${labelX - 4}`} />
          ))}
        </g>
      </svg>
      <div className="og-size-labels">
        {rows.map((row) => (
          <button
            type="button"
            key={row.minMw}
            className={activeSizeMin === row.minMw ? "is-active" : ""}
            onClick={() => onSizeFilter(activeSizeMin === row.minMw ? null : row.minMw)}
            onMouseEnter={() => onHover({ kind: "size", minMw: row.minMw })}
            onMouseLeave={() => onHover(null)}
          >
            {row.label}
          </button>
        ))}
      </div>
      <p>缩放 {camera.zoom.toFixed(1)} | 气泡大小 {currentBubbleScale.toFixed(2)}x</p>
    </div>
  );
}

function GenerationLegendPanel({
  heatmapEnabled,
  showInlineHeatmapToggle = false,
  frame,
  manifest,
  data,
  loading,
  error,
  playing,
  onHeatmapToggle,
  onPlayingChange,
  onFrameChange,
}: {
  heatmapEnabled: boolean;
  showInlineHeatmapToggle?: boolean;
  frame: GenerationFrame;
  manifest: ClimateVreManifest | null;
  data: GenerationHeatmapData | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  onHeatmapToggle: () => void;
  onPlayingChange: (playing: boolean) => void;
  onFrameChange: (frame: GenerationFrame) => void;
}) {
  const years = manifest?.years ?? Array.from({ length: 40 }, (_, index) => 2021 + index);
  const minYear = years[0] ?? 2021;
  const maxYear = years.at(-1) ?? 2060;
  const frameLabel = generationFrameText(frame);

  return (
    <div className="og-generation-panel">
      <div className="og-generation-hero">
        <span><Activity size={14} /> VRE 情景估算</span>
        <strong>{frameLabel}{generationTechnologyName(frame.technology)}发电量</strong>
        <p>按现有风电/光伏映射装机估算，不代表 2026 全年官方实绩。</p>
      </div>
      {showInlineHeatmapToggle ? (
        <div className="og-generation-toggle-row">
          <span>热力图图层</span>
          <button
            className="og-section-enabled-toggle og-generation-inline-toggle"
            type="button"
            aria-label={`发电量热力图${heatmapEnabled ? "已开启" : "已关闭"}`}
            aria-pressed={heatmapEnabled}
            onClick={onHeatmapToggle}
          >
            {heatmapEnabled ? "ON" : "OFF"}
          </button>
        </div>
      ) : null}
      <div className="og-generation-tabs" aria-label="发电量类型">
        {(["total", "wind", "solar"] as const).map((item) => (
          <button
            type="button"
            key={item}
            className={frame.technology === item ? "is-active" : ""}
            onClick={() => {
              onPlayingChange(false);
              onFrameChange({ ...frame, technology: item });
            }}
          >
            {generationTechnologyName(item)}
          </button>
        ))}
      </div>
      <div className="og-generation-mode-row">
        {(["annual", "monthly"] as const).map((mode) => (
          <button
            type="button"
            key={mode}
            className={frame.mode === mode ? "is-active" : ""}
            onClick={() => {
              onPlayingChange(false);
              onFrameChange({ ...frame, mode });
            }}
          >
            {generationModeName(mode)}
          </button>
        ))}
        <span>{frameLabel}</span>
      </div>
      <button
        className="og-generation-play"
        type="button"
        aria-pressed={playing}
        disabled={!heatmapEnabled}
        onClick={() => onPlayingChange(!playing)}
      >
        {!heatmapEnabled ? <X size={14} /> : playing ? <Pause size={14} /> : <Play size={14} />}
        {!heatmapEnabled ? "热力图关闭" : playing ? "暂停播放" : frame.mode === "monthly" ? "播放月份" : "播放年份"}
      </button>
      <label className="og-generation-slider">
        <span>年份</span>
        <input
          type="range"
          min={minYear}
          max={maxYear}
          step={1}
          value={frame.year}
          onChange={(event) => {
            onPlayingChange(false);
            onFrameChange({ ...frame, year: Number(event.currentTarget.value) });
          }}
        />
      </label>
      {frame.mode === "monthly" ? (
        <label className="og-generation-slider">
          <span>月份</span>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={frame.month}
            onChange={(event) => {
              onPlayingChange(false);
              onFrameChange({ ...frame, month: Number(event.currentTarget.value) });
            }}
          />
        </label>
      ) : null}
      <div className="og-generation-summary">
        {loading ? (
          <span>正在读取发电量数据...</span>
        ) : error ? (
          <span>{error}</span>
        ) : data ? (
          <>
            <strong>{generationLabel(data.nationalGwh)}</strong>
            <span>最高 {data.topRegion?.label ?? "暂无"} · {data.topRegion ? generationLabel(data.topRegion.valueGwh) : "0 GWh"}</span>
            <span>最低非零 {data.lowestNonZeroRegion?.label ?? "暂无"}</span>
          </>
        ) : (
          <span>暂无当前帧数据</span>
        )}
      </div>
      <div className="og-generation-scale" aria-label="发电量热力色阶预览">
        <span />
        <div>
          <small>低</small>
          <small>{data ? generationLabel(data.maxGwh) : "高"}</small>
        </div>
      </div>
    </div>
  );
}

function CarbonLegendPanel({
  manifest,
  activeDate,
  activeSector,
  frame,
  loading,
  error,
  playing,
  onDateChange,
  onSectorChange,
  onPlayingChange,
}: {
  manifest: CarbonManifest | null;
  activeDate: string;
  activeSector: string;
  frame: CarbonFrame | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  onDateChange: (date: string) => void;
  onSectorChange: (sector: string) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const [openSections, setOpenSections] = useState({
    time: true,
    sectors: true,
    intensity: true,
    source: false,
  });
  const availableFrames = manifest?.frames.filter((item) => item.sector === activeSector) ?? [];
  const activeIndex = Math.max(0, availableFrames.findIndex((item) => item.date === activeDate));
  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };

  return (
    <section aria-label="碳排放筛选">
      <LegendSection
        title="时间"
        open={openSections.time}
        onOpenToggle={() => toggleSection("time")}
      >
        <div className="og-generation-panel og-carbon-control-panel">
          <div className="og-generation-hero">
            <span><CalendarDays size={14} /> GRACED 日排放</span>
            <strong>{activeDate || "等待可用日期"}</strong>
            <p>数据库按日期读取压缩全球栅格帧。</p>
          </div>
          <button
            className="og-generation-play"
            type="button"
            aria-pressed={playing}
            disabled={availableFrames.length < 2}
            onClick={() => onPlayingChange(!playing)}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? "暂停播放" : "播放日期"}
          </button>
          <label className="og-generation-slider">
            <span>日期</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, availableFrames.length - 1)}
              value={activeIndex}
              onChange={(event) => {
                const selected = availableFrames[Number(event.currentTarget.value)];
                if (selected) {
                  onPlayingChange(false);
                  onDateChange(selected.date);
                }
              }}
            />
          </label>
          <div className="og-carbon-date-range">
            <span>{availableFrames[0]?.date ?? "—"}</span>
            <span>{availableFrames.at(-1)?.date ?? "—"}</span>
          </div>
        </div>
      </LegendSection>

      <LegendSection
        title="排放部门"
        open={openSections.sectors}
        onOpenToggle={() => toggleSection("sectors")}
      >
        <ul className="og-legend-list og-carbon-sector-list">
          {manifest?.sectors.map((sector) => {
            const sectorFrame = manifest.frames.find((item) => item.sector === sector && item.date === activeDate)
              ?? manifest.frames.filter((item) => item.sector === sector).at(-1);
            return (
              <li key={sector}>
                <button
                  className={`og-legend-row og-clickable-row ${sector === activeSector ? "" : "is-muted"}`}
                  type="button"
                  aria-pressed={sector === activeSector}
                  onClick={() => {
                    onPlayingChange(false);
                    onSectorChange(sector);
                  }}
                >
                  <span className="og-dot og-carbon-dot" aria-hidden="true" />
                  <span>{carbonSectorLabels[sector] ?? sector}</span>
                  <strong>{sectorFrame ? formatCarbonTotal(sectorFrame.stats.sumKgCPerHour) : "—"}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      </LegendSection>

      <LegendSection
        title="排放强度（kgC/h）"
        open={openSections.intensity}
        onOpenToggle={() => toggleSection("intensity")}
      >
        <div className="og-generation-panel og-carbon-stats-panel">
          <div className="og-generation-summary">
            {loading ? (
              <span>正在读取碳排放栅格...</span>
            ) : error ? (
              <span>{error}</span>
            ) : frame ? (
              <>
                <strong>{formatCarbonTotal(frame.stats.sumKgCPerHour)}</strong>
                <span>最高网格 {formatCarbonValue(frame.stats.max)}</span>
                <span>有效网格 {frame.stats.nonzeroCount.toLocaleString()} 个</span>
              </>
            ) : (
              <span>暂无当前日期数据</span>
            )}
          </div>
          <div className="og-generation-scale og-carbon-emission-scale">
            <span />
            <div>
              <small>低</small>
              <small>对数色阶 · P99</small>
              <small>高</small>
            </div>
          </div>
        </div>
      </LegendSection>

      <LegendSection
        title="数据来源"
        open={openSections.source}
        onOpenToggle={() => toggleSection("source")}
      >
        <div className="og-carbon-source-copy">
          <strong>GRACED / Carbon Monitor</strong>
          <span>单位：每个 0.1° 网格 kgC/h</span>
          <span>{manifest?.sources.find((source) => source.sector === activeSector)?.fileName ?? "等待来源信息"}</span>
        </div>
      </LegendSection>
    </section>
  );
}

function PowerLegendPanel({
  regionStats,
  camera,
  bubbleScale: currentBubbleScale,
  visibleTechnologies,
  visibleLayers,
  visibleVoltageClasses,
  visibleSubstationClasses,
  activeSizeMin,
  openSections,
  generationFrame,
  generationManifest,
  generationData,
  generationLoading,
  generationError,
  generationPlaying,
  generationHeatmapEnabled,
  onToggleSection,
  onOpenGeneration,
  onToggleGenerationHeatmap,
  onGenerationPlayingChange,
  onGenerationFrameChange,
  onToggleTechnology,
  onToggleTechnologyGroup,
  onToggleLayer,
  onToggleVoltage,
  onToggleSubstation,
  onSizeFilter,
  onHover,
}: {
  regionStats: RegionStats;
  camera: MapCameraState;
  bubbleScale: number;
  visibleTechnologies: BooleanRecord<TechnologyKey>;
  visibleLayers: BooleanRecord<LayerKey>;
  visibleVoltageClasses: BooleanRecord<VoltageClass>;
  visibleSubstationClasses: BooleanRecord<VoltageClass>;
  activeSizeMin: number | null;
  openSections: BooleanRecord<LegendSectionKey>;
  generationFrame: GenerationFrame;
  generationManifest: ClimateVreManifest | null;
  generationData: GenerationHeatmapData | null;
  generationLoading: boolean;
  generationError: string | null;
  generationPlaying: boolean;
  generationHeatmapEnabled: boolean;
  onToggleSection: (key: LegendSectionKey) => void;
  onOpenGeneration: () => void;
  onToggleGenerationHeatmap: () => void;
  onGenerationPlayingChange: (playing: boolean) => void;
  onGenerationFrameChange: (frame: GenerationFrame) => void;
  onToggleTechnology: (key: TechnologyKey) => void;
  onToggleTechnologyGroup: () => void;
  onToggleLayer: (key: LayerKey) => void;
  onToggleVoltage: (key: VoltageClass) => void;
  onToggleSubstation: (key: VoltageClass) => void;
  onSizeFilter: (minMw: number | null) => void;
  onHover: (hover: LegendHover | null) => void;
}) {
  const technologyGroupEnabled = technologies.some((item) => visibleTechnologies[item.key]);

  return (
    <section aria-label="电力数据筛选">
      <LegendSection
        title="发电量"
        enabled={generationHeatmapEnabled}
        onToggle={onToggleGenerationHeatmap}
        open={openSections.generation}
        onOpenToggle={openSections.generation ? () => onToggleSection("generation") : onOpenGeneration}
      >
        <GenerationLegendPanel
          heatmapEnabled={generationHeatmapEnabled}
          frame={generationFrame}
          manifest={generationManifest}
          data={generationData}
          loading={generationLoading}
          error={generationError}
          playing={generationPlaying}
          onHeatmapToggle={onToggleGenerationHeatmap}
          onPlayingChange={onGenerationPlayingChange}
          onFrameChange={onGenerationFrameChange}
        />
      </LegendSection>

      <LegendSection
        title="电源类型"
        enabled={technologyGroupEnabled}
        onToggle={onToggleTechnologyGroup}
        open={openSections.technology}
        onOpenToggle={() => onToggleSection("technology")}
      >
        <ul className="og-legend-list">
          {technologies.map((item) => {
            const stats = regionStats.byTechnology[item.key];
            return (
              <li key={item.key}>
                <button
                  className={`og-legend-row og-clickable-row ${visibleTechnologies[item.key] ? "" : "is-muted"}`}
                  type="button"
                  aria-pressed={visibleTechnologies[item.key]}
                  onClick={() => onToggleTechnology(item.key)}
                  onMouseEnter={() => onHover({ kind: "technology", key: item.key })}
                  onMouseLeave={() => onHover(null)}
                >
                  <span className={`og-dot og-${item.tone}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{stats.count} | {formatMw(stats.capacityMw)}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      </LegendSection>

      <LegendSection title="规模（MW）" open={openSections.size} onOpenToggle={() => onToggleSection("size")}>
        <SizeLegend
          activeSizeMin={activeSizeMin}
          bubbleScale={currentBubbleScale}
          camera={camera}
          onHover={onHover}
          onSizeFilter={onSizeFilter}
        />
      </LegendSection>

      <LegendSection
        title="数据中心"
        enabled={visibleLayers.dataCenters}
        onToggle={() => onToggleLayer("dataCenters")}
        open={openSections.dataCenters}
        onOpenToggle={() => onToggleSection("dataCenters")}
      >
        <ul className="og-legend-list">
          <LayerLegendRow
            label="数据中心"
            swatch="diamond"
            active={visibleLayers.dataCenters}
            onClick={() => onToggleLayer("dataCenters")}
            onHover={() => onHover({ kind: "layer", key: "dataCenters" })}
            onLeave={() => onHover(null)}
          />
          <LayerLegendRow
            label="互联网交换中心"
            swatch="diamond-muted"
            active={visibleLayers.internetExchanges}
            onClick={() => onToggleLayer("internetExchanges")}
            onHover={() => onHover({ kind: "layer", key: "internetExchanges" })}
            onLeave={() => onHover(null)}
          />
        </ul>
      </LegendSection>

      <LegendSection
        title="光纤基础设施"
        enabled={visibleLayers.fiber}
        onToggle={() => onToggleLayer("fiber")}
        open={openSections.fiber}
        onOpenToggle={() => onToggleSection("fiber")}
      >
        <ul className="og-legend-list">
          <LayerLegendRow
            label="海底光缆"
            swatch="line-cyan"
            active={visibleLayers.submarineCables}
            onClick={() => onToggleLayer("submarineCables")}
            onHover={() => onHover({ kind: "layer", key: "submarineCables" })}
            onLeave={() => onHover(null)}
          />
          <LayerLegendRow
            label="登陆点"
            swatch="dot-cyan"
            active={visibleLayers.landingPoints}
            onClick={() => onToggleLayer("landingPoints")}
            onHover={() => onHover({ kind: "layer", key: "landingPoints" })}
            onLeave={() => onHover(null)}
          />
        </ul>
      </LegendSection>

      <LegendSection
        title="输电线路"
        enabled={visibleLayers.transmission}
        onToggle={() => onToggleLayer("transmission")}
        open={openSections.transmission}
        onOpenToggle={() => onToggleSection("transmission")}
      >
        <ul className="og-legend-list">
          {voltageClasses.map((item) => (
            <li key={item.key}>
              <button
                className={`og-legend-row og-clickable-row ${visibleVoltageClasses[item.key] ? "" : "is-muted"}`}
                type="button"
                aria-pressed={visibleVoltageClasses[item.key]}
                onClick={() => onToggleVoltage(item.key)}
                onMouseEnter={() => onHover({ kind: "voltage", key: item.key })}
                onMouseLeave={() => onHover(null)}
              >
                <span className={`og-line-swatch og-${item.tone}`} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </LegendSection>

      <LegendSection
        title="本地 OSM 电源项目"
        enabled={visibleLayers.openInfraPower}
        onToggle={() => onToggleLayer("openInfraPower")}
        open={openSections.openInfraPower}
        onOpenToggle={() => onToggleSection("openInfraPower")}
      >
        <ul className="og-legend-list">
          <LayerLegendRow
            label="电源项目"
            swatch="openinfra-plant"
            active={visibleLayers.openInfraPower}
            onClick={() => onToggleLayer("openInfraPower")}
            onHover={() => onHover({ kind: "layer", key: "openInfraPower" })}
            onLeave={() => onHover(null)}
          />
        </ul>
      </LegendSection>

      <LegendSection
        title="变电站"
        enabled={visibleLayers.substations}
        onToggle={() => onToggleLayer("substations")}
        open={openSections.substations}
        onOpenToggle={() => onToggleSection("substations")}
      >
        <ul className="og-legend-list">
          {voltageClasses.slice(1).map((item) => (
            <li key={item.key}>
              <button
                className={`og-legend-row og-clickable-row ${visibleSubstationClasses[item.key] ? "" : "is-muted"}`}
                type="button"
                aria-pressed={visibleSubstationClasses[item.key]}
                onClick={() => onToggleSubstation(item.key)}
                onMouseEnter={() => onHover({ kind: "substation", key: item.key })}
                onMouseLeave={() => onHover(null)}
              >
                <span className="og-substation-dot" />
                <span>{item.label.replace("kV", " kV")}</span>
              </button>
            </li>
          ))}
        </ul>
      </LegendSection>

      <LegendSection
        title="规划升级项目"
        enabled={visibleLayers.plannedUpgrades}
        onToggle={() => onToggleLayer("plannedUpgrades")}
        open={openSections.plannedUpgrades}
        onOpenToggle={() => onToggleSection("plannedUpgrades")}
      >
        <ul className="og-legend-list">
          {["Construction", "Permitting", "Engineering", "Planning", "Conceptual"].map((stage) => (
            <LayerLegendRow
              key={stage}
              label={localizeStatus(stage)}
              swatch="upgrade"
              active={visibleLayers.plannedUpgrades}
              onClick={() => onToggleLayer("plannedUpgrades")}
              onHover={() => onHover({ kind: "layer", key: "plannedUpgrades" })}
              onLeave={() => onHover(null)}
            />
          ))}
        </ul>
      </LegendSection>

      <LegendSection
        title="天然气管线"
        enabled={visibleLayers.gasPipelines}
        onToggle={() => onToggleLayer("gasPipelines")}
        open={openSections.gasPipelines}
        onOpenToggle={() => onToggleSection("gasPipelines")}
      >
        <ul className="og-legend-list">
          <LayerLegendRow label="跨州管线" swatch="pipeline" active={visibleLayers.gasPipelines} onClick={() => onToggleLayer("gasPipelines")} onHover={() => onHover({ kind: "layer", key: "gasPipelines" })} onLeave={() => onHover(null)} />
          <LayerLegendRow label="州内管线" swatch="pipeline-muted" active={visibleLayers.gasPipelines} onClick={() => onToggleLayer("gasPipelines")} onHover={() => onHover({ kind: "layer", key: "gasPipelines" })} onLeave={() => onHover(null)} />
        </ul>
      </LegendSection>
    </section>
  );
}

function LayerLegendRow({
  label,
  swatch,
  active,
  onClick,
  onHover,
  onLeave,
}: {
  label: string;
  swatch: string;
  active: boolean;
  onClick: () => void;
  onHover: () => void;
  onLeave: () => void;
}) {
  return (
    <li>
      <button
        className={`og-legend-row og-clickable-row ${active ? "" : "is-muted"}`}
        type="button"
        aria-pressed={active}
        onClick={onClick}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        <span className={`og-layer-swatch og-${swatch}`} />
        <span>{label}</span>
      </button>
    </li>
  );
}

function TopToolbar({
  activeProject,
  activePanel,
  cinematic,
  onOpenPanel,
  onReset,
  onCinematic,
  onShare,
  onScreenshot,
  onCards,
}: {
  activeProject: ProjectMode;
  activePanel: ToolbarPanel;
  cinematic: boolean;
  onOpenPanel: (panel: NonNullable<ToolbarPanel>) => void;
  onReset: () => void;
  onCinematic: () => void;
  onShare: () => void;
  onScreenshot: () => void;
  onCards: () => void;
}) {
  const weatherMode = activeProject === "weather";
  const carbonMode = activeProject === "carbon";

  return (
    <div className="og-top-toolbar" aria-label="地图工具栏">
      <div className="og-live-users">
        <span />
        <strong>525</strong>
        <span>{weatherMode ? "人正在查看气象覆盖" : carbonMode ? "人正在查看碳排放图层" : "人正在查看电网图层"}</span>
      </div>
      <div className="og-toolbar-buttons">
        <IconButton label="已保存视图（仅管理员）" icon={Bookmark} disabled />
        <IconButton label="重置全部筛选" icon={RotateCcw} onClick={onReset} />
        <IconButton label="沉浸视图" icon={ImageIcon} active={cinematic} onClick={onCinematic} />
        {weatherMode || carbonMode ? null : (
          <IconButton label="预设视图" icon={Grid2X2} active={activePanel === "presets"} onClick={() => onOpenPanel("presets")} />
        )}
        <IconButton label="标注设置" icon={Type} active={activePanel === "labels"} onClick={() => onOpenPanel("labels")} />
        <IconButton label="地球视图控制" icon={Globe2} active={activePanel === "globe"} onClick={() => onOpenPanel("globe")} />
        <IconButton label="登录后启用中继模式" icon={RadioTower} disabled />
        <IconButton label="导出地图 PNG" icon={Camera} onClick={onScreenshot} />
        <IconButton label="分享地图链接" icon={Share2} onClick={onShare} />
        {weatherMode || carbonMode ? null : <IconButton label="打开卡片面板" icon={Database} onClick={onCards} />}
      </div>
    </div>
  );
}

function PanelShell({
  title,
  className = "",
  onClose,
  children,
}: {
  title: string;
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`og-floating-panel ${className}`} aria-label={title}>
      <header className="og-floating-panel-header">
        <strong>{title}</strong>
        <button type="button" aria-label={`关闭${title}`} onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      {children}
    </section>
  );
}

function LabelSettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: LabelSettings;
  onChange: (settings: LabelSettings) => void;
  onClose: () => void;
}) {
  const applyPreset = (preset: LabelPreset) => {
    const presets: Record<LabelPreset, LabelSettings> = {
      "zoom-v2": { ...settings, preset, showLabels: true, linesOnly: false, enhancedVisibility: false, bigLabels: false, lineLabelSize: 96 },
      "zoom-v1": { ...settings, preset, showLabels: true, linesOnly: false, enhancedVisibility: false, bigLabels: false, lineLabelSize: 88 },
      "lines-only": { ...settings, preset, showLabels: true, linesOnly: true, enhancedVisibility: false, bigLabels: false, lineLabelSize: 94 },
      "no-labels": { ...settings, preset, showLabels: false, linesOnly: false, enhancedVisibility: false, bigLabels: false, lineLabelSize: 86 },
      bleed: { ...settings, preset, showLabels: true, linesOnly: false, enhancedVisibility: true, bigLabels: true, lineLabelSize: 126 },
    };
    onChange(presets[preset]);
  };

  const update = <K extends keyof LabelSettings>(key: K, value: LabelSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <PanelShell title="标注设置" className="og-label-panel" onClose={onClose}>
      <div className="og-panel-list">
        <PresetRow label="缩放标注 v2" active={settings.preset === "zoom-v2"} badge="启用中" onClick={() => applyPreset("zoom-v2")} />
        <PresetRow label="缩放标注 v1" active={settings.preset === "zoom-v1"} onClick={() => applyPreset("zoom-v1")} />
        <PresetRow label="仅线路标注" active={settings.preset === "lines-only"} onClick={() => applyPreset("lines-only")} />
        <PresetRow label="隐藏全部标注" active={settings.preset === "no-labels"} onClick={() => applyPreset("no-labels")} />
        <PresetRow label="高可见标注" active={settings.preset === "bleed"} onClick={() => applyPreset("bleed")} />
        <ToggleRow label="显示标注" enabled={settings.showLabels} onClick={() => update("showLabels", !settings.showLabels)} />
        <ToggleRow label="变电站标注" enabled={settings.substationLabels} onClick={() => update("substationLabels", !settings.substationLabels)} />
        <ToggleRow label="底图文字标注" enabled={settings.basemapTextLabels} onClick={() => update("basemapTextLabels", !settings.basemapTextLabels)} />
        <ToggleRow label="仅显示线路" enabled={settings.linesOnly} onClick={() => update("linesOnly", !settings.linesOnly)} />
        <ToggleRow label="按线路类型着色" enabled={settings.colorByLineType} onClick={() => update("colorByLineType", !settings.colorByLineType)} />
        <ToggleRow label="增强可见性" enabled={settings.enhancedVisibility} onClick={() => update("enhancedVisibility", !settings.enhancedVisibility)} />
        <ToggleRow label="大号标注" enabled={settings.bigLabels} onClick={() => update("bigLabels", !settings.bigLabels)} />
        <label className="og-slider-row">
          <span>线路标注大小</span>
          <strong>{settings.lineLabelSize}%</strong>
          <input
            type="range"
            min={70}
            max={140}
            value={settings.lineLabelSize}
            onChange={(event) => update("lineLabelSize", Number(event.currentTarget.value))}
          />
        </label>
        <ToggleRow label="国家边界" enabled={settings.countryBorders} onClick={() => update("countryBorders", !settings.countryBorders)} />
        <ToggleRow label="州/省边界" enabled={settings.stateBorders} onClick={() => update("stateBorders", !settings.stateBorders)} />
        <ToggleRow label="省州名称标注" enabled={settings.provinceLabels} onClick={() => update("provinceLabels", !settings.provinceLabels)} />
      </div>
    </PanelShell>
  );
}

function PresetRow({
  label,
  active,
  badge,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button className={`og-panel-row ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      <span>{label}</span>
      {badge ? <strong>{badge}</strong> : active ? <Check size={14} /> : null}
    </button>
  );
}

function ToggleRow({
  label,
  enabled,
  onClick,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="og-panel-row" type="button" onClick={onClick} aria-pressed={enabled}>
      <span>{label}</span>
      <TogglePill enabled={enabled} />
    </button>
  );
}

function GlobeControlsPanel({
  visibleSourceLayers,
  onToggleSourceLayer,
  onToggleAll,
  onFlyToRegion,
  onClose,
}: {
  visibleSourceLayers: BooleanRecord<SourceLayerKey>;
  onToggleSourceLayer: (key: SourceLayerKey) => void;
  onToggleAll: (enabled: boolean) => void;
  onFlyToRegion: (target: RegionTarget) => void;
  onClose: () => void;
}) {
  const allEnabled = sourceLayers.every((layer) => visibleSourceLayers[layer.key]);

  return (
    <PanelShell title="地球视图控制" className="og-globe-panel" onClose={onClose}>
      <div className="og-panel-list">
        <button className="og-layer-toggle-row is-global" type="button" onClick={() => onToggleAll(!allEnabled)}>
          <span><Globe2 size={15} /> 全球</span>
          <strong>{allEnabled ? "全部开启" : "自定义"}</strong>
        </button>
        {sourceLayers.map((layer) => (
          <button className="og-layer-toggle-row" type="button" key={layer.key} onClick={() => onToggleSourceLayer(layer.key)}>
            <span>{layer.label}</span>
            <TogglePill enabled={visibleSourceLayers[layer.key]} />
          </button>
        ))}
      </div>

      <div className="og-region-list">
        {regionTargets.slice(1).map((target) => (
          <button className="og-region-row" type="button" key={target.id} onClick={() => onFlyToRegion(target)}>
            <span><em>{target.code}</em>{target.label}</span>
            <TogglePill enabled={target.enabled} />
            <Plane size={14} />
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

function PresetViewsPanel({
  onApplyCleanEnergy,
  onApplyPlanned,
  onReset,
  onClose,
}: {
  onApplyCleanEnergy: () => void;
  onApplyPlanned: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <PanelShell title="预设视图" className="og-presets-panel" onClose={onClose}>
      <div className="og-preset-grid">
        <button type="button" onClick={onApplyPlanned}>
          <strong>未来建设视图</strong>
          <span>规划和在建电源、数据中心与输电升级</span>
        </button>
        <button type="button" onClick={onApplyCleanEnergy}>
          <strong>清洁能源增长</strong>
          <span>光伏、风电、海上风电与储能</span>
        </button>
        <button type="button" onClick={onReset}>
          <strong>全部图层</strong>
          <span>恢复所有默认可见图层</span>
        </button>
      </div>
    </PanelShell>
  );
}

function SearchPanel({
  query,
  onQuery,
  onSelect,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  onSelect: (feature: SelectedFeature) => void;
  onClose: () => void;
}) {
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const energyResults = energyAssets.map((asset) => ({
      id: asset.id,
      title: asset.name,
      subtitle: `${technologies.find((item) => item.key === asset.technology)?.label ?? "电源项目"} | ${formatMw(asset.capacityMw)}`,
      selected: {
        id: asset.id,
        kind: "energy" as const,
        title: asset.name,
        subtitle: technologies.find((item) => item.key === asset.technology)?.label ?? "电源项目",
        coordinates: [asset.lng, asset.lat] as Coordinates,
        color: technologyColor(asset.technology),
        source: asset.source,
        rows: [
          { label: "装机容量", value: formatMw(asset.capacityMw) },
          { label: "状态", value: localizeStatus(asset.status) },
          { label: "国家/地区", value: asset.countryCode },
        ],
      },
    }));
    const centerResults = dataCenters.map((asset) => ({
      id: asset.id,
      title: asset.name,
      subtitle: `${asset.operator}${asset.city ? ` | ${asset.city}` : ""}`,
      selected: {
        id: asset.id,
        kind: asset.kind,
        title: asset.name,
        subtitle: asset.operator,
        coordinates: [asset.lng, asset.lat] as Coordinates,
        color: asset.kind === "data-center" ? "#f8fafc" : "#64748b",
        source: asset.source,
        rows: [
          { label: "负荷", value: formatOptionalMw(asset.capacityMw) },
          { label: "城市", value: asset.city ?? "未知" },
          { label: "国家/地区", value: asset.countryCode },
        ],
      },
    }));
    const cableResults = submarineCables.map((cable) => ({
      id: cable.id,
      title: cable.name,
      subtitle: `${cable.operator} | ${cable.lengthKm.toLocaleString()} km`,
      selected: {
        id: cable.id,
        kind: "submarine-cable" as const,
        title: cable.name,
        subtitle: cable.operator,
        coordinates: cable.coordinates[Math.floor(cable.coordinates.length / 2)] ?? cable.coordinates[0],
        color: "#22d3ee",
        source: cable.source,
        rows: [
          { label: "长度", value: `${cable.lengthKm.toLocaleString()} km` },
          { label: "投运时间", value: cable.readyForService },
          { label: "登陆点", value: landingPoints.filter((point) => point.cableId === cable.id).map((point) => point.name).join("; ") },
        ],
      },
    }));

    return [...energyResults, ...centerResults, ...cableResults]
      .filter((result) => !normalizedQuery || `${result.title} ${result.subtitle}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 9);
  }, [query]);

  return (
    <PanelShell title="搜索" className="og-search-panel" onClose={onClose}>
      <label className="og-search-box">
        <Search size={16} />
        <input value={query} onChange={(event) => onQuery(event.currentTarget.value)} placeholder="搜索电源项目、地点..." autoFocus />
      </label>
      <div className="og-search-results">
        {results.map((result) => (
          <button type="button" key={result.id} onClick={() => onSelect(result.selected)}>
            <strong>{result.title}</strong>
            <span>{result.subtitle}</span>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

function numericOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function FeaturePopup({
  feature,
  onClose,
}: {
  feature: SelectedFeature | null;
  onClose: () => void;
}) {
  if (!feature) {
    return null;
  }

  return (
    <article className="og-feature-popup" aria-label={`${feature.title}详情`}>
      <button className="og-popup-close" type="button" aria-label="关闭" onClick={onClose}>
        <X size={18} />
      </button>
      <h2>{feature.title}</h2>
      <p>{feature.subtitle}</p>
      {feature.source ? (
        <span className="og-source-chip">
          <span />
          {feature.source}
        </span>
      ) : null}
      <dl>
        {feature.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {feature.id === "cable-pc1" ? (
        <p className="og-landing-points">
          Ajigaura, Japan; Shima, Japan; Grover Beach, CA, United States; Harbour Pointe, WA, United States
        </p>
      ) : null}
    </article>
  );
}

type LayerPanelItem = {
  label: string;
  icon: LucideIcon;
  layer?: LayerKey;
  locked?: boolean;
  badge?: string;
};

const layerPanelGroups: { title: string; items: LayerPanelItem[] }[] = [
  {
    title: "点位",
    items: [
      { label: "数据中心", icon: Database, layer: "dataCenters", badge: "测试版" },
      { label: "充电设施", icon: Zap, locked: true },
      { label: "IX 队列", icon: SlidersHorizontal, layer: "internetExchanges" },
      { label: "变电站", icon: RadioTower, layer: "substations" },
      { label: "LNG", icon: Plane, locked: true },
    ],
  },
  {
    title: "线路",
    items: [
      { label: "输电线路", icon: RadioTower, layer: "transmission" },
      { label: "本地 OSM 电源项目", icon: RadioTower, layer: "openInfraPower", badge: "LOCAL" },
      { label: "输电升级", icon: Zap, layer: "plannedUpgrades" },
      { label: "燃气管线", icon: SlidersHorizontal, layer: "gasPipelines" },
      { label: "铁路走廊", icon: Grid2X2, locked: true },
      { label: "公路走廊", icon: RadioTower, locked: true },
      { label: "$368 ROW", icon: Database, locked: true },
      { label: "水道", icon: Layers, locked: true },
      { label: "光纤", icon: Circle, layer: "fiber" },
    ],
  },
  {
    title: "区域",
    items: [
      { label: "ISO 区域", icon: MapIcon, locked: true, badge: "测试版" },
      { label: "公用事业", icon: Database, locked: true },
      { label: "县域", icon: Grid2X2, locked: true },
      { label: "联邦土地", icon: MapIcon, locked: true },
      { label: "洪泛区", icon: Layers, locked: true },
      { label: "水风险", icon: Info, locked: true },
      { label: "能源社区", icon: Database, locked: true, badge: "测试版" },
      { label: "页岩区", icon: SlidersHorizontal, locked: true },
    ],
  },
];

function LayersPanel({
  visibleLayers,
  onToggleLayer,
  onLocked,
  onClose,
}: {
  visibleLayers: BooleanRecord<LayerKey>;
  onToggleLayer: (key: LayerKey) => void;
  onLocked: (label: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="og-floating-panel og-layers-panel" aria-label="图层面板">
      <header>
        <strong>图层</strong>
        <button type="button" aria-label="关闭图层面板" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="og-layer-grid">
        {layerPanelGroups.map((group) => (
          <div className="og-layer-grid-row" key={group.title}>
            <span className="og-layer-grid-label">{group.title}</span>
            <div className="og-layer-grid-items">
              {group.items.map((item) => {
                const active = item.layer ? visibleLayers[item.layer] : false;
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.label}
                    className={`og-layer-option ${active ? "is-active" : ""} ${item.locked ? "is-locked" : ""}`}
                    aria-pressed={item.layer ? active : undefined}
                    onClick={() => {
                      if (item.layer) {
                        onToggleLayer(item.layer);
                        return;
                      }
                      onLocked(item.label);
                    }}
                  >
                    {item.badge ? <small>{item.badge}</small> : null}
                    <Icon size={19} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomLayersPanel({
  visibleCustomLayers,
  onToggleCustomLayer,
  onClose,
}: {
  visibleCustomLayers: BooleanRecord<CustomLayerKey>;
  onToggleCustomLayer: (key: CustomLayerKey) => void;
  onClose: () => void;
}) {
  const rows: { key: CustomLayerKey; label: string; description: string }[] = [
    { key: "customCorridor", label: "AI 负荷走廊", description: "早期测试 GeoJSON 叠加层" },
    { key: "customHeatmap", label: "亚洲需求带", description: "未来自定义图层示例" },
  ];

  return (
    <section className="og-floating-panel og-custom-panel" aria-label="自定义图层面板">
      <header>
        <div>
          <strong>自定义图层</strong>
          <span>早期测试</span>
        </div>
        <button type="button" aria-label="关闭自定义图层面板" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="og-custom-layer-list">
        {rows.map((row) => (
          <button
            type="button"
            key={row.key}
            className={visibleCustomLayers[row.key] ? "is-active" : ""}
            onClick={() => onToggleCustomLayer(row.key)}
          >
            <span />
            <strong>{row.label}</strong>
            <small>{row.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

const mapThemeThumbnails: Partial<Record<MapThemeKey, string>> = {
  nasa: "/images/opengridworks/map-type-thumb-nasa.png",
  satellite: "/images/opengridworks/map-type-thumb-satellite.png",
};

function MapTypePanel({
  themes = mapThemes,
  activeMapTheme,
  onTheme,
  onClose,
}: {
  themes?: MapTheme[];
  activeMapTheme: MapThemeKey;
  onTheme: (theme: MapThemeKey) => void;
  onClose: () => void;
}) {
  return (
    <section className="og-floating-panel og-maptype-panel" aria-label="底图类型面板">
      <header>
        <strong>底图类型</strong>
        <button type="button" aria-label="关闭底图类型面板" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="og-maptype-strip">
        {themes.map((theme) => {
          const thumbnail = mapThemeThumbnails[theme.key];
          return (
            <button
              type="button"
              key={theme.key}
              className={`og-maptype-card og-maptype-${theme.key} ${activeMapTheme === theme.key ? "is-active" : ""}`}
              aria-pressed={activeMapTheme === theme.key}
              onClick={() => onTheme(theme.key)}
            >
              {thumbnail ? <Image src={thumbnail} alt="" width={92} height={66} /> : null}
              <span>{theme.label}</span>
              <small>{theme.description}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SourcesPanel({ onClose }: { onClose: () => void }) {
  const sourceRows = [
    {
      label: "Esri World Imagery",
      value: "卫星影像底图：Esri World Imagery raster tiles",
      href: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9",
    },
    {
      label: "Local China OSM power tiles",
      value: "/data/osm-power/tiles/china-260517-osm-z3-5-20260519-plants-generators/{z}/{x}/{y}.pbf",
      href: "https://www.openstreetmap.org/copyright",
    },
    {
      label: "Local China OSM extract",
      value: "china-260517.osm.pbf -> 本地 GeoJSON + 矢量瓦片",
      href: "https://www.openstreetmap.org/copyright",
    },
    {
      label: "中国数据提取路径",
      value: "OSM PBF -> scripts/build-china-osm-power-data.py -> public/data/osm-power",
      href: "https://download.geofabrik.de/asia/china.html",
    },
    {
      label: "中国电源项目",
      value: "本地 WRI、GEM 2026 光伏/风电与中国水电下载数据",
      href: "https://globalenergymonitor.org/projects/global-solar-power-tracker/",
    },
    {
      label: "国家与省级边界",
      value: "Natural Earth Admin-0/Admin-1 边界，本地打包",
      href: "https://github.com/nvkelso/natural-earth-vector",
    },
    {
      label: "官方总量校验",
      value: "使用国家能源局/国家统计局统计校验，不作为资产坐标来源",
      href: "https://www.nea.gov.cn/",
    },
    {
      label: "中国以外仍为演示数据",
      value: "演示电源项目、规划升级、数据中心、海缆与天然气管线",
      href: "https://docs.peeringdb.com/api_specs/",
    },
  ];

  return (
    <PanelShell title="数据来源" className="og-sources-panel" onClose={onClose}>
      <div className="og-source-summary">
        <strong>已加载中国数据与实时 OSM 渲染</strong>
        <span>中国电源项目点位和 OSM 电力设施来自本地生成文件；输电线路按左侧电压图例发光渲染。</span>
      </div>
      <div className="og-source-rows">
        {sourceRows.map((row) => (
          <a href={row.href} target="_blank" rel="noreferrer" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </a>
        ))}
      </div>
      <p className="og-source-note">
        中国暂无完整公开的官方电网 GIS 数据。坐标使用 OSM 可见资产，总量再与官方统计口径核对。
      </p>
    </PanelShell>
  );
}

function BasemapButton({ theme, expanded, onClick }: {
  theme: MapThemeKey;
  expanded: boolean;
  onClick: () => void;
}) {
  const thumbnail = mapThemeThumbnails[theme];
  return (
    <button
      type="button"
      className={`og-layer-card og-maptype-${theme} ${expanded ? "is-active" : ""}`}
      aria-label="底图"
      aria-expanded={expanded}
      onClick={onClick}
    >
      {thumbnail ? <Image src={thumbnail} alt="" width={76} height={76} /> : null}
      <span>
        <MapIcon size={15} />
        底图
      </span>
    </button>
  );
}

function LayerCards({
  activePanel,
  activeMapTheme,
  onOpenPanel,
}: {
  activePanel: ToolbarPanel;
  activeMapTheme: MapThemeKey;
  onOpenPanel: (panel: NonNullable<ToolbarPanel>) => void;
}) {
  return (
    <div className="og-layer-cards" aria-label="图层控制">
      <button
        type="button"
        className={`og-layer-card ${activePanel === "layers" ? "is-active" : ""}`}
        onClick={() => onOpenPanel("layers")}
      >
        <Image src="/images/opengridworks/layers-thumb.png" alt="" width={76} height={76} />
        <span>
          <Layers size={15} />
          图层
        </span>
      </button>
      <button
        type="button"
        className={`og-layer-card ${activePanel === "customLayers" ? "is-active" : ""}`}
        onClick={() => onOpenPanel("customLayers")}
      >
        <Image src="/images/opengridworks/map-type-thumb-satellite.png" alt="" width={76} height={76} />
        <span>自定义图层</span>
      </button>
      <BasemapButton
        theme={mapThemeThumbnails[activeMapTheme] ? activeMapTheme : "nasa"}
        expanded={activePanel === "mapType"}
        onClick={() => onOpenPanel("mapType")}
      />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function coordinateToMiniPosition(center: Coordinates) {
  const [lng, lat] = center;
  return {
    left: `${((lng + 180) / 360) * 100}%`,
    top: `${((85 - clamp(lat, -85, 85)) / 170) * 100}%`,
  };
}

function MiniMap({
  selectedFeature,
  camera,
  onMove,
}: {
  selectedFeature: SelectedFeature | null;
  camera: MapCameraState;
  onMove: (center: Coordinates) => void;
}) {
  const minimapRef = useRef<HTMLButtonElement | null>(null);
  const dotPosition = coordinateToMiniPosition(camera.center);

  const moveFromPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left, 0, bounds.width);
    const y = clamp(event.clientY - bounds.top, 0, bounds.height);
    const lng = (x / bounds.width) * 360 - 180;
    const lat = 85 - (y / bounds.height) * 170;
    onMove([lng, clamp(lat, -75, 75)]);
  };

  return (
    <button
      ref={minimapRef}
      type="button"
      className={`og-minimap ${selectedFeature ? "has-selection" : ""}`}
      aria-label="拖动迷你地球调整地图中心"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          moveFromPointer(event);
        }
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <div className="og-mini-land land-a" />
      <div className="og-mini-land land-b" />
      <span style={dotPosition} />
    </button>
  );
}

function MobilePowerShortcuts({
  activeGeneration,
  activeCleanEnergy,
  activeGas,
  activePlanned,
  onGeneration,
  onCleanEnergy,
  onGas,
  onPlanned,
}: {
  activeGeneration: boolean;
  activeCleanEnergy: boolean;
  activeGas: boolean;
  activePlanned: boolean;
  onGeneration: () => void;
  onCleanEnergy: () => void;
  onGas: () => void;
  onPlanned: () => void;
}) {
  return (
    <div className="og-mobile-controls og-mobile-chips" aria-label="电力图层快捷控制">
      <button type="button" aria-pressed={activeGeneration} onClick={onGeneration}><span />发电量</button>
      <button type="button" aria-pressed={activeCleanEnergy} onClick={onCleanEnergy}><span />可再生能源</button>
      <button type="button" aria-pressed={activeGas} onClick={onGas}><span />燃气</button>
      <button type="button" aria-pressed={activePlanned} onClick={onPlanned}><span />开发中</button>
    </div>
  );
}

function CardsDrawer({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (feature: SelectedFeature) => void;
}) {
  const cards = useMemo(() => {
    return energyAssets.slice(0, 10).map((asset) => ({
      id: asset.id,
      title: asset.name,
      subtitle: `${technologies.find((item) => item.key === asset.technology)?.label ?? "电源项目"} | ${formatMw(asset.capacityMw)}`,
      feature: {
        id: asset.id,
        kind: "energy" as const,
        title: asset.name,
        subtitle: technologies.find((item) => item.key === asset.technology)?.label ?? "电源项目",
        coordinates: [asset.lng, asset.lat] as Coordinates,
        color: technologyColor(asset.technology),
        source: asset.source,
        rows: [
          { label: "装机容量", value: formatMw(asset.capacityMw) },
          { label: "状态", value: localizeStatus(asset.status) },
          { label: "国家/地区", value: asset.countryCode },
        ],
      },
    }));
  }, []);

  return (
    <aside className={`og-cards-drawer ${open ? "is-open" : ""}`} aria-label="卡片面板" aria-hidden={!open}>
      <header>
        <strong>地图卡片</strong>
        <button type="button" aria-label="关闭卡片面板" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div>
        {cards.map((card) => (
          <button type="button" key={card.id} onClick={() => onSelect(card.feature)}>
            <strong>{card.title}</strong>
            <span>{card.subtitle}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function HoverBubble({ tooltip }: { tooltip: HoverTooltip }) {
  if (!tooltip) {
    return null;
  }

  return (
    <div className="og-hover-bubble" style={{ left: tooltip.x + 18, top: tooltip.y + 18, borderColor: tooltip.color }}>
      <strong>{tooltip.title}</strong>
      <span>{tooltip.subtitle}</span>
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return <div className="og-toast" role="status">{message}</div>;
}

function MobileGenerationSheet({
  open,
  heatmapEnabled,
  frame,
  manifest,
  data,
  loading,
  error,
  playing,
  onHeatmapToggle,
  onPlayingChange,
  onFrameChange,
}: {
  open: boolean;
  heatmapEnabled: boolean;
  frame: GenerationFrame;
  manifest: ClimateVreManifest | null;
  data: GenerationHeatmapData | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  onHeatmapToggle: () => void;
  onPlayingChange: (playing: boolean) => void;
  onFrameChange: (frame: GenerationFrame) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <aside className="og-mobile-generation-sheet" aria-label="发电量移动控制">
      <GenerationLegendPanel
        heatmapEnabled={heatmapEnabled}
        showInlineHeatmapToggle
        frame={frame}
        manifest={manifest}
        data={data}
        loading={loading}
        error={error}
        playing={playing}
        onHeatmapToggle={onHeatmapToggle}
        onPlayingChange={onPlayingChange}
        onFrameChange={onFrameChange}
      />
    </aside>
  );
}

export function MapAppShell({ initialProject = "power" }: { initialProject?: WorkspaceTopic }) {
  const [activeProject, setActiveProject] = useState<WorkspaceTopic>(initialProject);
  const [visibleTechnologies, setVisibleTechnologies] = useState(hiddenTechnologyState);
  const [visibleLayers, setVisibleLayers] = useState(hiddenLayerState);
  const [visibleCustomLayers, setVisibleCustomLayers] = useState<BooleanRecord<CustomLayerKey>>({
    customCorridor: false,
    customHeatmap: false,
  });
  const [openLegendSections, setOpenLegendSections] = useState<BooleanRecord<LegendSectionKey>>(legendSectionState);
  const [visibleSourceLayers, setVisibleSourceLayers] = useState(sourceLayerState);
  const [visibleVoltageClasses, setVisibleVoltageClasses] = useState(hiddenVoltageState);
  const [visibleSubstationClasses, setVisibleSubstationClasses] = useState(hiddenVoltageState);
  const [activeRegion, setActiveRegion] = useState<RegionMeta>(defaultRegion);
  const [focusedRegion, setFocusedRegion] = useState<RegionTargetId>(defaultRegion.id);
  const [mapCamera, setMapCamera] = useState<MapCameraState>({
    center: defaultRegion.center,
    zoom: defaultRegion.zoom,
    pitch: defaultRegion.pitch,
    bearing: defaultRegion.bearing,
  });
  const [economyMapTheme, setEconomyMapTheme] = useState<MapThemeKey>("nasa");
  const [activeMapTheme, setActiveMapTheme] = useState<MapThemeKey>(initialProject === "weather" ? "goes" : "nasa");
  const [activeSizeMin, setActiveSizeMin] = useState<number | null>(null);
  const [generationFrame, setGenerationFrame] = useState<GenerationFrame>(defaultGenerationFrame);
  const [generationManifest, setGenerationManifest] = useState<ClimateVreManifest | null>(null);
  const [generationSummary, setGenerationSummary] = useState<ClimateVreSummary | null>(null);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationPlaying, setGenerationPlaying] = useState(false);
  const [generationHeatmapEnabled, setGenerationHeatmapEnabled] = useState(false);
  const [weatherScene, setWeatherScene] = useState<WeatherScene>("globe");
  const [weatherDocument, setWeatherDocument] = useState<Document | null>(null);
  const [carbonManifest, setCarbonManifest] = useState<CarbonManifest | null>(null);
  const [carbonDate, setCarbonDate] = useState("");
  const [carbonSector, setCarbonSector] = useState("Power");
  const [carbonFrame, setCarbonFrame] = useState<CarbonFrame | null>(null);
  const [carbonLoading, setCarbonLoading] = useState(false);
  const [carbonError, setCarbonError] = useState<string | null>(null);
  const [carbonPlaying, setCarbonPlaying] = useState(false);
  const [databaseMapVersion, setDatabaseMapVersion] = useState(0);
  const [hoveredLegend, setHoveredLegend] = useState<LegendHover | null>(null);
  const [labelSettings, setLabelSettings] = useState<LabelSettings>(initialLabelSettings);
  const [activePanel, setActivePanel] = useState<ToolbarPanel>(null);
  const [selectedFeature, setSelectedFeature] = useState<SelectedFeature | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltip>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>({
    nonce: 1,
    center: defaultRegion.center,
    zoom: defaultRegion.zoom,
    pitch: defaultRegion.pitch,
    bearing: defaultRegion.bearing,
  });
  const [, setFocusNonce] = useState(2);
  const [screenshotRequest, setScreenshotRequest] = useState(0);
  const [cinematic, setCinematic] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const generationLoadStartedRef = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    let active = true;

    void fetch("/api/data/map-assets", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Map asset request failed with ${response.status}.`);
        }
        return response.json() as Promise<DatabaseMapAssets>;
      })
      .then((databaseAssets) => {
        if (!active || !Array.isArray(databaseAssets.energyAssets) || !Array.isArray(databaseAssets.dataCenters)) {
          return;
        }
        energyAssets.splice(0, energyAssets.length, ...databaseAssets.energyAssets);
        dataCenters.splice(0, dataCenters.length, ...databaseAssets.dataCenters);
        setDatabaseMapVersion((version) => version + 1);
      })
      .catch((error: unknown) => {
        console.warn("Using bundled map assets because the database request failed.", error);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!generationHeatmapEnabled || generationLoadStartedRef.current) {
      return;
    }

    generationLoadStartedRef.current = true;
    let active = true;

    void loadClimateVreManifest().then((manifest) => {
      if (!active) {
        return;
      }
      if (!manifest) {
        setGenerationError("未找到发电量情景数据 manifest。");
        setGenerationLoading(false);
        return;
      }

      setGenerationManifest(manifest);
      void loadClimateVreSummary(manifest.summaryPath).then((summary) => {
        if (!active) {
          return;
        }
        if (!summary) {
          setGenerationError("发电量摘要数据不可用。");
        } else {
          setGenerationSummary(summary);
          setGenerationError(null);
        }
        setGenerationLoading(false);
      });
    });

    return () => {
      active = false;
    };
  }, [generationHeatmapEnabled]);

  useEffect(() => {
    if (!generationPlaying || !generationHeatmapEnabled) {
      return;
    }

    const timer = window.setInterval(() => {
      setGenerationFrame((frame) => nextGenerationFrame(frame, generationManifest?.years ?? []));
    }, generationFrame.mode === "monthly" ? 850 : 950);

    return () => window.clearInterval(timer);
  }, [generationFrame.mode, generationHeatmapEnabled, generationManifest?.years, generationPlaying]);

  useEffect(() => {
    if (activeProject !== "carbon" || carbonManifest) {
      return;
    }

    let active = true;
    void loadCarbonManifest()
      .then((manifest) => {
        if (!active) {
          return;
        }
        const initialSector = manifest.sectors.includes("Power")
          ? "Power"
          : manifest.sectors[0] ?? "total";
        const initialFrame = manifest.frames.filter((item) => item.sector === initialSector).at(-1);
        setCarbonManifest(manifest);
        setCarbonSector(initialSector);
        setCarbonDate(initialFrame?.date ?? manifest.latestDate ?? "");
        setCarbonLoading(Boolean(initialFrame));
        setCarbonError(null);
      })
      .catch((error: unknown) => {
        if (active) {
          setCarbonError(error instanceof Error ? error.message : "碳排放目录加载失败。");
          setCarbonLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeProject, carbonManifest]);

  const activeCarbonMeta = useMemo(
    () => carbonManifest?.frames.find((item) => item.date === carbonDate && item.sector === carbonSector) ?? null,
    [carbonDate, carbonManifest, carbonSector],
  );

  useEffect(() => {
    if (activeProject !== "carbon" || !activeCarbonMeta) {
      return;
    }

    let active = true;
    void loadCarbonFrame(activeCarbonMeta)
      .then((frame) => {
        if (active) {
          setCarbonFrame(frame);
          setCarbonError(null);
          setCarbonLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCarbonError(error instanceof Error ? error.message : "碳排放帧加载失败。");
          setCarbonLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeCarbonMeta, activeProject]);

  useEffect(() => {
    if (!carbonPlaying || activeProject !== "carbon" || !carbonManifest) {
      return;
    }
    const frames = carbonManifest.frames.filter((item) => item.sector === carbonSector);
    if (frames.length < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      setCarbonDate((currentDate) => {
        const index = frames.findIndex((item) => item.date === currentDate);
        return frames[(index + 1) % frames.length]?.date ?? currentDate;
      });
      setCarbonLoading(true);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [activeProject, carbonManifest, carbonPlaying, carbonSector]);

  const togglePanel = useCallback((panel: NonNullable<ToolbarPanel>) => {
    setActivePanel((currentPanel) => currentPanel === panel ? null : panel);
  }, []);

  const fallbackEconomyBasemap = useCallback(() => {
    setEconomyMapTheme((key) => key === "nasa" ? "cartoDark" : key);
  }, []);

  const requestFocus = useCallback((center: Coordinates, zoom: number, pitch = 38, bearing = 0) => {
    setMapCamera({ center, zoom, pitch, bearing });
    setFocusNonce((nonce) => {
      const nextNonce = nonce + 1;
      setFocusRequest({ nonce: nextNonce, center, zoom, pitch, bearing });
      return nextNonce;
    });
  }, []);

  const flyToRegion = useCallback((target: RegionTarget) => {
    setFocusedRegion(target.id);
    requestFocus(target.center, target.zoom, target.pitch, target.bearing);
  }, [requestFocus]);

  const openGenerationView = useCallback(() => {
    const chinaRegion = regions.find((region) => region.id === "china");
    const chinaTarget = regionTargets.find((target) => target.id === "china") ?? chinaRegion;

    setOpenLegendSections(generationFocusLegendState());
    setVisibleTechnologies(hiddenTechnologyState());
    setVisibleLayers(hiddenLayerState());
    setVisibleVoltageClasses(hiddenVoltageState());
    setActiveRegion(chinaRegion ?? defaultRegion);
    setFocusedRegion(chinaTarget?.id ?? defaultRegion.id);
    setActiveMapTheme("cartoDark");
    setActiveSizeMin(null);
    if (!generationLoadStartedRef.current) {
      setGenerationLoading(true);
    }
    setGenerationHeatmapEnabled(true);
    setLabelSettings({
      ...initialLabelSettings,
      preset: "zoom-v2",
      showLabels: true,
      lineLabelSize: 96,
      provinceLabels: true,
      countryBorders: true,
      stateBorders: true,
    });
    setGenerationPlaying(false);
    setSelectedFeature(null);
    setCardsOpen(false);
    setActivePanel(null);
    if (chinaTarget) {
      requestFocus(chinaTarget.center, 3.75, 0, 0);
    }
    showToast("已切换到中国发电量热力图视图；其它图层已暂时隐藏，可手动重新打开。");
  }, [requestFocus, showToast]);

  const switchProject = useCallback((project: WorkspaceTopic) => {
    if (project === activeProject) return;
    const url = new URL(window.location.href);
    if (project === "power") url.searchParams.delete("topic");
    else url.searchParams.set("topic", project);
    window.history.replaceState(null, "", url);
    setActiveProject(project);
    setFocusedRegion(defaultRegion.id);
    setWeatherDocument(null);
    setSelectedFeature(null);
    setHoverTooltip(null);
    setCardsOpen(false);
    setActivePanel(null);
    setCinematic(false);

    if (project === "economy") {
      setGenerationPlaying(false);
      setCarbonPlaying(false);
      return;
    }

    if (project === "carbon") {
      setVisibleTechnologies(hiddenTechnologyState());
      setVisibleLayers(hiddenLayerState());
      setVisibleVoltageClasses(hiddenVoltageState());
      setVisibleSubstationClasses(hiddenVoltageState());
      setGenerationPlaying(false);
      setGenerationHeatmapEnabled(false);
      setCarbonPlaying(false);
      setCarbonLoading(!carbonFrame);
      setActiveRegion(defaultRegion);
      setActiveMapTheme("nasa");
      requestFocus(defaultRegion.center, defaultRegion.zoom, defaultRegion.pitch, defaultRegion.bearing);
      showToast("已切换到碳排放地球。");
      return;
    }

    if (project === "weather") {
      setVisibleTechnologies(hiddenTechnologyState());
      setVisibleLayers(hiddenLayerState());
      setVisibleVoltageClasses(hiddenVoltageState());
      setVisibleSubstationClasses(hiddenVoltageState());
      setGenerationPlaying(false);
      setGenerationHeatmapEnabled(false);
      setActiveRegion(defaultRegion);
      setActiveMapTheme("goes");
      requestFocus(defaultRegion.center, defaultRegion.zoom, 0, 0);
      showToast("已切换到 earth 原版气象项目。");
      return;
    }

    setActiveMapTheme("nasa");
    requestFocus(defaultRegion.center, defaultRegion.zoom, defaultRegion.pitch, defaultRegion.bearing);
    showToast("已切换回电源项目。");
  }, [activeProject, carbonFrame, requestFocus, showToast]);

  const regionStats = useMemo(() => {
    void databaseMapVersion;
    return getRegionStats(mapDataset, activeRegion.id, visibleTechnologies, activeSizeMin);
  }, [activeRegion.id, activeSizeMin, databaseMapVersion, visibleTechnologies]);

  const generationHeatmapData = useMemo(
    () => buildGenerationHeatmapData(generationSummary, generationFrame),
    [generationFrame, generationSummary],
  );
  const handleRegionHover = useCallback((regionId: RegionTargetId) => {
    setActiveRegion((current) => {
      if (current.id === regionId) {
        return current;
      }

      return regions.find((region) => region.id === regionId) ?? defaultRegion;
    });
  }, []);

  const selectFeature = useCallback((feature: SelectedFeature) => {
    setSelectedFeature(feature);
    requestFocus(feature.coordinates, feature.kind === "energy" ? 6.4 : 5.6, 42, -12);
  }, [requestFocus]);

  const toggleTechnology = (key: TechnologyKey) => {
    setVisibleTechnologies((state) => ({ ...state, [key]: !state[key] }));
  };

  const handleXiaoyunMapCommand = useCallback((message: string) => {
    const command = message.trim().replace(/[。！!]+$/, "").replace(/\s/g, "");
    const project = command.match(/^(?:请)?(?:切换到|切到|打开)(.+地球)$/)?.[1];
    const next = project === "碳地球" ? "carbon" : globeTopicOrder.find((topic) =>
      globeTopics[topic].title === project || globeTopics[topic].label === project);
    if (next) {
      switchProject(next);
      return `已打开${globeTopics[next].title}。`;
    }

    const layer = command.match(/^(?:请)?(打开|显示|关闭|隐藏)风电图层$/)?.[1];
    if (layer) {
      const enabled = layer === "打开" || layer === "显示";
      if (enabled && activeProject !== "power") switchProject("power");
      setVisibleTechnologies((state) => ({ ...state, wind: enabled }));
      return enabled ? "已打开电源地球的风电图层。" : "已关闭电源地球的风电图层。";
    }

    const place = command.match(/^(?:请)?(?:切换到|切到|定位到)([^，。！？,.!?]+?)(?:地图)?$/)?.[1];
    if (!place) return null;
    const target = regionTargets.find((item) => item.label === place);
    if (target) {
      flyToRegion(target);
      return `已将地图定位到${place}。`;
    }
    if (place === "广东" || place === "广东省") {
      requestFocus([113.26, 23.13], 6.2, 0, 0);
      return "已将地图定位到广东。";
    }
    if (place === "湖北" || place === "湖北省") {
      requestFocus([114.30, 30.59], 6.2, 0, 0);
      return "已将地图定位到湖北。";
    }
    return null;
  }, [activeProject, flyToRegion, requestFocus, switchProject]);

  const toggleTechnologyGroup = () => {
    const anyTechnologyVisible = technologies.some((item) => visibleTechnologies[item.key]);
    setVisibleTechnologies(anyTechnologyVisible ? hiddenTechnologyState() : technologyState());
  };

  const toggleGenerationHeatmap = () => {
    const nextEnabled = !generationHeatmapEnabled;
    setGenerationHeatmapEnabled(nextEnabled);
    if (nextEnabled) {
      if (!generationLoadStartedRef.current) {
        setGenerationLoading(true);
      }
      setOpenLegendSections((state) => ({ ...state, generation: true }));
    } else {
      setGenerationPlaying(false);
    }
  };

  const toggleLayer = (key: LayerKey) => {
    const enablingLayer = !visibleLayers[key];
    if (enablingLayer && key === "transmission") {
      if (!Object.values(visibleVoltageClasses).some(Boolean)) {
        setVisibleVoltageClasses(voltageState());
      }
    }
    if (enablingLayer && key === "substations" && !Object.values(visibleSubstationClasses).some(Boolean)) {
      setVisibleSubstationClasses(voltageState());
    }
    setVisibleLayers((state) => ({ ...state, [key]: !state[key] }));
  };

  const toggleLegendSection = (key: LegendSectionKey) => {
    setOpenLegendSections((state) => ({ ...state, [key]: !state[key] }));
  };

  const toggleCustomLayer = (key: CustomLayerKey) => {
    setVisibleCustomLayers((state) => ({ ...state, [key]: !state[key] }));
  };

  const toggleVoltage = (key: VoltageClass) => {
    setVisibleVoltageClasses((state) => ({ ...state, [key]: !state[key] }));
  };

  const toggleSubstation = (key: VoltageClass) => {
    setVisibleSubstationClasses((state) => ({ ...state, [key]: !state[key] }));
  };

  const toggleSourceLayer = (key: SourceLayerKey) => {
    setVisibleSourceLayers((state) => ({ ...state, [key]: !state[key] }));
  };

  const setAllSourceLayers = (enabled: boolean) => {
    setVisibleSourceLayers((state) => {
      return Object.keys(state).reduce((next, key) => {
        next[key as SourceLayerKey] = enabled;
        return next;
      }, {} as BooleanRecord<SourceLayerKey>);
    });
  };

  const resetAll = useCallback(() => {
    setVisibleTechnologies(hiddenTechnologyState());
    setVisibleLayers(hiddenLayerState());
    setVisibleCustomLayers({ customCorridor: false, customHeatmap: false });
    setOpenLegendSections(legendSectionState());
    setVisibleSourceLayers(sourceLayerState());
    setVisibleVoltageClasses(hiddenVoltageState());
    setVisibleSubstationClasses(hiddenVoltageState());
    setActiveRegion(defaultRegion);
    setActiveMapTheme("nasa");
    setActiveSizeMin(null);
    setGenerationFrame(defaultGenerationFrame);
    setGenerationPlaying(false);
    setGenerationHeatmapEnabled(false);
    setLabelSettings(initialLabelSettings);
    setSelectedFeature(null);
    setActivePanel(null);
    setCinematic(false);
    flyToRegion(defaultRegion);
    showToast("已恢复为基础地球视图，可从左侧手动开启业务图层。");
  }, [flyToRegion, showToast]);

  const applyCleanEnergyPreset = () => {
    const cleanTech: TechnologyKey[] = ["solar", "wind", "offshore", "storage", "pumped", "hydro", "nuclear", "geothermal", "biomass"];
    setVisibleTechnologies(
      technologies.reduce((state, item) => {
        state[item.key] = cleanTech.includes(item.key);
        return state;
      }, {} as BooleanRecord<TechnologyKey>),
    );
    setVisibleLayers((state) => ({ ...state, transmission: true, plannedUpgrades: true, gasPipelines: false }));
    setActiveSizeMin(null);
    flyToRegion(regionTargets[0]);
    showToast("已应用“清洁能源增长”预设。");
  };

  const applyPlannedPreset = () => {
    setVisibleLayers((state) => ({ ...state, plannedUpgrades: true, dataCenters: true, transmission: true, gasPipelines: true }));
    setVisibleTechnologies(
      technologies.reduce((state, item) => {
        state[item.key] = ["solar", "wind", "offshore", "storage", "gas"].includes(item.key);
        return state;
      }, {} as BooleanRecord<TechnologyKey>),
    );
    flyToRegion(regionTargets[0]);
    showToast("已应用“未来建设视图”预设。");
  };

  const shareMap = () => {
    const params = new URLSearchParams();
    if (activeProject !== "power") params.set("topic", activeProject);
    params.set("layers", Object.entries(visibleLayers).filter(([, enabled]) => enabled).map(([key]) => key).join(","));
    params.set("tech", Object.entries(visibleTechnologies).filter(([, enabled]) => enabled).map(([key]) => key).join(","));
    params.set("labels", labelSettings.preset);
    if (activeSizeMin) {
      params.set("minMw", String(activeSizeMin));
    }
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url);
      showToast("已复制包含当前筛选条件的分享链接。");
    } else {
      window.history.replaceState(null, "", url);
      showToast("地址栏中的分享 URL 已更新。");
    }
  };

  if (activeProject === "economy") {
    return (
      <main className="og-app-shell is-economy-project">
        <GlobeNavigation activeTopic={activeProject} onTopicChange={switchProject} />
        <EconomyWorkspace
          basemap={economyMapThemes.find(({ key }) => key === economyMapTheme) ?? defaultMapTheme}
          onBasemapError={fallbackEconomyBasemap}
        />
        <div className="og-layer-cards" aria-label="经济地球底图控制">
          <BasemapButton theme={economyMapTheme} expanded={activePanel === "mapType"} onClick={() => togglePanel("mapType")} />
        </div>
        {activePanel === "mapType" ? (
          <MapTypePanel
            themes={economyMapThemes}
            activeMapTheme={economyMapTheme}
            onTheme={setEconomyMapTheme}
            onClose={() => setActivePanel(null)}
          />
        ) : null}
      </main>
    );
  }

  const activeCleanEnergy = technologies
    .filter((item) => ["solar", "wind", "offshore", "storage"].includes(item.key))
    .some((item) => visibleTechnologies[item.key]);
  const activeGas = visibleTechnologies.gas || visibleLayers.gasPipelines;
  const activePlanned = visibleLayers.plannedUpgrades;
  const sidebarSummary = {
    power: `${activeRegion.label} · ${regionStats.totalPlants.toLocaleString()} 个可见项目`,
    weather: weatherScene === "globe" ? "全球风场与气象覆盖" : replayViews[weatherScene].title,
    carbon: "GRACED · 全球 0.1° 网格",
  }[activeProject];
  return (
    <main className={`og-app-shell ${cinematic ? "is-cinematic" : ""} ${activeProject === "weather" ? "is-earth-project" : ""} ${activeProject === "carbon" ? "is-carbon-project" : ""}`}>
      <GlobeNavigation activeTopic={activeProject} onTopicChange={switchProject} />
      {activeProject === "weather" ? (
        <>
          <div className="og-weather-original" hidden={weatherScene !== "globe"}>
            <EarthProjectViewport onLoad={setWeatherDocument} />
          </div>
          {weatherScene !== "globe" && (
            <div className="og-weather-replay-stage">
              <WeatherReplayPlayer query="" scene={weatherScene} />
            </div>
          )}
          <WeatherSceneSwitcher scene={weatherScene} onChange={setWeatherScene} />
        </>
      ) : (
        <MapViewport
          activeProject={activeProject}
          visibleTechnologies={visibleTechnologies}
          visibleLayers={visibleLayers}
          visibleCustomLayers={visibleCustomLayers}
          visibleSourceLayers={visibleSourceLayers}
          visibleVoltageClasses={visibleVoltageClasses}
          visibleSubstationClasses={visibleSubstationClasses}
          activeSizeMin={activeSizeMin}
          dataVersion={databaseMapVersion}
          activeMapTheme={activeMapTheme}
          bubbleScale={bubbleScale}
          hoveredLegend={hoveredLegend}
          labelSettings={labelSettings}
          generationHeatmapActive={generationHeatmapEnabled}
          generationHeatmapData={generationHeatmapData}
          generationFrame={generationFrame}
          weatherMetric={defaultWeatherMetric}
          weatherField={null}
          weatherWindField={null}
          weatherParticlesEnabled
          weatherHighDefinition={false}
          carbonFrame={carbonFrame}
          focusRequest={focusRequest}
          screenshotRequest={screenshotRequest}
          cinematic={cinematic}
          onSelectFeature={setSelectedFeature}
          onHoverTooltip={setHoverTooltip}
          onRegionHover={handleRegionHover}
          onCameraChange={setMapCamera}
          onScreenshotComplete={showToast}
        />
      )}
      {activeProject === "power" ? (
        <MobilePowerShortcuts
          activeGeneration={generationHeatmapEnabled}
          activeCleanEnergy={activeCleanEnergy}
          activeGas={activeGas}
          activePlanned={activePlanned}
          onGeneration={openGenerationView}
          onCleanEnergy={applyCleanEnergyPreset}
          onGas={() => {
            setVisibleTechnologies((state) => ({ ...state, gas: !state.gas }));
            setVisibleLayers((state) => ({ ...state, gasPipelines: !state.gasPipelines }));
          }}
          onPlanned={() => toggleLayer("plannedUpgrades")}
        />
      ) : null}
      <WorkspaceSidebar
        topic={activeProject}
        summary={sidebarSummary}
        onSearch={activeProject === "power" ? () => togglePanel("search") : undefined}
        leadingFilter={activeProject === "power" ? (
          <WorkspaceFilterSelect
            label="定位地区"
            options={regionTargets.map((target) => ({ value: target.id, label: target.label, disabled: !target.enabled }))}
            value={focusedRegion}
            onChange={(id) => {
              const target = regionTargets.find((region) => region.id === id);
              if (target) flyToRegion(target);
            }}
          />
        ) : null}
      >
        {activeProject === "power" ? (
          <PowerLegendPanel
            regionStats={regionStats}
            camera={mapCamera}
            bubbleScale={bubbleScale}
            visibleTechnologies={visibleTechnologies}
            visibleLayers={visibleLayers}
            visibleVoltageClasses={visibleVoltageClasses}
            visibleSubstationClasses={visibleSubstationClasses}
            activeSizeMin={activeSizeMin}
            openSections={openLegendSections}
            generationFrame={generationFrame}
            generationManifest={generationManifest}
            generationData={generationHeatmapData}
            generationLoading={generationLoading}
            generationError={generationError}
            generationPlaying={generationPlaying}
            generationHeatmapEnabled={generationHeatmapEnabled}
            onToggleSection={toggleLegendSection}
            onOpenGeneration={openGenerationView}
            onToggleGenerationHeatmap={toggleGenerationHeatmap}
            onGenerationPlayingChange={setGenerationPlaying}
            onGenerationFrameChange={setGenerationFrame}
            onToggleTechnology={toggleTechnology}
            onToggleTechnologyGroup={toggleTechnologyGroup}
            onToggleLayer={toggleLayer}
            onToggleVoltage={toggleVoltage}
            onToggleSubstation={toggleSubstation}
            onSizeFilter={setActiveSizeMin}
            onHover={setHoveredLegend}
          />
        ) : activeProject === "carbon" ? (
          <CarbonLegendPanel
            manifest={carbonManifest}
            activeDate={carbonDate}
            activeSector={carbonSector}
            frame={carbonFrame}
            loading={carbonLoading}
            error={carbonError}
            playing={carbonPlaying}
            onDateChange={(date) => {
              setCarbonLoading(true);
              setCarbonDate(date);
            }}
            onSectorChange={(sector) => {
              if (sector === carbonSector) return;
              const nextFrame = carbonManifest?.frames.filter((item) => item.sector === sector).at(-1);
              setCarbonLoading(Boolean(nextFrame));
              setCarbonSector(sector);
              setCarbonDate(nextFrame?.date ?? "");
            }}
            onPlayingChange={setCarbonPlaying}
          />
        ) : weatherScene === "globe" ? <WeatherSidebarFilters frameDocument={weatherDocument} /> : (
          <p className="og-weather-sidebar-status">{replayViews[weatherScene].description}</p>
        )}
      </WorkspaceSidebar>
      {activeProject !== "weather" ? (
        <TopToolbar
          activeProject={activeProject}
          activePanel={activePanel}
          cinematic={cinematic}
          onOpenPanel={togglePanel}
          onReset={resetAll}
          onCinematic={() => setCinematic((state) => !state)}
          onShare={shareMap}
          onScreenshot={() => setScreenshotRequest((request) => request + 1)}
          onCards={() => setCardsOpen((state) => !state)}
        />
      ) : null}
      {activePanel === "labels" ? (
        <LabelSettingsPanel settings={labelSettings} onChange={setLabelSettings} onClose={() => setActivePanel(null)} />
      ) : null}
      {activePanel === "globe" ? (
        <GlobeControlsPanel
          visibleSourceLayers={visibleSourceLayers}
          onToggleSourceLayer={toggleSourceLayer}
          onToggleAll={setAllSourceLayers}
          onFlyToRegion={flyToRegion}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "presets" && activeProject === "power" ? (
        <PresetViewsPanel
          onApplyCleanEnergy={applyCleanEnergyPreset}
          onApplyPlanned={applyPlannedPreset}
          onReset={resetAll}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "search" && activeProject === "power" ? (
        <SearchPanel
          query={searchQuery}
          onQuery={setSearchQuery}
          onSelect={(feature) => {
            selectFeature(feature);
            setActivePanel(null);
          }}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "layers" && activeProject === "power" ? (
        <LayersPanel
          visibleLayers={visibleLayers}
          onToggleLayer={toggleLayer}
          onLocked={(label) => showToast(`${label} 在当前演示版本中暂未开放。`)}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "customLayers" && activeProject === "power" ? (
        <CustomLayersPanel
          visibleCustomLayers={visibleCustomLayers}
          onToggleCustomLayer={toggleCustomLayer}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "mapType" ? (
        <MapTypePanel
          activeMapTheme={activeMapTheme}
          onTheme={(theme) => {
            setActiveMapTheme(theme);
            showToast(`已选择${mapThemes.find((item) => item.key === theme)?.label ?? "底图"}主题。`);
          }}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "sources" ? (
        <SourcesPanel onClose={() => setActivePanel(null)} />
      ) : null}
      <FeaturePopup feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
      {activeProject !== "weather" ? (
        <LayerCards
          activePanel={activePanel}
          activeMapTheme={activeMapTheme}
          onOpenPanel={togglePanel}
        />
      ) : null}
      {activeProject !== "weather" ? (
        <MiniMap
          selectedFeature={selectedFeature}
          camera={mapCamera}
          onMove={(center) => requestFocus(center, mapCamera.zoom, mapCamera.pitch, mapCamera.bearing)}
        />
      ) : null}
      {activeProject === "power" ? (
        <>
          <CardsDrawer open={cardsOpen} onClose={() => setCardsOpen(false)} onSelect={selectFeature} />
        </>
      ) : null}
      <HoverBubble tooltip={hoverTooltip} />
      <XiaoyunAssistant topic={activeProject === "weather" ? "meteo" : activeProject} onMapCommand={handleXiaoyunMapCommand} />
      <Toast message={toast} />
      {cinematic ? (
        <div className="og-cinematic-banner">
          <strong>沉浸视图</strong>
          <button type="button" onClick={() => setCinematic(false)}>退出</button>
        </div>
      ) : null}
      {activeProject !== "weather" ? (
        <div className="og-scale">
          <span>20mi</span>
          <span>50km</span>
        </div>
      ) : null}
      <span className="og-beta-badge">测试版</span>
      <button
        className={`og-info-button ${activePanel === "sources" ? "is-active" : ""}`}
        type="button"
        aria-label="切换数据来源"
        aria-pressed={activePanel === "sources"}
        onClick={() => setActivePanel(activePanel === "sources" ? null : "sources")}
      >
        <Info size={18} />
      </button>
      {activeProject === "power" ? (
        <MobileGenerationSheet
          open={openLegendSections.generation}
          heatmapEnabled={generationHeatmapEnabled}
          frame={generationFrame}
          manifest={generationManifest}
          data={generationHeatmapData}
          loading={generationLoading}
          error={generationError}
          playing={generationPlaying}
          onHeatmapToggle={toggleGenerationHeatmap}
          onPlayingChange={setGenerationPlaying}
          onFrameChange={setGenerationFrame}
        />
      ) : null}
    </main>
  );
}
