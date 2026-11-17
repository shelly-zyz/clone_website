import type { Map } from "maplibre-gl";
import type { MapTheme } from "@/types/opengridworks";

export function applyRasterBasemap(map: Map, theme: MapTheme, beforeId?: string) {
  if (map.getLayer("basemap-raster")) {
    map.removeLayer("basemap-raster");
  }

  if (map.getSource("basemap-raster")) {
    map.removeSource("basemap-raster");
  }

  map.setPaintProperty("background", "background-color", theme.background);
  if (theme.tileUrls.length === 0) {
    return;
  }

  map.addSource("basemap-raster", {
    type: "raster",
    tiles: theme.tileUrls,
    tileSize: 256,
    maxzoom: theme.maxzoom,
    attribution: theme.attribution,
  });
  map.addLayer(
    {
      id: "basemap-raster",
      type: "raster",
      source: "basemap-raster",
      paint: {
        "raster-opacity": theme.rasterOpacity,
        "raster-saturation": theme.rasterSaturation,
        "raster-contrast": theme.rasterContrast,
        "raster-brightness-min": theme.rasterBrightnessMin ?? 0,
        "raster-brightness-max": theme.rasterBrightnessMax ?? 1,
      },
    },
    beforeId,
  );
}
