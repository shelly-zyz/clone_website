import type { FeatureCollection, Point } from "geojson";
import type { ExpressionSpecification, GeoJSONSource, Map } from "maplibre-gl";
import { chinaProvinces, findChinaProvince } from "./china-provinces";
import { powerAmount, powerMapNoData, provincePowerColor, provincePowerMax, type ProvincePowerFrame } from "./china-power-statistics";

const spikeSource = "province-power-points";
const spikeLayer = "province-power-spikes";
const fillLayer = "reported-generation-fill";
const selectionLayer = "reported-generation-selection";
const powerLayerIds = ["power-map-ocean", "power-map-land", fillLayer, spikeLayer, selectionLayer];
const labelSize = 13;

type PowerMapPoint = {
  code: string;
  image: string;
  label: string;
  labelOffset: [number, number];
  rank: number;
};

export function powerOverviewZoom(width: number, height: number) {
  const scale = Math.min(width / 98, height / 84);
  return Math.min(3.45, Math.log2(Math.max(.25, scale)));
}

export function powerProvinceAt(map: Map, point: { x: number; y: number }) {
  if (!map.getLayer(fillLayer)) return;
  const pixel: [number, number] = [point.x, point.y];
  const [spike] = map.queryRenderedFeatures(pixel, { layers: [spikeLayer] });
  if (typeof spike?.properties?.code === "string") return findChinaProvince(spike.properties.code);
  const [province] = map.queryRenderedFeatures(pixel, { layers: [fillLayer] });
  if (typeof province?.properties?.iso_3166_2 === "string") return findChinaProvince(province.properties.iso_3166_2);
}

export function addProvincePowerLayers(map: Map) {
  map.addSource(spikeSource, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "power-map-ocean", type: "background", layout: { visibility: "none" },
    paint: { "background-color": "#f7fafc" },
  });
  map.addLayer({
    id: "power-map-land", type: "fill", source: "ne-countries", layout: { visibility: "none" },
    paint: { "fill-color": "#edf2f5", "fill-outline-color": "#ccd9e2" },
  });
  map.addLayer({
    id: fillLayer, type: "fill", source: "ne-admin1-polygons",
    filter: ["==", ["get", "adm0_a3"], "CHN"], layout: { visibility: "none" },
    paint: { "fill-color": powerMapNoData, "fill-outline-color": "#647e91" },
  });
  map.addLayer({
    id: selectionLayer, type: "line", source: "ne-admin1-polygons",
    layout: { visibility: "none", "line-join": "round" },
    paint: { "line-color": "#103f75", "line-width": 2.25 },
  });
  map.addLayer({
    id: spikeLayer, type: "symbol", source: spikeSource,
    layout: {
      visibility: "none",
      "icon-image": ["get", "image"],
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "rank"],
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": labelSize,
      "text-anchor": "bottom",
      "text-offset": ["get", "labelOffset"],
      "text-optional": true,
    },
    paint: { "text-color": "#122f4c", "text-halo-color": "#f7fafc", "text-halo-width": 2.5 },
  });
}

export function updateProvincePowerLayers(map: Map, frame: ProvincePowerFrame | undefined, selection?: string) {
  for (const id of powerLayerIds) {
    map.setLayoutProperty(id, "visibility", frame && (id !== selectionLayer || selection) ? "visible" : "none");
  }
  if (!frame) return;

  const maximum = provincePowerMax(frame);
  const entries = new globalThis.Map(frame.regions.map(row => [row.code, row.value]));
  const colors = chinaProvinces.flatMap(({ iso, code }) => [iso, provincePowerColor(entries.get(code), maximum)]);
  const color = ["match", ["get", "iso_3166_2"], ...colors, powerMapNoData] as unknown as ExpressionSpecification;
  map.setPaintProperty(fillLayer, "fill-color", color);
  map.setFilter(selectionLayer, ["==", ["get", "iso_3166_2"], findChinaProvince(selection)?.iso ?? ""]);
}

export function updateProvincePowerSpikes(map: Map, frame: ProvincePowerFrame, selection?: string) {
  const { clientWidth, clientHeight } = map.getContainer();
  const maximumHeight = Math.min(140, Math.max(58, Math.min(clientWidth, clientHeight) * .21));
  const maximum = provincePowerMax(frame);
  const ranked = frame.regions.flatMap(({ code, value }) => value != null && value > 0 ? [{ code, value }] : [])
    .sort((a, b) => b.value - a.value);
  const points: FeatureCollection<Point, PowerMapPoint> = { type: "FeatureCollection", features: [] };
  ranked.forEach(({ code, value }, index) => {
    const province = findChinaProvince(code);
    if (!province) return;
    const height = Math.max(.5, Math.round(value / maximum * maximumHeight * 2) / 2);
    const image = addSpikeImage(map, height, maximumHeight);
    const selected = code === selection;
    const name = province.name.replace(/(?:壮族|回族|维吾尔)?自治区$|[省市]$/u, "");
    points.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: province.center },
      properties: {
        code,
        image,
        label: selected || index < 3 ? `${name} ${powerAmount.format(value)}` : "",
        labelOffset: [0, -(height + 7) / labelSize],
        rank: selected ? -1 : index,
      },
    });
  });
  map.getSource<GeoJSONSource>(spikeSource)?.setData(points);
}

function addSpikeImage(map: Map, height: number, maximumHeight: number) {
  const width = Math.round(3 + 9 * height / maximumHeight);
  const id = `province-power-spike-${width}-${height}`;
  if (map.hasImage(id)) return id;

  const pixelRatio = 2;
  const canvas = document.createElement("canvas");
  canvas.width = (width + 10) * pixelRatio;
  canvas.height = (height + 8) * pixelRatio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return id;
  ctx.scale(pixelRatio, pixelRatio);

  const center = (width + 10) / 2;
  const base = height + 2;
  const left = center - width / 2;
  const right = center + width / 2;
  const tip = center + width * .27;

  ctx.save();
  ctx.translate(center - 1, base);
  ctx.scale(width * .72 + 2, 3);
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  shadow.addColorStop(0, "#074e9b99");
  shadow.addColorStop(1, "#074e9b00");
  ctx.fillStyle = shadow;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();

  const face = (a: number, b: number, color: CanvasGradient | string) => {
    ctx.beginPath();
    ctx.moveTo(tip, 2);
    ctx.lineTo(a, base);
    ctx.lineTo(b, base);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const gradient = ctx.createLinearGradient(0, 2, 0, base);
  gradient.addColorStop(0, "#4594d7");
  gradient.addColorStop(1, "#225a9d");
  face(left, center + width * .12, gradient);
  face(center + width * .12, right, "#123f7a");
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio });
  return id;
}
