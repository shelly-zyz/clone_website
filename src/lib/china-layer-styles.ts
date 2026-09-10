export const CHINA_OSM_TILESET_VERSION = "china-260517-osm-z3-5-20260519-plants-generators";

export const CHINA_OSM_TILE_SOURCE = {
  type: "vector" as const,
  tiles: [`/api/data/vector-tiles/${CHINA_OSM_TILESET_VERSION}/{z}/{x}/{y}.pbf`],
  minzoom: 3,
  maxzoom: 5,
  bounds: [73.258153, 18.217487, 135.112781, 53.965489] as [number, number, number, number],
  attribution: "© OpenStreetMap contributors",
};

export const CHINA_VOLTAGE_CLASSES = ["1000", "750", "500", "220", "110", "35", "low"] as const;
export type ChinaVoltageClass = typeof CHINA_VOLTAGE_CLASSES[number];
export type ChinaOsmFeatureLayer = "lines" | "substations" | "plants" | "generators";

export const CHINA_VOLTAGE_COLORS: Record<ChinaVoltageClass, string> = {
  "1000": "#f8fafc",
  "750": "#67e8f9",
  "500": "#22d3ee",
  "220": "#38bdf8",
  "110": "#818cf8",
  "35": "#c084fc",
  low: "#a855f7",
};

type Expression = unknown[];

export function buildVoltageFilter(classes: readonly ChinaVoltageClass[]): Expression {
  if (classes.length === 0) return ["==", 1, 0];
  return ["in", ["coalesce", ["get", "voltageClass"], "low"], ...classes];
}

const voltageColorExpression: Expression = [
  "match",
  ["coalesce", ["get", "voltageClass"], "low"],
  "1000", CHINA_VOLTAGE_COLORS["1000"],
  "750", CHINA_VOLTAGE_COLORS["750"],
  "500", CHINA_VOLTAGE_COLORS["500"],
  "220", CHINA_VOLTAGE_COLORS["220"],
  "110", CHINA_VOLTAGE_COLORS["110"],
  "35", CHINA_VOLTAGE_COLORS["35"],
  "low", CHINA_VOLTAGE_COLORS.low,
  "#64748b",
];

export type ChinaOsmLayerDefinition = {
  id: string;
  kind: ChinaOsmFeatureLayer;
  type: "line" | "circle";
  sourceLayer: string;
  minzoom: number;
  paint: Record<string, unknown>;
};

export function buildChinaOsmLayerDefinitions(): ChinaOsmLayerDefinition[] {
  return [
    {
      id: "china-osm-line-glow",
      kind: "lines",
      type: "line",
      sourceLayer: "power_line",
      minzoom: 3,
      paint: {
        "line-color": voltageColorExpression,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.2, 5, 4.5],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.14, 5, 0.25],
        "line-blur": 3.2,
      },
    },
    {
      id: "china-osm-line-main",
      kind: "lines",
      type: "line",
      sourceLayer: "power_line",
      minzoom: 3,
      paint: {
        "line-color": voltageColorExpression,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.42, 5, 1.15],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 5, 0.82],
      },
    },
    {
      id: "china-osm-plant",
      kind: "plants",
      type: "circle",
      sourceLayer: "power_plant_point",
      minzoom: 4,
      paint: {
        "circle-color": "#fbbf24",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.25, 5, 2.25],
        "circle-opacity": 0.82,
        "circle-stroke-color": "#fff7d6",
        "circle-stroke-width": 0.45,
      },
    },
    {
      id: "china-osm-substation",
      kind: "substations",
      type: "circle",
      sourceLayer: "power_substation_point",
      minzoom: 4.4,
      paint: {
        "circle-color": "#e2e8f0",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4.4, 1, 5, 1.8],
        "circle-opacity": 0.86,
        "circle-stroke-color": voltageColorExpression,
        "circle-stroke-width": 1,
      },
    },
    {
      id: "china-osm-generator",
      kind: "generators",
      type: "circle",
      sourceLayer: "power_generator_point",
      minzoom: 5,
      paint: {
        "circle-color": "#4ade80",
        "circle-radius": 0.85,
        "circle-opacity": 0.5,
      },
    },
  ];
}
