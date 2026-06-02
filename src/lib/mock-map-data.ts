import type {
  Coordinates,
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
  VoltageClass,
  VoltageMeta,
} from "@/types/opengridworks";
import {
  chinaDataCenters,
  chinaEnergyAssets,
  chinaGridLines,
  chinaSubstations,
} from "@/lib/china-map-data";
import countryCenters from "@/lib/country-centers.generated.json";

type CountryCenter = {
  code: string;
  name: string;
  continent: string;
  subregion: string;
  pop: number;
  center: [number, number];
  bbox: [number, number, number, number];
};

type GlobalMockInfrastructure = {
  energyAssets: EnergyAsset[];
  dataCenters: DataCenterAsset[];
  substations: Substation[];
  submarineCables: SubmarineCable[];
  landingPoints: LandingPoint[];
};

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

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(4));
}

function voltageClassForKv(voltageKv: number): VoltageClass {
  return voltageClasses.find((item) => voltageKv >= item.minKv)?.key ?? "low";
}

function regionIdForCountry(countryCode: string): RegionTargetId | undefined {
  return getRegionForCountryCode(countryCode).id;
}

function countryPoint(country: CountryCenter, random: () => number, spread = 0.42): Coordinates {
  const [west, south, east, north] = country.bbox;
  const [lng, lat] = country.center;
  const width = clamp((east - west) * spread, 0.35, country.continent === "Oceania" ? 5.5 : 9);
  const height = clamp((north - south) * spread, 0.28, country.continent === "Oceania" ? 4.2 : 6.5);
  const nextLng = clamp(lng + (random() - 0.5) * width, west + 0.08, east - 0.08);
  const nextLat = clamp(lat + (random() - 0.5) * height, south + 0.08, north - 0.08);
  return [roundCoordinate(nextLng), roundCoordinate(nextLat)];
}

function arcCoordinates(start: Coordinates, end: Coordinates, steps = 8): Coordinates[] {
  const [startLng, startLat] = start;
  let [endLng] = end;
  const [, endLat] = end;
  const lngDelta = endLng - startLng;
  if (lngDelta > 180) {
    endLng -= 360;
  } else if (lngDelta < -180) {
    endLng += 360;
  }

  const distance = Math.hypot(endLng - startLng, endLat - startLat);
  const lift = clamp(distance * 0.08, 0.5, 8);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    let lng = startLng + (endLng - startLng) * t;
    if (lng < -180) {
      lng += 360;
    } else if (lng > 180) {
      lng -= 360;
    }
    const lat = startLat + (endLat - startLat) * t + Math.sin(Math.PI * t) * lift * Math.sign(startLat + endLat || 1);
    return [roundCoordinate(lng), roundCoordinate(clamp(lat, -72, 78))];
  });
}

function technologyForCountry(country: CountryCenter, random: () => number): TechnologyKey {
  const lat = Math.abs(country.center[1]);
  const coastal = /Caribbean|Oceania|Western Europe|Eastern Asia|South-Eastern Asia|Northern Europe/i.test(`${country.subregion} ${country.continent}`);
  const options: TechnologyKey[] = [
    "solar",
    "wind",
    "hydro",
    "gas",
    "coal",
    "storage",
    lat < 38 ? "solar" : "wind",
    coastal ? "offshore" : "pumped",
    country.pop > 30_000_000 ? "nuclear" : "biomass",
    country.continent === "Africa" ? "solar" : "geothermal",
  ];
  return pick(options, random);
}

function capacityForTechnology(technology: TechnologyKey, random: () => number) {
  const ranges: Record<TechnologyKey, [number, number]> = {
    solar: [80, 2400],
    wind: [90, 1800],
    offshore: [350, 3600],
    storage: [40, 900],
    pumped: [300, 2200],
    hydro: [120, 4000],
    nuclear: [900, 6200],
    gas: [160, 2200],
    coal: [300, 4200],
    oil: [40, 600],
    geothermal: [35, 420],
    biomass: [20, 260],
    other: [20, 180],
  };
  const [min, max] = ranges[technology];
  return Math.round(min + Math.pow(random(), 1.65) * (max - min));
}

