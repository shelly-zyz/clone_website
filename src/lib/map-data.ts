import type {
  DataCenterAsset,
  EnergyAsset,
  GasPipeline,
  GridLine,
  LandingPoint,
  LayerMeta,
  MapDataset,
  MapTheme,
  PlannedUpgrade,
  RegionMeta,
  RegionTarget,
  RegionTargetId,
  RegionStats,
  SourceLayerMeta,
  SubmarineCable,
  Substation,
  TechnologyMeta,
  TechnologyKey,
  VoltageMeta,
} from "@/types/opengridworks";
import {
  chinaDataCenters,
  chinaEnergyAssets,
  chinaGridLines,
  chinaSubstations,
} from "@/lib/china-map-data";

export const technologies: TechnologyMeta[] = [
  { key: "solar", label: "光伏", tone: "solar", color: "#fbbf24" },
  { key: "wind", label: "陆上风电", tone: "wind", color: "#00e5ff" },
  { key: "offshore", label: "海上风电", tone: "offshore", color: "#38bdf8" },
  { key: "storage", label: "储能", tone: "storage", color: "#ff007a" },
  { key: "pumped", label: "抽水蓄能", tone: "pumped", color: "#0891b2" },
  { key: "hydro", label: "水电", tone: "hydro", color: "#0ea5c0" },
  { key: "nuclear", label: "核电", tone: "nuclear", color: "#09ffbf" },
  { key: "gas", label: "燃气", tone: "gas", color: "#c084fc" },
  { key: "coal", label: "煤电", tone: "coal", color: "#94a3b8" },
  { key: "oil", label: "燃油", tone: "oil", color: "#fb7185" },
  { key: "geothermal", label: "地热", tone: "geothermal", color: "#2dd4bf" },
  { key: "biomass", label: "生物质", tone: "biomass", color: "#a3e635" },
  { key: "other", label: "其他", tone: "other", color: "#aab6c6" },
];

export const voltageClasses: VoltageMeta[] = [
  { key: "1000", label: "735kV+", tone: "tx-1000", minKv: 735, color: "#f8fafc" },
  { key: "750", label: "500-734kV", tone: "tx-750", minKv: 500, color: "#22d3ee" },
  { key: "500", label: "345-499kV", tone: "tx-500", minKv: 345, color: "#0ea5e9" },
  { key: "220", label: "230-344kV", tone: "tx-220", minKv: 230, color: "#3b82f6" },
  { key: "110", label: "100-229kV", tone: "tx-110", minKv: 100, color: "#6366f1" },
  { key: "35", label: "31-99kV", tone: "tx-35", minKv: 31, color: "#a855f7" },
  { key: "low", label: "<31kV", tone: "tx-low", minKv: 0, color: "#9333ea" },
];

export const layerGroups: LayerMeta[] = [
  { key: "dataCenters", label: "数据中心", tone: "data" },
  { key: "internetExchanges", label: "互联网交换中心", tone: "internet" },
  { key: "fiber", label: "光纤基础设施", tone: "fiber", experimental: true },
  { key: "transmission", label: "输电线路", tone: "transmission" },
  { key: "openInfraPower", label: "本地 OSM 电源项目", tone: "openinfra", experimental: true },
  { key: "substations", label: "变电站", tone: "substations" },
  { key: "plannedUpgrades", label: "规划升级项目", tone: "upgrades" },
  { key: "gasPipelines", label: "天然气管线", tone: "gas-pipeline" },
  { key: "submarineCables", label: "海底光缆", tone: "submarine" },
  { key: "landingPoints", label: "登陆点", tone: "landing" },
];

export const sourceLayers: SourceLayerMeta[] = [
  { key: "hifldSubs", label: "HIFLD 变电站（美国）", layerKind: "substation" },
  { key: "rowSubs", label: "ROW 变电站", layerKind: "substation" },
  { key: "osmSubs", label: "OSM 变电站（美国）", layerKind: "substation" },
];

