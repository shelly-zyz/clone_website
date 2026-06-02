"""Extract China OSM power infrastructure into local GeoJSON and vector tiles.

The source PBF is large, so this script reads it in two passes:
1. collect relevant OSM power ways/nodes and the node ids needed for geometry;
2. collect only those node coordinates, then write compact outputs for the app.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Literal

try:
  import mercantile
  import osmium
  from mapbox_vector_tile import encode as encode_vector_tile
  from shapely.geometry import LineString, Point, box, mapping, shape
  from shapely.ops import clip_by_rect
  from shapely.strtree import STRtree
except ImportError as error:
  raise SystemExit(
    "Missing geospatial dependency. Install with:\n"
    "  python -m pip install --user osmium mercantile mapbox-vector-tile shapely\n"
    f"\nOriginal error: {error}"
  ) from error


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT.parent / "data"
DEFAULT_INPUT = DATA_DIR / "china-260517.osm.pbf"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "public" / "data" / "osm-power"
OSM_SOURCE_NAME = "OpenStreetMap china-260517.osm.pbf"
WEB_MERCATOR_MAX_LAT = 85.05112878
POWER_LINE_VALUES = {"line", "cable"}
SUBSTATION_VALUES = {"substation"}
PLANT_VALUES = {"plant"}
GENERATOR_VALUES = {"generator"}
LIFECYCLE_PREFIXES = ("construction", "proposed", "planned")
LINE_SOURCE_LAYER = "power_line"
SUBSTATION_SOURCE_LAYER = "power_substation_point"
PLANT_SOURCE_LAYER = "power_plant_point"
GENERATOR_SOURCE_LAYER = "power_generator_point"


Coordinates = list[float]
LineCoordinates = list[Coordinates]
OsmKind = Literal["line", "substation", "plant", "generator"]


@dataclass(slots=True)
class WayRecord:
  osm_id: int
  kind: OsmKind
  tags: dict[str, str]
  node_refs: tuple[int, ...]


@dataclass(slots=True)
class NodeFeature:
  osm_id: int
  kind: OsmKind
  tags: dict[str, str]
  lon: float
  lat: float


def iter_tags(osm_object: Any) -> dict[str, str]:
  return {tag.k: tag.v for tag in osm_object.tags}


def clean_string(value: object, fallback: str = "") -> str:
  if value is None:
    return fallback
  text = str(value).strip()
  if text in {"", "-", "--", "nan", "NaN", "None"}:
    return fallback
  return re.sub(r"\s+", " ", text)


def slug_text(value: str, fallback: str) -> str:
  text = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
  return text or fallback


def is_valid_china_coordinate(lon: float, lat: float) -> bool:
  return 73 <= lon <= 136 and 18 <= lat <= 54


def rounded_coord(lon: float, lat: float) -> Coordinates:
  return [round(lon, 6), round(lat, 6)]


def relevant_power_value(tags: dict[str, str]) -> tuple[str | None, str]:
  power = clean_string(tags.get("power")).lower()
  if power:
    return power, "power"
  for prefix in LIFECYCLE_PREFIXES:
    value = clean_string(tags.get(f"{prefix}:power")).lower()
    if value:
      return value, f"{prefix}:power"
  return None, "power"


def is_power_kind(tags: dict[str, str], values: set[str]) -> bool:
  power, _ = relevant_power_value(tags)
  if power in values:
    return True
  if power in LIFECYCLE_PREFIXES:
    return any(clean_string(tags.get(prefix)).lower() in values for prefix in LIFECYCLE_PREFIXES)
  return False


def is_line_way(tags: dict[str, str]) -> bool:
  return is_power_kind(tags, POWER_LINE_VALUES)


def is_substation(tags: dict[str, str]) -> bool:
  return is_power_kind(tags, SUBSTATION_VALUES)


def is_plant(tags: dict[str, str]) -> bool:
  return is_power_kind(tags, PLANT_VALUES)


def is_generator(tags: dict[str, str]) -> bool:
  return is_power_kind(tags, GENERATOR_VALUES)


def point_kind_from_tags(tags: dict[str, str]) -> OsmKind | None:
  if is_substation(tags):
    return "substation"
  if is_plant(tags):
    return "plant"
  if is_generator(tags):
    return "generator"
  return None


def is_local_point_kind(kind: OsmKind) -> bool:
  return kind in {"substation", "plant", "generator"}




def parse_voltage_values(value: str) -> list[float]:
  text = clean_string(value).lower()
  if not text:
    return []

  values: list[float] = []
  for token in re.split(r"[;,/|]+", text):
    token = token.strip()
    if not token:
      continue
    for match in re.finditer(r"\d+(?:[.,]\d+)?", token):
      number = float(match.group(0).replace(",", "."))
      if not math.isfinite(number) or number <= 0:
        continue
      token_has_kv = "kv" in token or "千伏" in token
      if token_has_kv:
        values.append(number)
      elif number >= 10_000:
        values.append(number / 1_000)
      elif number >= 35:
        values.append(number)
      else:
        values.append(number / 1_000)
  return values


def max_voltage_kv(tags: dict[str, str]) -> float | None:
  values: list[float] = []
  for key in ("voltage", "voltage:primary", "voltage:secondary", "voltage:transmission"):
    values.extend(parse_voltage_values(tags.get(key, "")))
  return max(values) if values else None


def voltage_class(voltage_kv: float | None) -> str:
  if voltage_kv is None:
    return "low"
  if voltage_kv >= 1_000:
    return "1000"
  if voltage_kv >= 750:
    return "750"
  if voltage_kv >= 500:
    return "500"
  if voltage_kv >= 220:
    return "220"
  if voltage_kv >= 110:
    return "110"
  if voltage_kv >= 35:
    return "35"
  return "low"


def status_from_tags(tags: dict[str, str]) -> str:
  power, power_key = relevant_power_value(tags)
  if power_key == "construction:power" or power == "construction" or tags.get("construction"):
    return "Construction"
  if power_key in {"proposed:power", "planned:power"} or power in {"proposed", "planned"} or tags.get("proposed"):
    return "Planned"
  return "Operating"


def display_name(tags: dict[str, str], fallback: str) -> str:
  for key in ("name", "name:en", "name:zh", "ref", "operator"):
    value = clean_string(tags.get(key))
    if value:
      return value
  return fallback


def centroid_for_coords(coords: LineCoordinates) -> Coordinates | None:
  if not coords:
    return None
  if len(coords) >= 4 and coords[0] == coords[-1]:
    area = 0.0
    cx = 0.0
    cy = 0.0
    for first, second in zip(coords, coords[1:]):
      cross = first[0] * second[1] - second[0] * first[1]
      area += cross
      cx += (first[0] + second[0]) * cross
      cy += (first[1] + second[1]) * cross
    if abs(area) > 1e-12:
      factor = 1 / (3 * area)
      return rounded_coord(cx * factor, cy * factor)
  lon = sum(coord[0] for coord in coords) / len(coords)
  lat = sum(coord[1] for coord in coords) / len(coords)
  return rounded_coord(lon, lat)


class PowerCollector(osmium.SimpleHandler):
  def __init__(
    self,
    *,
    include_unknown_lines: bool,
    include_unknown_substations: bool,
    min_line_voltage_kv: float,
    min_substation_voltage_kv: float,
  ) -> None:
    super().__init__()
    self.include_unknown_lines = include_unknown_lines
    self.include_unknown_substations = include_unknown_substations
    self.min_line_voltage_kv = min_line_voltage_kv
    self.min_substation_voltage_kv = min_substation_voltage_kv
    self.node_features: list[NodeFeature] = []
    self.ways: list[WayRecord] = []
    self.node_refs: set[int] = set()
    self.stats = Counter[str]()

  def node(self, node: Any) -> None:
    if len(node.tags) == 0:
      return
    tags = iter_tags(node)
    if not is_substation(tags):
      return
    if not node.location.valid():
      self.stats["substation_nodes_without_location"] += 1
      return
    lon = float(node.location.lon)
    lat = float(node.location.lat)
    if not is_valid_china_coordinate(lon, lat):
      self.stats["substation_nodes_outside_china_bbox"] += 1
      return
    voltage = max_voltage_kv(tags)
    if voltage is None and not self.include_unknown_substations:
      self.stats["substation_nodes_without_voltage"] += 1
      return
    if voltage is not None and voltage < self.min_substation_voltage_kv:
      self.stats["substation_nodes_below_min_voltage"] += 1
      return
    self.node_features.append(NodeFeature(int(node.id), "substation", tags, lon, lat))
    self.stats["substation_nodes_used"] += 1

  def way(self, way: Any) -> None:
    if len(way.tags) == 0:
      return
    tags = iter_tags(way)
    kind: OsmKind | None = None
    voltage = max_voltage_kv(tags)
    if is_line_way(tags):
      if voltage is None and not self.include_unknown_lines:
        self.stats["line_ways_without_voltage"] += 1
        return
      if voltage is not None and voltage < self.min_line_voltage_kv:
        self.stats["line_ways_below_min_voltage"] += 1
        return
      kind = "line"
    elif is_substation(tags):
      if voltage is None and not self.include_unknown_substations:
        self.stats["substation_ways_without_voltage"] += 1
        return
      if voltage is not None and voltage < self.min_substation_voltage_kv:
        self.stats["substation_ways_below_min_voltage"] += 1
        return
      kind = "substation"

    if kind is None:
      return

    refs = tuple(int(node.ref) for node in way.nodes)
    if len(refs) < 2:
      self.stats[f"{kind}_ways_too_short"] += 1
      return
    self.ways.append(WayRecord(int(way.id), kind, tags, refs))
    self.node_refs.update(refs)
    self.stats[f"{kind}_ways_collected"] += 1


class CoordinateCollector(osmium.SimpleHandler):
  def __init__(self, needed_node_refs: set[int]) -> None:
    super().__init__()
    self.needed_node_refs = needed_node_refs
    self.coordinates: dict[int, tuple[float, float]] = {}

  def node(self, node: Any) -> None:
    node_id = int(node.id)
    if node_id not in self.needed_node_refs or not node.location.valid():
      return
    self.coordinates[node_id] = (float(node.location.lon), float(node.location.lat))


def line_feature(record: WayRecord, coords: LineCoordinates) -> dict[str, Any] | None:
  unique_coords = [coords[0]]
  for coord in coords[1:]:
    if coord != unique_coords[-1]:
      unique_coords.append(coord)
  if len(unique_coords) < 2:
    return None
  voltage = max_voltage_kv(record.tags)
  voltage_kv = round(voltage or 0, 2)
  feature_id = f"osm-way-{record.osm_id}"
  name = display_name(record.tags, f"OSM power line {record.osm_id}")
  properties = base_properties(
    record.tags,
    feature_id=feature_id,
    name=name,
    kind="grid-line",
    osm_type="way",
    osm_id=record.osm_id,
    voltage_kv=voltage_kv,
    voltage_class=voltage_class(voltage),
    source_layer="osmLines",
  )
  properties["status"] = status_from_tags(record.tags)
  return {
    "type": "Feature",
    "geometry": {"type": "LineString", "coordinates": unique_coords},
    "properties": properties,
  }


def substation_feature(
  *,
  osm_id: int,
  osm_type: str,
  tags: dict[str, str],
  point: Coordinates,
) -> dict[str, Any]:
  voltage = max_voltage_kv(tags)
  voltage_kv = round(voltage or 0, 2)
  feature_id = f"osm-{osm_type}-{osm_id}"
  name = display_name(tags, f"OSM substation {osm_id}")
  properties = base_properties(
    tags,
    feature_id=feature_id,
    name=name,
    kind="substation",
    osm_type=osm_type,
    osm_id=osm_id,
    voltage_kv=voltage_kv,
    voltage_class=voltage_class(voltage),
    source_layer="osmSubs",
  )
  properties["substation"] = clean_string(tags.get("substation"), "substation")
  return {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": point},
    "properties": properties,
  }


def point_source_layer(kind: OsmKind) -> str:
  if kind == "substation":
    return "osmSubs"
  if kind == "plant":
    return "osmPlants"
  if kind == "generator":
    return "osmGenerators"
  return "osmPower"


def point_kind_label(kind: OsmKind) -> str:
  if kind == "plant":
    return "power-plant"
  if kind == "generator":
    return "generator"
  return "substation"


def power_point_feature(
  *,
  osm_id: int,
  osm_type: str,
  tags: dict[str, str],
  point: Coordinates,
  kind: OsmKind,
) -> dict[str, Any]:
  if kind == "substation":
    return substation_feature(osm_id=osm_id, osm_type=osm_type, tags=tags, point=point)

  voltage = max_voltage_kv(tags)
  voltage_kv = round(voltage or 0, 2)
  feature_id = f"osm-{osm_type}-{kind}-{osm_id}"
  name = display_name(tags, f"OSM {kind} {osm_id}")
  properties = base_properties(
    tags,
    feature_id=feature_id,
    name=name,
    kind=point_kind_label(kind),
    osm_type=osm_type,
    osm_id=osm_id,
    voltage_kv=voltage_kv,
    voltage_class=voltage_class(voltage),
    source_layer=point_source_layer(kind),
  )
  properties["status"] = status_from_tags(tags)
  properties["fuel"] = clean_string(
    tags.get("plant:source"),
    clean_string(tags.get("generator:source"), clean_string(tags.get("source"))),
  )
  properties["method"] = clean_string(tags.get("generator:method"), clean_string(tags.get("plant:method")))
  properties["outputElectricity"] = clean_string(
    tags.get("generator:output:electricity"),
    clean_string(tags.get("plant:output:electricity"), clean_string(tags.get("output:electricity"))),
  )
  return {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": point},
    "properties": properties,
  }


def base_properties(
  tags: dict[str, str],
  *,
  feature_id: str,
  name: str,
  kind: str,
  osm_type: str,
  osm_id: int,
  voltage_kv: float,
  voltage_class: str,
  source_layer: str,
) -> dict[str, str | int | float]:
  voltage_tag = clean_string(tags.get("voltage"), "Unknown")
  return {
    "id": feature_id,
    "kind": kind,
    "name": name,
    "ref": clean_string(tags.get("ref")),
    "operator": clean_string(tags.get("operator")),
    "power": clean_string(tags.get("power"), clean_string(tags.get("construction:power"), "power")),
    "voltage": voltage_tag,
    "voltageKv": voltage_kv,
    "voltageClass": voltage_class,
    "sourceLayer": source_layer,
    "source": OSM_SOURCE_NAME,
    "osmType": osm_type,
    "osmId": osm_id,
  }


def feature_collection(features: list[dict[str, Any]]) -> dict[str, Any]:
  return {"type": "FeatureCollection", "features": features}


def write_json(path: Path, payload: Any) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def to_tile_properties(properties: dict[str, Any]) -> dict[str, str | int | float | bool]:
  tile_properties: dict[str, str | int | float | bool] = {}
  for key, value in properties.items():
    if value is None:
      continue
    if isinstance(value, bool | int | float | str):
      tile_properties[key] = value
  return tile_properties


def feature_voltage_kv(feature: dict[str, Any]) -> float:
  value = feature["properties"].get("voltageKv", 0)
  return value if isinstance(value, int | float) else 0


def feature_visible_at_zoom(feature: dict[str, Any], zoom: int) -> bool:
  kind = str(feature["properties"].get("kind", ""))
  if kind in {"power-plant", "generator"}:
    return zoom >= 4
  voltage = feature_voltage_kv(feature)
  if zoom <= 3:
    return voltage >= 500
  if zoom == 4:
    return voltage >= 220
  if zoom == 5:
    return True
  return True


def clamp_lat(value: float) -> float:
  return max(-WEB_MERCATOR_MAX_LAT, min(WEB_MERCATOR_MAX_LAT, value))


def data_bounds(features: Iterable[dict[str, Any]]) -> tuple[float, float, float, float]:
  west = 180.0
  south = 90.0
  east = -180.0
  north = -90.0
  for feature in features:
    geom = shape(feature["geometry"])
    minx, miny, maxx, maxy = geom.bounds
    west = min(west, minx)
    south = min(south, miny)
    east = max(east, maxx)
    north = max(north, maxy)
  if east < west or north < south:
    return (73, 18, 136, 54)
  return (max(-180, west), clamp_lat(south), min(180, east), clamp_lat(north))


def tile_url_for(output_dir: Path, tiles_dir: Path) -> str:
  public_dir = REPO_ROOT / "public"
  try:
    relative = tiles_dir.relative_to(public_dir)
    return "/" + relative.as_posix() + "/{z}/{x}/{y}.pbf"
  except ValueError:
    relative = tiles_dir.relative_to(output_dir)
    return "./" + relative.as_posix() + "/{z}/{x}/{y}.pbf"


def build_vector_tiles(
  *,
  line_features: list[dict[str, Any]],
  substation_features: list[dict[str, Any]],
  plant_features: list[dict[str, Any]],
  generator_features: list[dict[str, Any]],
  output_dir: Path,
  tile_version: str,
  minzoom: int,
  maxzoom: int,
) -> dict[str, Any]:
  tiles_dir = output_dir / "tiles" / tile_version
  tiles_dir.mkdir(parents=True, exist_ok=True)

  line_geoms = [shape(feature["geometry"]) for feature in line_features]
  substation_geoms = [shape(feature["geometry"]) for feature in substation_features]
  plant_geoms = [shape(feature["geometry"]) for feature in plant_features]
  generator_geoms = [shape(feature["geometry"]) for feature in generator_features]
  line_tree = STRtree(line_geoms) if line_geoms else None
  substation_tree = STRtree(substation_geoms) if substation_geoms else None
  plant_tree = STRtree(plant_geoms) if plant_geoms else None
  generator_tree = STRtree(generator_geoms) if generator_geoms else None
  west, south, east, north = data_bounds([*line_features, *substation_features, *plant_features, *generator_features])
  tile_count = 0

  for tile in mercantile.tiles(west, south, east, north, range(minzoom, maxzoom + 1)):
    bounds = mercantile.bounds(tile)
    tile_bounds = (bounds.west, bounds.south, bounds.east, bounds.north)
    tile_box = box(*tile_bounds)
    layers = [
      {"name": LINE_SOURCE_LAYER, "features": []},
      {"name": SUBSTATION_SOURCE_LAYER, "features": []},
      {"name": PLANT_SOURCE_LAYER, "features": []},
      {"name": GENERATOR_SOURCE_LAYER, "features": []},
    ]

    if line_tree is not None:
      for index in line_tree.query(tile_box):
        feature = line_features[int(index)]
        if not feature_visible_at_zoom(feature, tile.z):
          continue
        geom = line_geoms[int(index)]
        if not geom.intersects(tile_box):
          continue
        clipped = clip_by_rect(geom, bounds.west, bounds.south, bounds.east, bounds.north)
        if clipped.is_empty:
          continue
        layers[0]["features"].append({
          "geometry": clipped,
          "properties": to_tile_properties(feature["properties"]),
        })

    if substation_tree is not None:
      for index in substation_tree.query(tile_box):
        feature = substation_features[int(index)]
        if not feature_visible_at_zoom(feature, tile.z):
          continue
        geom = substation_geoms[int(index)]
        if not geom.intersects(tile_box):
          continue
        layers[1]["features"].append({
          "geometry": geom,
          "properties": to_tile_properties(feature["properties"]),
        })

    if plant_tree is not None:
      for index in plant_tree.query(tile_box):
        feature = plant_features[int(index)]
        if not feature_visible_at_zoom(feature, tile.z):
          continue
        geom = plant_geoms[int(index)]
        if not geom.intersects(tile_box):
          continue
        layers[2]["features"].append({
          "geometry": geom,
          "properties": to_tile_properties(feature["properties"]),
        })

    if generator_tree is not None:
      for index in generator_tree.query(tile_box):
        feature = generator_features[int(index)]
        if not feature_visible_at_zoom(feature, tile.z):
          continue
        geom = generator_geoms[int(index)]
        if not geom.intersects(tile_box):
          continue
        layers[3]["features"].append({
          "geometry": geom,
          "properties": to_tile_properties(feature["properties"]),
        })

    tile_bytes = encode_vector_tile(
      layers,
      default_options={
        "quantize_bounds": tile_bounds,
        "extents": 4096,
      },
    )
    tile_path = tiles_dir / str(tile.z) / str(tile.x) / f"{tile.y}.pbf"
    tile_path.parent.mkdir(parents=True, exist_ok=True)
    tile_path.write_bytes(tile_bytes)
    tile_count += 1

  center = [(west + east) / 2, (south + north) / 2, minzoom]
  tilejson = {
    "tilejson": "3.0.0",
    "name": "China OSM power grid",
    "description": "Local vector tiles extracted from china-260517.osm.pbf power=line/cable/substation/plant/generator features.",
    "version": tile_version,
    "scheme": "xyz",
    "tiles": [tile_url_for(output_dir, tiles_dir)],
    "minzoom": minzoom,
    "maxzoom": maxzoom,
    "bounds": [round(west, 6), round(south, 6), round(east, 6), round(north, 6)],
    "center": [round(center[0], 6), round(center[1], 6), center[2]],
    "attribution": "(c) OpenStreetMap contributors",
    "vector_layers": [
      {
        "id": LINE_SOURCE_LAYER,
        "description": "OSM power=line/cable ways in China",
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        "fields": {
          "id": "String",
          "name": "String",
          "voltage": "String",
          "voltageKv": "Number",
          "voltageClass": "String",
          "status": "String",
          "osmType": "String",
          "osmId": "Number",
        },
      },
      {
        "id": SUBSTATION_SOURCE_LAYER,
        "description": "OSM power=substation nodes and way centroids in China",
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        "fields": {
          "id": "String",
          "name": "String",
          "voltage": "String",
          "voltageKv": "Number",
          "voltageClass": "String",
          "substation": "String",
          "osmType": "String",
          "osmId": "Number",
        },
      },
      {
        "id": PLANT_SOURCE_LAYER,
        "description": "OSM power=plant nodes and way centroids in China",
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        "fields": {
          "id": "String",
          "name": "String",
          "fuel": "String",
          "outputElectricity": "String",
          "status": "String",
          "osmType": "String",
          "osmId": "Number",
        },
      },
      {
        "id": GENERATOR_SOURCE_LAYER,
        "description": "OSM power=generator nodes and way centroids in China",
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        "fields": {
          "id": "String",
          "name": "String",
          "fuel": "String",
          "method": "String",
          "outputElectricity": "String",
          "status": "String",
          "osmType": "String",
          "osmId": "Number",
        },
      },
    ],
  }
  write_json(output_dir / "china-power-tilejson.json", tilejson)
  return {"tilesDir": str(tiles_dir), "tileCount": tile_count, "tilejson": tilejson}


def osm_power_filter() -> Any:
  filter_tags = [
    ("power", "line"),
    ("power", "cable"),
    ("power", "substation"),
    ("power", "plant"),
    ("power", "generator"),
    ("power", "construction"),
    ("power", "proposed"),
    ("power", "planned"),
  ]
  for prefix in LIFECYCLE_PREFIXES:
    for value in [*POWER_LINE_VALUES, *SUBSTATION_VALUES, *PLANT_VALUES, *GENERATOR_VALUES]:
      filter_tags.append((f"{prefix}:power", value))
  return osmium.filter.TagFilter(*filter_tags)


def keep_line_way(tags: dict[str, str], args: argparse.Namespace, stats: Counter[str]) -> bool:
  voltage = max_voltage_kv(tags)
  if voltage is None and not args.include_unknown_lines:
    stats["line_ways_without_voltage"] += 1
    return False
  if voltage is not None and voltage < args.min_line_voltage_kv:
    stats["line_ways_below_min_voltage"] += 1
    return False
  return True


def keep_substation(tags: dict[str, str], args: argparse.Namespace, stats: Counter[str], stats_prefix: str) -> bool:
  voltage = max_voltage_kv(tags)
  if voltage is None and not args.include_unknown_substations:
    stats[f"{stats_prefix}_without_voltage"] += 1
    return False
  if voltage is not None and voltage < args.min_substation_voltage_kv:
    stats[f"{stats_prefix}_below_min_voltage"] += 1
    return False
  return True


def collect_power_objects(input_file: Path, args: argparse.Namespace) -> tuple[list[NodeFeature], list[WayRecord], set[int], Counter[str]]:
  node_features: list[NodeFeature] = []
  ways: list[WayRecord] = []
  node_refs: set[int] = set()
  stats = Counter[str]()
  processor = osmium.FileProcessor(
    str(input_file),
    osmium.osm.NODE | osmium.osm.WAY,
  ).with_filter(osm_power_filter())

  for osm_object in processor:
    tags = iter_tags(osm_object)
    object_type = osm_object.type_str()
    if object_type == "n":
      point_kind = point_kind_from_tags(tags)
      if point_kind is None:
        continue
      if not osm_object.location.valid():
        stats[f"{point_kind}_nodes_without_location"] += 1
        continue
      lon = float(osm_object.location.lon)
      lat = float(osm_object.location.lat)
      if not is_valid_china_coordinate(lon, lat):
        stats[f"{point_kind}_nodes_outside_china_bbox"] += 1
        continue
      if point_kind == "substation" and not keep_substation(tags, args, stats, "substation_nodes"):
        continue
      node_features.append(NodeFeature(int(osm_object.id), point_kind, tags, lon, lat))
      stats[f"{point_kind}_nodes_used"] += 1
      continue

    if object_type != "w":
      continue

    kind: OsmKind | None = None
    if is_line_way(tags):
      if not keep_line_way(tags, args, stats):
        continue
      kind = "line"
    elif is_substation(tags):
      if not keep_substation(tags, args, stats, "substation_ways"):
        continue
      kind = "substation"
    elif is_plant(tags):
      kind = "plant"
    elif is_generator(tags):
      kind = "generator"
    if kind is None:
      continue

    refs = tuple(int(node.ref) for node in osm_object.nodes)
    if len(refs) < 2:
      stats[f"{kind}_ways_too_short"] += 1
      continue
    ways.append(WayRecord(int(osm_object.id), kind, tags, refs))
    node_refs.update(refs)
    stats[f"{kind}_ways_collected"] += 1

  return node_features, ways, node_refs, stats


def collect_referenced_coordinates(input_file: Path, node_refs: set[int]) -> dict[int, tuple[float, float]]:
  coordinates: dict[int, tuple[float, float]] = {}
  if not node_refs:
    return coordinates
  processor = osmium.FileProcessor(
    str(input_file),
    osmium.osm.NODE,
  ).with_filter(osmium.filter.IdFilter(node_refs))

  for node in processor:
    if node.location.valid():
      coordinates[int(node.id)] = (float(node.location.lon), float(node.location.lat))
  return coordinates


def build_features(
  input_file: Path,
  args: argparse.Namespace,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], Counter[str]]:
  print(f"Pass 1/2: scanning {input_file} for OSM power objects...", flush=True)
  node_features, ways, node_refs, stats = collect_power_objects(input_file, args)
  print(
    "Collected "
    f"{stats['line_ways_collected']} line ways, "
    f"{stats['substation_ways_collected']} substation ways, "
    f"{stats['plant_ways_collected']} plant ways, "
    f"{stats['generator_ways_collected']} generator ways, "
    f"{stats['substation_nodes_used']} substation nodes, "
    f"{stats['plant_nodes_used']} plant nodes, "
    f"{stats['generator_nodes_used']} generator nodes, "
    f"{len(node_refs)} needed node refs.",
    flush=True,
  )

  print("Pass 2/2: collecting coordinates for referenced way nodes...", flush=True)
  coordinates = collect_referenced_coordinates(input_file, node_refs)
  print(f"Resolved {len(coordinates)} referenced node coordinates.", flush=True)

  line_features: list[dict[str, Any]] = []
  substation_features: list[dict[str, Any]] = []
  plant_features: list[dict[str, Any]] = []
  generator_features: list[dict[str, Any]] = []
  point_features_by_kind = {
    "substation": substation_features,
    "plant": plant_features,
    "generator": generator_features,
  }

  for node_feature in node_features:
    point_features_by_kind[node_feature.kind].append(power_point_feature(
      osm_id=node_feature.osm_id,
      osm_type="node",
      tags=node_feature.tags,
      point=rounded_coord(node_feature.lon, node_feature.lat),
      kind=node_feature.kind,
    ))

  for record in ways:
    coords = [
      rounded_coord(lon, lat)
      for lon, lat in (coordinates[node_ref] for node_ref in record.node_refs if node_ref in coordinates)
      if is_valid_china_coordinate(lon, lat)
    ]
    missing_count = len(record.node_refs) - len(coords)
    if missing_count:
      stats[f"{record.kind}_missing_node_coordinates"] += missing_count
    if record.kind == "line":
      feature = line_feature(record, coords)
      if feature is None:
        stats["line_features_too_short_after_coordinates"] += 1
        continue
      line_features.append(feature)
    else:
      point = centroid_for_coords(coords)
      if point is None:
        stats[f"{record.kind}_way_features_without_centroid"] += 1
        continue
      point_features_by_kind[record.kind].append(power_point_feature(
        osm_id=record.osm_id,
        osm_type="way",
        tags=record.tags,
        point=point,
        kind=record.kind,
      ))

  return line_features, substation_features, plant_features, generator_features, stats


def class_counts(features: list[dict[str, Any]]) -> dict[str, int]:
  counts = Counter(str(feature["properties"].get("voltageClass", "low")) for feature in features)
  return dict(sorted(counts.items()))


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Extract OSM China power lines/substations/plants/generators into local app data.")
  parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Input .osm.pbf file.")
  parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory under public/data.")
  parser.add_argument("--minzoom", type=int, default=3, help="Minimum vector tile zoom.")
  parser.add_argument("--maxzoom", type=int, default=5, help="Maximum vector tile zoom; MapLibre overzooms above this.")
  parser.add_argument("--min-line-voltage-kv", type=float, default=35, help="Known line voltages below this are skipped.")
  parser.add_argument("--min-substation-voltage-kv", type=float, default=35, help="Known substation voltages below this are skipped.")
  parser.add_argument("--exclude-unknown-lines", action="store_false", dest="include_unknown_lines", help="Skip line/cable ways without voltage tags.")
  parser.add_argument("--exclude-unknown-substations", action="store_false", dest="include_unknown_substations", help="Skip substations without voltage tags.")
  parser.add_argument("--skip-tiles", action="store_true", help="Write GeoJSON/summary only.")
  parser.add_argument("--tiles-only", action="store_true", help="Build tiles from existing GeoJSON outputs without re-reading the PBF.")
  parser.add_argument("--tile-version", default="", help="Versioned tiles folder name. Defaults to input stem + zooms + timestamp.")
  parser.set_defaults(include_unknown_lines=True, include_unknown_substations=True)
  args = parser.parse_args()
  if args.minzoom < 0 or args.maxzoom < args.minzoom:
    raise SystemExit("--maxzoom must be greater than or equal to --minzoom")
  return args


def main() -> None:
  args = parse_args()
  input_file = args.input.resolve()
  output_dir = args.output_dir.resolve()
  if not input_file.exists():
    raise FileNotFoundError(f"Input PBF not found: {input_file}")

  generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
  tile_version = args.tile_version or f"{slug_text(input_file.stem, 'china-osm-power')}-z{args.minzoom}-{args.maxzoom}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
  output_dir.mkdir(parents=True, exist_ok=True)

  lines_path = output_dir / "china-power-lines.geojson"
  substations_path = output_dir / "china-power-substations.geojson"
  plants_path = output_dir / "china-power-plants.geojson"
  generators_path = output_dir / "china-power-generators.geojson"
  if args.tiles_only:
    if not lines_path.exists() or not substations_path.exists():
      raise FileNotFoundError("Missing existing GeoJSON outputs; run without --tiles-only first.")
    print("Loading existing GeoJSON outputs for tile rebuild...", flush=True)
    line_features = json.loads(lines_path.read_text(encoding="utf-8"))["features"]
    substation_features = json.loads(substations_path.read_text(encoding="utf-8"))["features"]
    plant_features = json.loads(plants_path.read_text(encoding="utf-8"))["features"] if plants_path.exists() else []
    generator_features = json.loads(generators_path.read_text(encoding="utf-8"))["features"] if generators_path.exists() else []
    stats = Counter[str]({"tiles_only_rebuild": 1})
  else:
    line_features, substation_features, plant_features, generator_features, stats = build_features(input_file, args)
    write_json(lines_path, feature_collection(line_features))
    write_json(substations_path, feature_collection(substation_features))
    write_json(plants_path, feature_collection(plant_features))
    write_json(generators_path, feature_collection(generator_features))
    print(f"Wrote {lines_path} ({len(line_features)} features).", flush=True)
    print(f"Wrote {substations_path} ({len(substation_features)} features).", flush=True)
    print(f"Wrote {plants_path} ({len(plant_features)} features).", flush=True)
    print(f"Wrote {generators_path} ({len(generator_features)} features).", flush=True)

  tile_summary: dict[str, Any] | None = None
  if not args.skip_tiles:
    print(f"Building vector tiles z{args.minzoom}-{args.maxzoom}...", flush=True)
    tile_summary = build_vector_tiles(
      line_features=line_features,
      substation_features=substation_features,
      plant_features=plant_features,
      generator_features=generator_features,
      output_dir=output_dir,
      tile_version=tile_version,
      minzoom=args.minzoom,
      maxzoom=args.maxzoom,
    )
    print(
      f"Wrote {tile_summary['tileCount']} vector tiles and "
      f"{output_dir / 'china-power-tilejson.json'}.",
      flush=True,
    )

  summary = {
    "generatedAt": generated_at,
    "generatedBy": "scripts/build-china-osm-power-data.py",
    "input": str(input_file),
    "source": OSM_SOURCE_NAME,
    "filters": {
      "linePowerValues": sorted(POWER_LINE_VALUES),
      "substationPowerValues": sorted(SUBSTATION_VALUES),
      "plantPowerValues": sorted(PLANT_VALUES),
      "generatorPowerValues": sorted(GENERATOR_VALUES),
      "minLineVoltageKv": args.min_line_voltage_kv,
      "minSubstationVoltageKv": args.min_substation_voltage_kv,
      "includeUnknownLines": args.include_unknown_lines,
      "includeUnknownSubstations": args.include_unknown_substations,
    },
    "outputs": {
      "linesGeoJson": str(lines_path),
      "substationsGeoJson": str(substations_path),
      "plantsGeoJson": str(plants_path),
      "generatorsGeoJson": str(generators_path),
      "tileJson": str(output_dir / "china-power-tilejson.json") if tile_summary else None,
      "tilesDir": tile_summary["tilesDir"] if tile_summary else None,
    },
    "counts": {
      "lines": len(line_features),
      "substations": len(substation_features),
      "plants": len(plant_features),
      "generators": len(generator_features),
      "lineVoltageClasses": class_counts(line_features),
      "substationVoltageClasses": class_counts(substation_features),
      "tiles": tile_summary["tileCount"] if tile_summary else 0,
    },
    "stats": dict(sorted(stats.items())),
  }
  write_json(output_dir / "summary.json", summary)
  print(f"Wrote {output_dir / 'summary.json'}.", flush=True)
  print(
    "Done: "
    f"{len(line_features)} lines, {len(substation_features)} substations, "
    f"{len(plant_features)} plants, {len(generator_features)} generators, "
    f"{summary['counts']['tiles']} tiles.",
    flush=True,
  )


if __name__ == "__main__":
  main()