function generateGlobalMockInfrastructure(seed: string): GlobalMockInfrastructure {
  const centers = countryCenters as CountryCenter[];
  const countries = centers.filter((country) => country.code !== "CHN" && country.code !== "ATA");
  const byCode = new Map(centers.map((country) => [country.code, country]));
  const energyAssets: EnergyAsset[] = [];
  const dataCenters: DataCenterAsset[] = [];
  const substations: Substation[] = [];
  const submarineCables: SubmarineCable[] = [];
  const landingPoints: LandingPoint[] = [];

  countries.forEach((country) => {
    const random = seededRandom(`${seed}:${country.code}`);
    const countrySlug = country.code.toLowerCase();
    const largeCountry = country.pop > 40_000_000 || (country.bbox[2] - country.bbox[0]) * (country.bbox[3] - country.bbox[1]) > 350;
    const assetCount = largeCountry ? 5 : country.pop > 8_000_000 ? 3 : 2;
    const hubCount = largeCountry ? 5 : 3;
    const hubs = Array.from({ length: hubCount }, () => countryPoint(country, random, largeCountry ? 0.62 : 0.42));
    const regionId = regionIdForCountry(country.code);

    hubs.forEach(([lng, lat], index) => {
      const voltageKv = pick([765, 500, 400, 345, 230, 138, 69], random);
      substations.push({
        id: `global-sub-${countrySlug}-${index + 1}`,
        name: `${country.name} ${voltageKv}kV Hub ${index + 1}`,
        voltageKv,
        voltageClass: voltageClassForKv(voltageKv),
        sourceLayer: index % 2 === 0 ? "rowSubs" : "osmSubs",
        countryCode: country.code,
        regionId,
        lat,
        lng,
      });
    });

    for (let index = 0; index < assetCount; index += 1) {
      const [lng, lat] = countryPoint(country, random, largeCountry ? 0.72 : 0.5);
      const technology = technologyForCountry(country, random);
      energyAssets.push({
        id: `global-plant-${countrySlug}-${index + 1}`,
        name: `${country.name} ${technologies.find((item) => item.key === technology)?.label ?? "Energy"} ${index + 1}`,
        technology,
        capacityMw: capacityForTechnology(technology, random),
        status: random() > 0.18 ? "Operating" : random() > 0.5 ? "Construction" : "Planned",
        countryCode: country.code,
        regionId,
        source: "Seeded global mock",
        lat,
        lng,
      });
    }

    const dcCount = country.pop > 50_000_000 ? 2 : 1;
    for (let index = 0; index < dcCount; index += 1) {
      const [lng, lat] = countryPoint(country, random, 0.36);
      dataCenters.push({
        id: `global-dc-${countrySlug}-${index + 1}`,
        name: `${country.name} ${index === 0 ? "Compute Exchange" : "AI Campus"}`,
        kind: index === 0 && random() > 0.54 ? "internet-exchange" : "data-center",
        operator: index === 0 ? "Mock PeeringDB" : "DemoCloud",
        capacityMw: Math.round(30 + random() * (country.pop > 60_000_000 ? 720 : 260)),
        countryCode: country.code,
        regionId,
        source: "Seeded global mock",
        lat,
        lng,
      });
    }
  });

  const cableRoutes = [
    { id: "global-cable-atlantic-ring", name: "Atlantic Compute Ring", operator: "Mock TeleGeography", countries: ["USA", "ISL", "IRL", "GBR", "FRA", "PRT"], lengthKm: 9800 },
    { id: "global-cable-med-india", name: "Mediterranean India Express", operator: "Mock TeleGeography", countries: ["ESP", "ITA", "GRC", "EGY", "SAU", "IND"], lengthKm: 11200 },
    { id: "global-cable-east-africa", name: "East Africa Cloud Coast", operator: "Mock TeleGeography", countries: ["ZAF", "MOZ", "TZA", "KEN", "SOM", "OMN"], lengthKm: 7400 },
    { id: "global-cable-pacific-ai", name: "Pacific AI Mesh", operator: "Mock TeleGeography", countries: ["JPN", "PHL", "IDN", "AUS", "NZL", "USA"], lengthKm: 18200 },
  ];

  cableRoutes.forEach((route) => {
    const countriesInRoute = route.countries.map((code) => byCode.get(code)).filter((country): country is CountryCenter => Boolean(country));
    const coordinates = countriesInRoute.flatMap((country, index) => {
      if (index === 0) {
        return [country.center];
      }
      return arcCoordinates(countriesInRoute[index - 1].center, country.center, 12).slice(1);
    });
    submarineCables.push({
      id: route.id,
      name: route.name,
      operator: route.operator,
      source: "Seeded global mock",
      lengthKm: route.lengthKm,
      readyForService: "2028 planned",
      regionId: "global",
      coordinates,
    });
    countriesInRoute.forEach((country) => {
      landingPoints.push({
        id: `landing-${route.id}-${country.code.toLowerCase()}`,
        name: `${country.name} landing`,
        cableId: route.id,
        countryCode: country.code,
        regionId: regionIdForCountry(country.code),
        lat: country.center[1],
        lng: country.center[0],
      });
    });
  });

  return { energyAssets, dataCenters, substations, submarineCables, landingPoints };
}

