export type TechnologyKey =
  | "solar"
  | "wind"
  | "offshore"
  | "storage"
  | "pumped"
  | "hydro"
  | "nuclear"
  | "gas"
  | "coal"
  | "oil"
  | "geothermal"
  | "biomass"
  | "other";

export type LayerKey =
  | "dataCenters"
  | "internetExchanges"
  | "fiber"
  | "transmission"
  | "openInfraPower"
  | "substations"
  | "plannedUpgrades"
  | "gasPipelines"
  | "submarineCables"
  | "landingPoints";

export type CustomLayerKey = "customCorridor" | "customHeatmap";

export type MapThemeKey =
  | "nasa"
  | "cartoDark"
  | "deepOcean"
  | "eox"
  | "satellite"
  | "hillshade"
  | "goes"
  | "black";

export type SourceLayerKey =
  | "hifldLines"
  | "rowInfra"
  | "osmLines"
  | "hifldSubs"
  | "rowSubs"
  | "osmSubs";

export type VoltageClass = "1000" | "750" | "500" | "220" | "110" | "35" | "low";

export type RegionTargetId =
  | "global"
  | "united-states"
  | "canada"
  | "mexico"
  | "france"
  | "europe"
  | "china"
  | "india"
  | "japan";

export type Coordinates = [number, number];

export type TechnologyMeta = {
  key: TechnologyKey;
  label: string;
  tone: string;
  color: string;
};

export type LayerMeta = {
  key: LayerKey;
  label: string;
  tone?: string;
  experimental?: boolean;
};

export type VoltageMeta = {
  key: VoltageClass;
  label: string;
  tone: string;
  minKv: number;
  color: string;
};

export type SourceLayerMeta = {
  key: SourceLayerKey;
  label: string;
  layerKind: "line" | "substation";
};

export type EnergyAsset = {
  id: string;
  name: string;
  technology: TechnologyKey;
  capacityMw: number;
  status: "Operating" | "Planned" | "Construction" | "Permitting";
  countryCode: string;
  regionId?: RegionTargetId;
  source: string;
  owner?: string;
  operator?: string;
  sourceId?: string;
  commissioningYear?: number;
  river?: string;
  mainBasin?: string;
  damName?: string;
  reservoirName?: string;
  damHeightM?: number;
  reservoirAreaKm2?: number;
  reservoirVolumeMm3?: number;
  reservoirVolumeKm3?: number;
  headM?: number;
  annualGenerationMwh?: number;
  lat: number;
  lng: number;
};

export type DataCenterAsset = {
  id: string;
  name: string;
  kind: "data-center" | "internet-exchange";
  operator: string;
  capacityMw?: number;
  countryCode: string;
  regionId?: RegionTargetId;
  source: string;
  city?: string;
  state?: string;
  status?: string;
  updated?: string;
  website?: string;
  review_source?: string;
  reviewed_at?: string;
  coordinate_confidence?: string;
  lat: number;
  lng: number;
};

export type GridLine = {
  id: string;
  name: string;
  voltageKv: number;
  voltageClass: VoltageClass;
  sourceLayer: SourceLayerKey;
  status: "Operating" | "Construction" | "Planned";
  networkTier?: "backbone" | "regional" | "local" | "interconnector";
  regionId?: RegionTargetId;
  coordinates: Coordinates[];
};

export type Substation = {
  id: string;
  name: string;
  voltageClass: VoltageClass;
  voltageKv?: number;
  sourceLayer: SourceLayerKey;
  countryCode?: string;
  regionId?: RegionTargetId;
  lat: number;
  lng: number;
};

export type PlannedUpgrade = {
  id: string;
  name: string;
  stage: "Construction" | "Permitting" | "Engineering" | "Planning" | "Conceptual";
  countryCode: string;
  regionId?: RegionTargetId;
  source: string;
  coordinates: Coordinates[];
};

export type GasPipeline = {
  id: string;
  name: string;
  kind: "Interstate" | "Intrastate";
  regionId?: RegionTargetId;
  source: string;
  coordinates: Coordinates[];
};

export type SubmarineCable = {
  id: string;
  name: string;
  operator: string;
  source: string;
  lengthKm: number;
  readyForService: string;
  regionId?: RegionTargetId;
  coordinates: Coordinates[];
};

export type LandingPoint = {
  id: string;
  name: string;
  cableId: string;
  countryCode: string;
  regionId?: RegionTargetId;
  lat: number;
  lng: number;
};

export type RegionBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type RegionTarget = {
  id: RegionTargetId;
  code: string;
  label: string;
  center: Coordinates;
  zoom: number;
  pitch: number;
  bearing: number;
  enabled: boolean;
};

export type RegionMeta = RegionTarget & {
  countryCodes: string[];
  bounds: RegionBounds[];
};

export type RegionStats = {
  region: RegionMeta;
  totalPlants: number;
  totalCapacityMw: number;
  byTechnology: Record<TechnologyKey, { count: number; capacityMw: number }>;
};

export type MapCameraState = {
  center: Coordinates;
  zoom: number;
  pitch: number;
  bearing: number;
};

export type MapTheme = {
  key: MapThemeKey;
  label: string;
  description: string;
  tileUrls: string[];
  attribution: string;
  background: string;
  maxzoom?: number;
  rasterOpacity: number;
  rasterSaturation: number;
  rasterContrast: number;
  rasterBrightnessMin?: number;
  rasterBrightnessMax?: number;
};

export type MapDataset = {
  regions: RegionMeta[];
  regionTargets: RegionTarget[];
  technologies: TechnologyMeta[];
  voltageClasses: VoltageMeta[];
  layerGroups: LayerMeta[];
  sourceLayers: SourceLayerMeta[];
  energyAssets: EnergyAsset[];
  dataCenters: DataCenterAsset[];
  gridLines: GridLine[];
  substations: Substation[];
  plannedUpgrades: PlannedUpgrade[];
  gasPipelines: GasPipeline[];
  submarineCables: SubmarineCable[];
  landingPoints: LandingPoint[];
  mapThemes: MapTheme[];
  sizeBreakpoints: { label: string; minMw: number }[];
};

export type LabelPreset = "zoom-v2" | "zoom-v1" | "lines-only" | "no-labels" | "bleed";

export type LabelSettings = {
  preset: LabelPreset;
  showLabels: boolean;
  substationLabels: boolean;
  basemapTextLabels: boolean;
  linesOnly: boolean;
  colorByLineType: boolean;
  enhancedVisibility: boolean;
  bigLabels: boolean;
  lineLabelSize: number;
  countryBorders: boolean;
  stateBorders: boolean;
  provinceLabels: boolean;
};

export type LegendHover =
  | { kind: "technology"; key: TechnologyKey }
  | { kind: "layer"; key: LayerKey }
  | { kind: "voltage"; key: VoltageClass }
  | { kind: "substation"; key: VoltageClass }
  | { kind: "size"; minMw: number };

export type SelectedFeatureKind =
  | "energy"
  | "data-center"
  | "internet-exchange"
  | "grid-line"
  | "substation"
  | "upgrade"
  | "pipeline"
  | "submarine-cable"
  | "landing-point"
  | "carbon"
  | "weather";

export type SelectedFeature = {
  id: string;
  kind: SelectedFeatureKind;
  title: string;
  subtitle: string;
  coordinates: Coordinates;
  color: string;
  rows: {
    label: string;
    value: string;
  }[];
  source?: string;
};

export type LayerPanelKey = "layers" | "customLayers" | "mapType";

export type ToolbarPanel = "labels" | "globe" | "presets" | "search" | "sources" | "prediction" | LayerPanelKey | null;
