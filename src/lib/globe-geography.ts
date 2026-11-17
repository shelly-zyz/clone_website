import type { Feature, FeatureCollection, Point } from "geojson";
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import countryCenters from "@/lib/country-centers.generated.json";
import type { Coordinates } from "@/types/opengridworks";

export const globeGlyphs = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
export const globeSky = {
  "sky-color": "#101821",
  "horizon-color": "#1e293b",
  "fog-color": "#0f172a",
  "atmosphere-blend": 0.28,
};

function countryLabelRank(population: number) {
  if (population >= 1_000_000_000) return 1;
  if (population >= 100_000_000) return 2;
  if (population >= 30_000_000) return 3;
  if (population >= 5_000_000) return 4;
  return 7;
}

function buildCountryLabelCollection(): FeatureCollection<Point> {
  const features: Feature<Point>[] = countryCenters
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

  return { type: "FeatureCollection", features };
}

function buildContinentLabelCollection(): FeatureCollection<Point> {
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

const naturalEarthAttribution = "Natural Earth";
const naturalEarthSources = {
  countries: "/data/natural-earth/ne_50m_admin_0_countries.geojson",
  countryLines: "/data/natural-earth/ne_50m_admin_0_boundary_lines_land.geojson",
  admin1Polygons: "/data/natural-earth/ne_50m_admin_1_states_provinces.geojson",
};

const cartoBasemapSourceId = "carto-basemap";

export const globeGeographySources = {
  "country-label-points": { type: "geojson", data: buildCountryLabelCollection(), attribution: naturalEarthAttribution },
  "continent-label-points": { type: "geojson", data: buildContinentLabelCollection(), attribution: naturalEarthAttribution },
  "ne-countries": { type: "geojson", data: naturalEarthSources.countries, attribution: naturalEarthAttribution },
  "ne-country-lines": { type: "geojson", data: naturalEarthSources.countryLines, attribution: naturalEarthAttribution },
  "ne-admin1-polygons": { type: "geojson", data: naturalEarthSources.admin1Polygons, attribution: naturalEarthAttribution },
  [cartoBasemapSourceId]: {
    type: "vector",
    url: "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json",
    attribution: "CARTO, OpenStreetMap contributors",
  },
} satisfies StyleSpecification["sources"];

export const globeBoundaryLayers: LayerSpecification[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

export const globeCountryLabels: LayerSpecification = {
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
};

function localizedAdminName() {
  return ["coalesce", ["get", "name_zh"], ["get", "name_zht"], ["get", "name_en"], ["get", "name"]] as unknown as ExpressionSpecification;
}

export const globeProvinceLabels: LayerSpecification = {
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
};

export const globeContinentLabels: LayerSpecification = {
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
};