const globalMockInfrastructure = generateGlobalMockInfrastructure("ogw-global-v3");

export const energyAssets: EnergyAsset[] = [
  { id: "plant-sand-prairie", name: "Sand Prairie Solar", technology: "solar", capacityMw: 2, status: "Operating", countryCode: "US", source: "EIA 860M", lat: 40.1, lng: -89.2 },
  { id: "plant-powerton", name: "Powerton", technology: "coal", capacityMw: 1786, status: "Operating", countryCode: "US", source: "EIA 860", lat: 40.54, lng: -89.65 },
  { id: "plant-glacier-sands", name: "Glacier Sands Wind Power", technology: "wind", capacityMw: 185, status: "Operating", countryCode: "US", source: "EIA 860M", lat: 41.7, lng: -90.6 },
  { id: "plant-moraine-storage", name: "Moraine Storage", technology: "storage", capacityMw: 420, status: "Construction", countryCode: "US", source: "Demo pipeline", lat: 39.88, lng: -86.2 },
  { id: "plant-sunzia", name: "SunZia Wind", technology: "wind", capacityMw: 3500, status: "Construction", countryCode: "US", source: "Demo queue", lat: 34.7, lng: -106.1 },
  { id: "plant-vogtle", name: "Vogtle Units 3-4", technology: "nuclear", capacityMw: 2200, status: "Operating", countryCode: "US", source: "Demo nuclear", lat: 33.14, lng: -81.76 },
  { id: "plant-diablo", name: "Diablo Canyon", technology: "nuclear", capacityMw: 2240, status: "Operating", countryCode: "US", source: "Demo nuclear", lat: 35.21, lng: -120.86 },
  { id: "plant-mackenzie", name: "Mackenzie Hydro", technology: "hydro", capacityMw: 920, status: "Operating", countryCode: "CA", source: "Demo hydro", lat: 55.34, lng: -123.1 },
  { id: "plant-alberta-gas", name: "Prairie Gas Complex", technology: "gas", capacityMw: 1470, status: "Operating", countryCode: "CA", source: "Demo thermal", lat: 53.2, lng: -113.6 },
  { id: "plant-baja-solar", name: "Baja Solar Norte", technology: "solar", capacityMw: 610, status: "Operating", countryCode: "MX", source: "Demo solar", lat: 30.2, lng: -115.1 },
  { id: "plant-lauragais-solar", name: "Lauragais Solar", technology: "solar", capacityMw: 370, status: "Operating", countryCode: "FR", source: "Demo France", lat: 43.6, lng: 1.8 },
  { id: "plant-brittany-wind", name: "Brittany Wind Cluster", technology: "wind", capacityMw: 220, status: "Operating", countryCode: "FR", source: "Demo France", lat: 48.2, lng: -2.8 },
  { id: "plant-flamanville", name: "Flamanville Nuclear", technology: "nuclear", capacityMw: 4080, status: "Operating", countryCode: "FR", source: "Demo France", lat: 49.53, lng: -1.88 },
  { id: "plant-grand-maison", name: "Grand'Maison Pumped Storage", technology: "pumped", capacityMw: 1800, status: "Operating", countryCode: "FR", source: "Demo France", lat: 45.13, lng: 6.05 },
  { id: "plant-rhone-hydro", name: "Rhone Hydro Chain", technology: "hydro", capacityMw: 620, status: "Operating", countryCode: "FR", source: "Demo France", lat: 44.1, lng: 4.8 },
  { id: "plant-dunkerque-battery", name: "Dunkerque Battery Hub", technology: "storage", capacityMw: 520, status: "Construction", countryCode: "FR", source: "Demo France", lat: 51.03, lng: 2.37 },
  { id: "plant-dogger-bank", name: "Dogger Bank Offshore", technology: "offshore", capacityMw: 3600, status: "Construction", countryCode: "GB", source: "Demo offshore", lat: 54.8, lng: 1.8 },
  { id: "plant-north-sea-store", name: "North Sea Battery Hub", technology: "storage", capacityMw: 740, status: "Planned", countryCode: "DE", source: "Demo storage", lat: 53.55, lng: 8.6 },
  ...chinaEnergyAssets,
  { id: "plant-gujarat-solar", name: "Gujarat Solar Park", technology: "solar", capacityMw: 1900, status: "Operating", countryCode: "IN", source: "Demo solar", lat: 23.65, lng: 71.2 },
  { id: "plant-tamil-wind", name: "Tamil Nadu Wind Cluster", technology: "wind", capacityMw: 980, status: "Operating", countryCode: "IN", source: "Demo wind", lat: 9.2, lng: 77.8 },
  { id: "plant-kashiwazaki", name: "Kashiwazaki-Kariwa", technology: "nuclear", capacityMw: 8212, status: "Planned", countryCode: "JP", source: "Demo nuclear", lat: 37.43, lng: 138.6 },
  { id: "plant-kyushu-geothermal", name: "Kyushu Geothermal", technology: "geothermal", capacityMw: 120, status: "Operating", countryCode: "JP", source: "Demo geothermal", lat: 32.88, lng: 130.86 },
  { id: "plant-biomass-iowa", name: "Cedar Biomass", technology: "biomass", capacityMw: 74, status: "Operating", countryCode: "US", source: "Demo biomass", lat: 42.05, lng: -91.62 },
  { id: "plant-offshore-jersey", name: "Atlantic Shores", technology: "offshore", capacityMw: 1510, status: "Permitting", countryCode: "US", source: "Demo offshore", lat: 39.2, lng: -73.4 },
  { id: "plant-oil-gulf", name: "Gulf Peaker Oil", technology: "oil", capacityMw: 210, status: "Operating", countryCode: "US", source: "Demo thermal", lat: 29.72, lng: -95.0 },
  { id: "plant-pumped-blue", name: "Blue Ridge Pumped Storage", technology: "pumped", capacityMw: 1210, status: "Operating", countryCode: "US", source: "Demo hydro", lat: 37.35, lng: -79.1 },
  { id: "plant-other-grid-forming", name: "Grid Forming Pilot", technology: "other", capacityMw: 56, status: "Planned", countryCode: "US", source: "Demo pilot", lat: 36.1, lng: -115.0 },
  ...generateDenseEnergyAssets(),
  ...globalMockInfrastructure.energyAssets,
];