export const regionTargets: RegionTarget[] = [
  { id: "global", code: "GL", label: "全球", center: [55, 24], zoom: 1.92, pitch: 0, bearing: 0, enabled: true },
  { id: "united-states", code: "US", label: "美国", center: [-96, 38], zoom: 4.15, pitch: 38, bearing: -18, enabled: true },
  { id: "canada", code: "CA", label: "加拿大", center: [-102, 56], zoom: 3.15, pitch: 32, bearing: -15, enabled: true },
  { id: "mexico", code: "MX", label: "墨西哥", center: [-102, 23], zoom: 4.35, pitch: 36, bearing: -18, enabled: true },
  { id: "france", code: "FR", label: "法国", center: [2.2, 46.6], zoom: 5.05, pitch: 36, bearing: -7, enabled: true },
  { id: "europe", code: "EU", label: "欧洲", center: [10, 49], zoom: 3.7, pitch: 34, bearing: 4, enabled: true },
  { id: "china", code: "CN", label: "中国", center: [104, 35], zoom: 3.9, pitch: 36, bearing: 14, enabled: true },
  { id: "india", code: "IN", label: "印度", center: [78, 22], zoom: 4.2, pitch: 38, bearing: 7, enabled: true },
  { id: "japan", code: "JP", label: "日本", center: [138, 37], zoom: 4.9, pitch: 42, bearing: 18, enabled: true },
];

export const regions: RegionMeta[] = [
  {
    ...regionTargets[0],
    countryCodes: [],
    bounds: [{ west: -180, south: -85, east: 180, north: 85 }],
  },
  {
    ...regionTargets[1],
    countryCodes: ["US"],
    bounds: [
      { west: -125.5, south: 24, east: -66.5, north: 49.7 },
      { west: -170, south: 51, east: -129, north: 72 },
      { west: -161, south: 18, east: -154, north: 23 },
    ],
  },
  {
    ...regionTargets[2],
    countryCodes: ["CA"],
    bounds: [{ west: -141.5, south: 41.7, east: -52, north: 83 }],
  },
  {
    ...regionTargets[3],
    countryCodes: ["MX"],
    bounds: [{ west: -118.8, south: 14, east: -86.5, north: 33.3 }],
  },
  {
    ...regionTargets[4],
    countryCodes: ["FR"],
    bounds: [{ west: -5.8, south: 41, east: 9.8, north: 51.5 }],
  },
  {
    ...regionTargets[5],
    countryCodes: ["FR", "GB", "DE", "IE", "NL", "BE", "ES", "IT", "DK", "NO", "SE"],
    bounds: [{ west: -12.5, south: 35, east: 31, north: 61.5 }],
  },
  {
    ...regionTargets[6],
    countryCodes: ["CN"],
    bounds: [{ west: 73, south: 18, east: 135.5, north: 53.8 }],
  },
  {
    ...regionTargets[7],
    countryCodes: ["IN"],
    bounds: [{ west: 68, south: 6, east: 97.5, north: 36.5 }],
  },
  {
    ...regionTargets[8],
    countryCodes: ["JP"],
    bounds: [{ west: 128.5, south: 30, east: 146, north: 46.5 }],
  },
];

export const mapThemes: MapTheme[] = [
  {
    key: "nasa",
    label: "NASA",
    description: "VIIRS 夜间灯光",
    tileUrls: [
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
    ],
    attribution: "NASA GIBS",
    background: "#020711",
    maxzoom: 8,
    rasterOpacity: 0.9,
    rasterSaturation: -0.2,
    rasterContrast: 0.12,
  },
  {
    key: "cartoDark",
    label: "Carto Dark",
    description: "暗色街道底图",
    tileUrls: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    attribution: "OpenStreetMap, CARTO",
    background: "#101821",
    rasterOpacity: 0.72,
    rasterSaturation: -0.35,
    rasterContrast: 0.2,
  },
  {
    key: "deepOcean",
    label: "深海",
    description: "低亮度海洋底图",
    tileUrls: ["https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"],
    attribution: "OpenStreetMap, CARTO",
    background: "#06131f",
    rasterOpacity: 0.62,
    rasterSaturation: -0.6,
    rasterContrast: 0.05,
    rasterBrightnessMin: 0.05,
    rasterBrightnessMax: 0.82,
  },
  {
    key: "eox",
    label: "EOX",
    description: "地形色调影像",
    tileUrls: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
    attribution: "EOX, ESA Copernicus",
    background: "#0a1712",
    rasterOpacity: 0.64,
    rasterSaturation: -0.2,
    rasterContrast: 0.16,
  },
  {
    key: "satellite",
    label: "卫星影像",
    description: "突出遥感影像",
    tileUrls: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri World Imagery, Esri, Maxar, Earthstar Geographics",
    background: "#07110f",
    maxzoom: 19,
    rasterOpacity: 1,
    rasterSaturation: 0,
    rasterContrast: 0.18,
  },
  {
    key: "goes",
    label: "GOES / Himawari",
    description: "气象卫星质感",
    tileUrls: ["https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"],
    attribution: "OpenStreetMap, CARTO",
    background: "#07111e",
    rasterOpacity: 0.62,
    rasterSaturation: -0.7,
    rasterContrast: 0.34,
  },
  {
    key: "black",
    label: "纯黑高对比",
    description: "最高对比度",
    tileUrls: ["https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"],
    attribution: "OpenStreetMap, CARTO",
    background: "#020409",
    rasterOpacity: 0.42,
    rasterSaturation: -1,
    rasterContrast: 0.6,
    rasterBrightnessMin: 0,
    rasterBrightnessMax: 0.62,
  },
];