export const dataCenters: DataCenterAsset[] = [
  { id: "dc-ashburn", name: "Ashburn Campus", kind: "data-center", operator: "DemoCloud", capacityMw: 650, countryCode: "US", source: "IM3/PNNL", lat: 39.04, lng: -77.48 },
  { id: "dc-columbus", name: "Columbus AI Campus", kind: "data-center", operator: "Epoch Demo", capacityMw: 420, countryCode: "US", source: "Epoch AI", lat: 39.98, lng: -82.98 },
  { id: "dc-phoenix", name: "Phoenix West Campus", kind: "data-center", operator: "DemoCloud", capacityMw: 360, countryCode: "US", source: "IM3/PNNL", lat: 33.45, lng: -112.07 },
  { id: "dc-montreal", name: "Montreal Exchange", kind: "internet-exchange", operator: "PeeringDB", capacityMw: 55, countryCode: "CA", source: "PeeringDB", lat: 45.5, lng: -73.56 },
  { id: "dc-paris", name: "Paris North Compute", kind: "data-center", operator: "DemoCloud", capacityMw: 260, countryCode: "FR", source: "Demo centers", lat: 48.96, lng: 2.35 },
  { id: "dc-marseille", name: "Marseille IX", kind: "internet-exchange", operator: "PeeringDB", capacityMw: 48, countryCode: "FR", source: "PeeringDB", lat: 43.3, lng: 5.38 },
  { id: "dc-frankfurt", name: "Frankfurt Interconnect", kind: "internet-exchange", operator: "PeeringDB", capacityMw: 85, countryCode: "DE", source: "PeeringDB", lat: 50.11, lng: 8.68 },
  { id: "dc-dublin", name: "Dublin Cloud Ring", kind: "data-center", operator: "DemoCloud", capacityMw: 210, countryCode: "IE", source: "Demo centers", lat: 53.35, lng: -6.26 },
  ...chinaDataCenters,
  { id: "dc-mumbai", name: "Mumbai IX", kind: "internet-exchange", operator: "PeeringDB", capacityMw: 70, countryCode: "IN", source: "PeeringDB", lat: 19.08, lng: 72.88 },
  { id: "dc-tokyo", name: "Tokyo Bay Compute", kind: "data-center", operator: "DemoCloud", capacityMw: 310, countryCode: "JP", source: "Demo centers", lat: 35.67, lng: 139.78 },
  ...generateDenseDataCenters(),
  ...globalMockInfrastructure.dataCenters,
];

export const gridLines: GridLine[] = [
  ...chinaGridLines,
];

export const substations: Substation[] = [
  { id: "sub-illinois-500", name: "Illinois River 500", voltageClass: "500", sourceLayer: "hifldSubs", lat: 40.9, lng: -89.1 },
  { id: "sub-ohio-765", name: "Ohio Valley 765", voltageClass: "750", sourceLayer: "hifldSubs", lat: 39.7, lng: -82.6 },
  { id: "sub-virginia-230", name: "Loudoun 230", voltageClass: "220", sourceLayer: "osmSubs", lat: 39.03, lng: -77.45 },
  { id: "sub-arizona-500", name: "Palo Verde 500", voltageClass: "500", sourceLayer: "hifldSubs", lat: 33.38, lng: -112.86 },
  { id: "sub-georgia-345", name: "Vogtle 345", voltageClass: "220", sourceLayer: "hifldSubs", lat: 33.15, lng: -81.75 },
  { id: "sub-alberta-230", name: "Edmonton 230", voltageClass: "220", sourceLayer: "rowSubs", lat: 53.52, lng: -113.42 },
  { id: "sub-frankfurt-400", name: "Frankfurt 400", voltageClass: "220", sourceLayer: "rowSubs", lat: 50.08, lng: 8.71 },
  { id: "sub-paris-400", name: "Paris Ring 400", voltageClass: "220", sourceLayer: "rowSubs", lat: 48.86, lng: 2.27 },
  { id: "sub-lyon-225", name: "Lyon 225", voltageClass: "220", sourceLayer: "rowSubs", lat: 45.76, lng: 4.84 },
  ...chinaSubstations,
  { id: "sub-tokyo-500", name: "Tokyo East 500", voltageClass: "500", sourceLayer: "rowSubs", lat: 35.75, lng: 140.1 },
  { id: "sub-local-69", name: "Peoria 69", voltageClass: "35", sourceLayer: "osmSubs", lat: 40.72, lng: -89.58 },
  { id: "sub-rural-low", name: "Rural Feeder", voltageClass: "low", sourceLayer: "osmSubs", lat: 38.91, lng: -90.18 },
  ...globalMockInfrastructure.substations,
];

export const plannedUpgrades: PlannedUpgrade[] = [
  { id: "upgrade-grain-belt", name: "Grain Belt Express", stage: "Construction", countryCode: "US", source: "OGF", coordinates: [[-101.7, 38.7], [-97.6, 39.0], [-94.1, 39.2], [-90.2, 38.9], [-86.8, 39.3]] },
  { id: "upgrade-atlantic-offshore", name: "Atlantic Offshore Collector", stage: "Permitting", countryCode: "US", source: "OGF", coordinates: [[-74.4, 40.0], [-73.5, 39.2], [-73.4, 38.2], [-74.2, 37.5]] },
  { id: "upgrade-europe-hvdc", name: "North Sea HVDC Expansion", stage: "Engineering", countryCode: "EU", source: "OGF", coordinates: [[1.2, 54.4], [4.2, 53.9], [7.6, 54.7]] },
  { id: "upgrade-france-med", name: "Mediterranean Flex Link", stage: "Planning", countryCode: "FR", source: "OGF", coordinates: [[2.2, 43.5], [4.7, 43.7], [6.5, 43.3]] },
  { id: "upgrade-japan-offshore", name: "Japan Offshore Grid", stage: "Conceptual", countryCode: "JP", source: "OGF", coordinates: [[136.6, 36.8], [138.8, 37.6], [141.0, 39.2]] },
];