export const energyAssets: EnergyAsset[] = [
  ...chinaEnergyAssets,
];

export const dataCenters: DataCenterAsset[] = [
  ...chinaDataCenters,
];

export const gridLines: GridLine[] = [
  ...chinaGridLines,
];

export const substations: Substation[] = [
  ...chinaSubstations,
];

export const plannedUpgrades: PlannedUpgrade[] = [];

export const gasPipelines: GasPipeline[] = [];

export const submarineCables: SubmarineCable[] = [];

export const landingPoints: LandingPoint[] = [];

export const sizeBreakpoints = [
  { label: "5GW", minMw: 5000 },
  { label: "2.5GW", minMw: 2500 },
  { label: "1GW", minMw: 1000 },
  { label: "500MW", minMw: 500 },
  { label: "100MW", minMw: 100 },
];

const technologyKeys = technologies.map((technology) => technology.key);

function containsCoordinate(region: RegionMeta, lng: number, lat: number) {
  return region.bounds.some((bounds) => (
    lng >= bounds.west
    && lng <= bounds.east
    && lat >= bounds.south
    && lat <= bounds.north
  ));
}

export function capacityToRadius(capacityMw: number, bubbleScale = 1) {
  if (capacityMw >= 5000) {
    return 42 * bubbleScale;
  }

  if (capacityMw >= 2500) {
    return 33 * bubbleScale;
  }

  if (capacityMw >= 1000) {
    return 25 * bubbleScale;
  }

  if (capacityMw >= 500) {
    return 17 * bubbleScale;
  }

  if (capacityMw >= 100) {
    return 10 * bubbleScale;
  }

  return 6 * bubbleScale;
}

export function getRegionForCoordinates(lng: number, lat: number) {
  return regions.slice(1).find((region) => containsCoordinate(region, lng, lat)) ?? regions[0];
}

export function getRegionForCountryCode(countryCode: string) {
  return regions.slice(1).find((region) => region.countryCodes.includes(countryCode)) ?? regions[0];
}

function regionMatchesCountry(region: RegionMeta, countryCode: string) {
  if (region.id === "global") {
    return true;
  }

  if (countryCode === "EU" && region.id === "europe") {
    return true;
  }

  return region.countryCodes.includes(countryCode);
}

export function getRegionStats(
  dataset: MapDataset,
  regionId: RegionTargetId,
  visibleTechnologies: Partial<Record<TechnologyKey, boolean>>,
  activeSizeMin: number | null,
): RegionStats {
  const region = dataset.regions.find((item) => item.id === regionId) ?? dataset.regions[0];
  const assets = dataset.energyAssets
    .filter((asset) => regionMatchesCountry(region, asset.countryCode))
    .filter((asset) => visibleTechnologies[asset.technology] !== false)
    .filter((asset) => activeSizeMin === null || asset.capacityMw >= activeSizeMin);

  const byTechnology = technologyKeys.reduce((stats, key) => {
    const matchingAssets = assets.filter((asset) => asset.technology === key);
    stats[key] = {
      count: matchingAssets.length,
      capacityMw: matchingAssets.reduce((sum, asset) => sum + asset.capacityMw, 0),
    };
    return stats;
  }, {} as RegionStats["byTechnology"]);

  return {
    region,
    totalPlants: assets.length,
    totalCapacityMw: assets.reduce((sum, asset) => sum + asset.capacityMw, 0),
    byTechnology,
  };
}

export function getMapDataset(): MapDataset {
  return {
    regions,
    regionTargets,
    technologies,
    voltageClasses,
    layerGroups,
    sourceLayers,
    energyAssets,
    dataCenters,
    gridLines,
    substations,
    plannedUpgrades,
    gasPipelines,
    submarineCables,
    landingPoints,
    mapThemes,
    sizeBreakpoints,
  };
}