export const gasPipelines: GasPipeline[] = [
  { id: "pipe-midwest-interstate", name: "Midwest Interstate Gas", kind: "Interstate", source: "Demo gas", coordinates: [[-99.4, 35.5], [-96.0, 36.2], [-92.3, 37.0], [-88.2, 38.5]] },
  { id: "pipe-appalachian", name: "Appalachian Intrastate", kind: "Intrastate", source: "Demo gas", coordinates: [[-82.7, 38.1], [-80.6, 39.2], [-78.8, 40.0]] },
  { id: "pipe-west-canada", name: "Western Canada Gas", kind: "Interstate", source: "Demo gas", coordinates: [[-120.0, 53.4], [-114.0, 53.8], [-107.5, 52.7], [-101.2, 51.2]] },
];

export const submarineCables: SubmarineCable[] = [
  { id: "cable-pc1", name: "Pacific Crossing-1 (PC-1)", operator: "Pacific Crossing", source: "TeleGeography", lengthKm: 21000, readyForService: "1999 December", coordinates: [[140.7, 36.4], [156.0, 43.2], [178.0, 47.0], [-158.0, 45.0], [-132.0, 43.3], [-124.4, 46.0], [-120.6, 35.1]] },
  { id: "cable-brusa", name: "BRUSA", operator: "Telxius", source: "TeleGeography", lengthKm: 11000, readyForService: "2018 August", coordinates: [[-75.98, 36.85], [-69.8, 30.2], [-66.1, 18.47], [-52.4, 7.4], [-38.52, -3.73], [-43.17, -22.91]] },
  { id: "cable-atlantic-ai", name: "Atlantic AI Express", operator: "Demo Fiber", source: "Demo cable", lengthKm: 6400, readyForService: "2028 planned", coordinates: [[-74.0, 40.7], [-48.0, 47.5], [-20.0, 51.8], [-6.3, 53.3]] },
  ...globalMockInfrastructure.submarineCables,
];

export const landingPoints: LandingPoint[] = [
  { id: "landing-ajigaura", name: "Ajigaura, Japan", cableId: "cable-pc1", countryCode: "JP", lat: 36.4, lng: 140.62 },
  { id: "landing-shima", name: "Shima, Japan", cableId: "cable-pc1", countryCode: "JP", lat: 34.33, lng: 136.82 },
  { id: "landing-grover", name: "Grover Beach, CA", cableId: "cable-pc1", countryCode: "US", lat: 35.12, lng: -120.62 },
  { id: "landing-harbour", name: "Harbour Pointe, WA", cableId: "cable-pc1", countryCode: "US", lat: 47.89, lng: -122.31 },
  { id: "landing-brusa-virginia-beach", name: "Virginia Beach, VA, United States", cableId: "cable-brusa", countryCode: "US", lat: 36.85, lng: -75.98 },
  { id: "landing-brusa-san-juan", name: "San Juan, PR, United States", cableId: "cable-brusa", countryCode: "US", lat: 18.47, lng: -66.1 },
  { id: "landing-brusa-fortaleza", name: "Fortaleza, Brazil", cableId: "cable-brusa", countryCode: "BR", lat: -3.73, lng: -38.52 },
  { id: "landing-brusa-rio", name: "Rio de Janeiro, Brazil", cableId: "cable-brusa", countryCode: "BR", lat: -22.91, lng: -43.17 },
  { id: "landing-new-york", name: "New York, NY", cableId: "cable-atlantic-ai", countryCode: "US", lat: 40.71, lng: -74.0 },
  { id: "landing-dublin", name: "Dublin, Ireland", cableId: "cable-atlantic-ai", countryCode: "IE", lat: 53.35, lng: -6.26 },
  ...globalMockInfrastructure.landingPoints,
];

function generateDenseEnergyAssets(): EnergyAsset[] {
  const rows: Omit<EnergyAsset, "id" | "source">[] = [
    { name: "Midland Cogeneration", technology: "gas", capacityMw: 1620, status: "Operating", countryCode: "US", lat: 43.62, lng: -84.23 },
    { name: "Belle River", technology: "coal", capacityMw: 1395, status: "Operating", countryCode: "US", lat: 42.78, lng: -82.48 },
    { name: "St. Clair Energy Centre", technology: "gas", capacityMw: 292, status: "Operating", countryCode: "CA", lat: 42.93, lng: -82.41 },
    { name: "Greenwood Wind", technology: "wind", capacityMw: 270, status: "Operating", countryCode: "US", lat: 43.05, lng: -82.62 },
    { name: "Walpole Island Solar", technology: "solar", capacityMw: 217, status: "Operating", countryCode: "CA", lat: 42.62, lng: -82.48 },
    { name: "Liquid Web DC3 Flex", technology: "storage", capacityMw: 486, status: "Construction", countryCode: "US", lat: 42.73, lng: -84.55 },
    { name: "Ottawa River Hydro", technology: "hydro", capacityMw: 1040, status: "Operating", countryCode: "CA", lat: 45.41, lng: -75.72 },
    { name: "Virginia Solar East", technology: "solar", capacityMw: 860, status: "Operating", countryCode: "US", lat: 37.72, lng: -77.3 },
    { name: "Ohio Battery Stack", technology: "storage", capacityMw: 640, status: "Planned", countryCode: "US", lat: 40.05, lng: -82.92 },
    { name: "Indiana Wind North", technology: "wind", capacityMw: 510, status: "Operating", countryCode: "US", lat: 40.86, lng: -86.7 },
    { name: "Normandy Offshore Landing", technology: "offshore", capacityMw: 980, status: "Permitting", countryCode: "FR", lat: 49.45, lng: -1.2 },
    { name: "Loire Battery Reserve", technology: "storage", capacityMw: 315, status: "Operating", countryCode: "FR", lat: 47.2, lng: 0.7 },
    { name: "Rhine Gas Flex", technology: "gas", capacityMw: 700, status: "Operating", countryCode: "DE", lat: 50.4, lng: 7.1 },
    { name: "Rajasthan Solar", technology: "solar", capacityMw: 2500, status: "Operating", countryCode: "IN", lat: 27.1, lng: 71.3 },
    { name: "Maharashtra Gas", technology: "gas", capacityMw: 950, status: "Operating", countryCode: "IN", lat: 19.7, lng: 75.3 },
    { name: "Hokkaido Wind", technology: "wind", capacityMw: 430, status: "Operating", countryCode: "JP", lat: 43.2, lng: 141.4 },
    { name: "Tokyo Bay Storage", technology: "storage", capacityMw: 300, status: "Operating", countryCode: "JP", lat: 35.5, lng: 140.0 },
  ];

  return rows.map((row, index) => ({
    ...row,
    id: `plant-dense-${index + 1}`,
    source: "Mock plant registry",
  }));
}

function generateDenseDataCenters(): DataCenterAsset[] {
  const rows: Omit<DataCenterAsset, "id" | "source">[] = [
    { name: "Detroit AI Exchange", kind: "data-center", operator: "DemoCloud", capacityMw: 380, countryCode: "US", lat: 42.33, lng: -83.05 },
    { name: "Ann Arbor Compute", kind: "data-center", operator: "Epoch Demo", capacityMw: 180, countryCode: "US", lat: 42.28, lng: -83.74 },
    { name: "Grand Rapids IX", kind: "internet-exchange", operator: "PeeringDB", capacityMw: 42, countryCode: "US", lat: 42.96, lng: -85.67 },
    { name: "Cleveland Megaproject", kind: "data-center", operator: "DemoCloud", capacityMw: 520, countryCode: "US", lat: 41.5, lng: -81.69 },
    { name: "Toledo Fiber Campus", kind: "data-center", operator: "DemoCloud", capacityMw: 260, countryCode: "US", lat: 41.65, lng: -83.54 },
    { name: "Toronto North IX", kind: "internet-exchange", operator: "PeeringDB", capacityMw: 64, countryCode: "CA", lat: 43.65, lng: -79.38 },
    { name: "Ottawa Compute Ring", kind: "data-center", operator: "DemoCloud", capacityMw: 210, countryCode: "CA", lat: 45.42, lng: -75.69 },
    { name: "Northern Virginia East", kind: "data-center", operator: "DemoCloud", capacityMw: 720, countryCode: "US", lat: 38.96, lng: -77.36 },
    { name: "Paris West IX", kind: "internet-exchange", operator: "PeeringDB", capacityMw: 51, countryCode: "FR", lat: 48.88, lng: 2.13 },
    { name: "Lyon Compute Park", kind: "data-center", operator: "DemoCloud", capacityMw: 190, countryCode: "FR", lat: 45.76, lng: 4.84 },
    { name: "Osaka Compute Ring", kind: "data-center", operator: "DemoCloud", capacityMw: 230, countryCode: "JP", lat: 34.69, lng: 135.5 },
  ];

  return rows.map((row, index) => ({ ...row, id: `dc-dense-${index + 1}`, source: "Mock PeeringDB" }));
}

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

export function getMockMapDataset(): MapDataset {
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
