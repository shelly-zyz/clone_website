"""Build frontend-ready climate VRE projection data.

This script is the offline "prediction data steward" for the app. It reads the
paper-provided VRE MATLAB v7.3 file, validates its variables, aggregates 0.5
degree grid-cell capacity factors to China and provinces, and writes compact
JSON files for the browser.
"""

from __future__ import annotations

import argparse
import calendar
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
  import h5py
  import numpy as np
except ImportError as error:
  raise SystemExit(
    "Missing scientific Python dependency. Install h5py and numpy, or run with "
    "an environment such as Anaconda that provides them.\n"
    f"Original error: {error}"
  ) from error


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = REPO_ROOT.parent / "data" / "VRE_gfdl-esm4_ssp126_2021_2060.mat"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "public" / "data" / "climate-vre"
ADMIN1_GEOJSON = REPO_ROOT / "public" / "data" / "natural-earth" / "ne_50m_admin_1_states_provinces.geojson"
CHINA_MAP_DATA_FILE = REPO_ROOT / "src" / "lib" / "china-map-data.generated.json"

START_YEAR = 2021
END_YEAR = 2060
EXPECTED_HOURS = sum((366 if calendar.isleap(year) else 365) * 24 for year in range(START_YEAR, END_YEAR + 1))
EXPECTED_VARIABLES = ("CF_Wind", "CF_PV", "lon_lat_of_VRE_output")
TECHNOLOGIES = {
  "wind": {"dataset": "CF_Wind", "label": "风电"},
  "solar": {"dataset": "CF_PV", "label": "光伏"},
}
ASSET_TECHNOLOGY_BUCKETS = {
  "wind": "wind",
  "offshore": "wind",
  "solar": "solar",
}
CURRENT_CAPACITY_STATUSES = {"operating"}
CAPACITY_BASIS = "current_mapped_operating_assets"
CAPACITY_BASIS_LABEL = "按现有地图中已投运风电/光伏装机估算"
PAPER_URL = "https://www.nature.com/articles/s41597-025-06396-5"
ZENODO_URL = "https://doi.org/10.5281/zenodo.15832921"
CODE_URL = "https://github.com/RuijieChen-123/Convert_climate_variable_to_VRE_generation"


Coordinates = tuple[float, float]


@dataclass(frozen=True)
class Province:
  id: str
  label: str
  geometry: dict[str, Any]
  bbox: tuple[float, float, float, float]
  centroid: Coordinates


@dataclass(frozen=True)
class Region:
  id: str
  label: str
  grid_indices: np.ndarray
  fallback_assigned: int = 0


def read_json(path: Path) -> Any:
  with path.open("r", encoding="utf-8") as handle:
    return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))


def slugify(value: str, fallback: str) -> str:
  text = "".join(char.lower() if char.isalnum() else "-" for char in value)
  parts = [part for part in text.split("-") if part]
  return "-".join(parts) or fallback


def iter_polygon_rings(geometry: dict[str, Any]) -> Iterable[list[Coordinates]]:
  geometry_type = geometry.get("type")
  coordinates = geometry.get("coordinates", [])

  if geometry_type == "Polygon":
    for polygon in coordinates:
      yield [(float(lon), float(lat)) for lon, lat in polygon]
    return

  if geometry_type == "MultiPolygon":
    for multipolygon in coordinates:
      for polygon in multipolygon:
        yield [(float(lon), float(lat)) for lon, lat in polygon]


def iter_polygon_shells(geometry: dict[str, Any]) -> Iterable[list[Coordinates]]:
  geometry_type = geometry.get("type")
  coordinates = geometry.get("coordinates", [])

  if geometry_type == "Polygon":
    if coordinates:
      yield [(float(lon), float(lat)) for lon, lat in coordinates[0]]
    return

  if geometry_type == "MultiPolygon":
    for multipolygon in coordinates:
      if multipolygon:
        yield [(float(lon), float(lat)) for lon, lat in multipolygon[0]]


def point_in_ring(lon: float, lat: float, ring: list[Coordinates]) -> bool:
  inside = False
  j = len(ring) - 1
  for i, (xi, yi) in enumerate(ring):
    xj, yj = ring[j]
    intersects = (yi > lat) != (yj > lat)
    if intersects:
      x_at_lat = (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
      if lon < x_at_lat:
        inside = not inside
    j = i
  return inside


def point_in_geometry(lon: float, lat: float, geometry: dict[str, Any]) -> bool:
  geometry_type = geometry.get("type")
  coordinates = geometry.get("coordinates", [])

  polygons = [coordinates] if geometry_type == "Polygon" else coordinates
  for polygon in polygons:
    if not polygon:
      continue
    shell = [(float(x), float(y)) for x, y in polygon[0]]
    if not point_in_ring(lon, lat, shell):
      continue
    holes = [[(float(x), float(y)) for x, y in ring] for ring in polygon[1:]]
    if any(point_in_ring(lon, lat, hole) for hole in holes):
      continue
    return True
  return False


def geometry_bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
  points = [point for ring in iter_polygon_rings(geometry) for point in ring]
  lons = [point[0] for point in points]
  lats = [point[1] for point in points]
  return min(lons), min(lats), max(lons), max(lats)


def geometry_centroid(geometry: dict[str, Any]) -> Coordinates:
  points = [point for ring in iter_polygon_shells(geometry) for point in ring]
  if not points:
    return 104.0, 35.0
  return sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points)


def load_china_provinces(path: Path) -> list[Province]:
  data = read_json(path)
  provinces: list[Province] = []
  for feature in data.get("features", []):
    properties = feature.get("properties", {})
    if properties.get("iso_a2") != "CN" and properties.get("adm0_a3") != "CHN":
      continue
    label = properties.get("name_en") or properties.get("name") or properties.get("adm1_code") or "Province"
    iso_code = str(properties.get("iso_3166_2") or properties.get("adm1_code") or label)
    region_id = slugify(iso_code.replace("CN-", "cn-"), slugify(label, "province"))
    geometry = feature.get("geometry", {})
    provinces.append(
      Province(
        id=region_id,
        label=str(label),
        geometry=geometry,
        bbox=geometry_bbox(geometry),
        centroid=geometry_centroid(geometry),
      )
    )
  provinces.sort(key=lambda item: item.label)
  if not provinces:
    raise SystemExit(f"No China admin-1 provinces found in {path}")
  return provinces


def match_province(lon: float, lat: float, provinces: list[Province]) -> tuple[Province, bool]:
  for province in provinces:
    west, south, east, north = province.bbox
    if not (west <= lon <= east and south <= lat <= north):
      continue
    if point_in_geometry(lon, lat, province.geometry):
      return province, False

  return min(
    provinces,
    key=lambda province: (province.centroid[0] - lon) ** 2 + (province.centroid[1] - lat) ** 2,
  ), True


def assign_regions(lon_lat: np.ndarray, provinces: list[Province]) -> tuple[list[Region], list[dict[str, Any]]]:
  if lon_lat.shape[0] != 2:
    raise SystemExit(f"Expected lon_lat_of_VRE_output shape (2, n), got {lon_lat.shape}")

  province_assignments: dict[str, list[int]] = {province.id: [] for province in provinces}
  fallback_counts: dict[str, int] = {province.id: 0 for province in provinces}
  diagnostics: list[dict[str, Any]] = []

  for index in range(lon_lat.shape[1]):
    lon = float(lon_lat[0, index])
    lat = float(lon_lat[1, index])
    matched, used_fallback = match_province(lon, lat, provinces)
    if used_fallback:
      fallback_counts[matched.id] += 1
      diagnostics.append({
        "gridIndex": index,
        "lon": round(lon, 6),
        "lat": round(lat, 6),
        "assignedRegionId": matched.id,
        "assignedRegionLabel": matched.label,
      })

    province_assignments[matched.id].append(index)

  all_indices = np.arange(lon_lat.shape[1], dtype=np.int64)
  regions = [Region(id="china", label="全国", grid_indices=all_indices)]
  for province in provinces:
    indices = np.array(province_assignments[province.id], dtype=np.int64)
    if len(indices) == 0:
      continue
    regions.append(
      Region(
        id=province.id,
        label=province.label,
        grid_indices=indices,
        fallback_assigned=fallback_counts[province.id],
      )
    )
  return regions, diagnostics


def load_capacity_basis(provinces: list[Province], regions: list[Region]) -> tuple[dict[str, dict[str, float]], dict[str, Any]]:
  if not CHINA_MAP_DATA_FILE.exists():
    zero_capacities = {region.id: {technology: 0.0 for technology in TECHNOLOGIES} for region in regions}
    return zero_capacities, {
      "basis": CAPACITY_BASIS,
      "basisLabel": CAPACITY_BASIS_LABEL,
      "source": str(CHINA_MAP_DATA_FILE),
      "warning": "Map asset data file was not found; generation estimates are zero.",
    }

  capacities = {region.id: {technology: 0.0 for technology in TECHNOLOGIES} for region in regions}
  diagnostics = {
    "basis": CAPACITY_BASIS,
    "basisLabel": CAPACITY_BASIS_LABEL,
    "source": str(CHINA_MAP_DATA_FILE),
    "includedStatuses": sorted(CURRENT_CAPACITY_STATUSES),
    "technologyMapping": ASSET_TECHNOLOGY_BUCKETS,
    "assetCount": 0,
    "fallbackAssignments": 0,
    "unmatchedRegionAssets": 0,
    "capacityMwByTechnology": {technology: 0.0 for technology in TECHNOLOGIES},
  }

  region_ids = {region.id for region in regions}
  map_data = read_json(CHINA_MAP_DATA_FILE)
  for asset in map_data.get("energyAssets", []):
    if asset.get("countryCode") != "CN":
      continue
    if str(asset.get("status", "")).strip().lower() not in CURRENT_CAPACITY_STATUSES:
      continue
    bucket = ASSET_TECHNOLOGY_BUCKETS.get(str(asset.get("technology", "")).strip().lower())
    if bucket is None:
      continue
    try:
      capacity_mw = float(asset.get("capacityMw", 0))
      lon = float(asset.get("lng"))
      lat = float(asset.get("lat"))
    except (TypeError, ValueError):
      continue
    if not math.isfinite(capacity_mw) or capacity_mw <= 0 or not math.isfinite(lon) or not math.isfinite(lat):
      continue

    matched, used_fallback = match_province(lon, lat, provinces)
    diagnostics["assetCount"] += 1
    diagnostics["capacityMwByTechnology"][bucket] += capacity_mw
    capacities["china"][bucket] += capacity_mw
    if used_fallback:
      diagnostics["fallbackAssignments"] += 1
    if matched.id in region_ids:
      capacities[matched.id][bucket] += capacity_mw
    else:
      diagnostics["unmatchedRegionAssets"] += 1

  for region_capacities in capacities.values():
    for technology, capacity_mw in region_capacities.items():
      region_capacities[technology] = round(capacity_mw, 3)
  diagnostics["capacityMwByTechnology"] = {
    technology: round(capacity_mw, 3)
    for technology, capacity_mw in diagnostics["capacityMwByTechnology"].items()
  }
  return capacities, diagnostics


def year_slices() -> list[tuple[int, int, int]]:
  slices: list[tuple[int, int, int]] = []
  offset = 0
  for year in range(START_YEAR, END_YEAR + 1):
    hours = (366 if calendar.isleap(year) else 365) * 24
    slices.append((year, offset, offset + hours))
    offset += hours
  return slices


def month_slices(year: int) -> list[tuple[int, int, int]]:
  slices: list[tuple[int, int, int]] = []
  offset = 0
  for month in range(1, 13):
    hours = calendar.monthrange(year, month)[1] * 24
    slices.append((month, offset, offset + hours))
    offset += hours
  return slices


def quantize_capacity_factor(values: np.ndarray) -> list[int]:
  clipped = np.clip(np.nan_to_num(values, nan=0.0, posinf=1.0, neginf=0.0), 0.0, 1.0)
  return np.rint(clipped * 10000).astype(np.int16).tolist()


def summarize_hourly(values: np.ndarray, year: int, capacity_mw: float) -> dict[str, Any]:
  finite_values = np.nan_to_num(values, nan=0.0, posinf=1.0, neginf=0.0)
  peak_index = int(np.argmax(finite_values))
  low_index = int(np.argmin(finite_values))
  monthly_means = []
  for month, start, end in month_slices(year):
    mean = float(np.mean(finite_values[start:end]))
    monthly_means.append({
      "month": month,
      "mean": round(mean, 6),
      "generationGwh": round(mean * capacity_mw * (end - start) / 1000, 6),
    })
  annual_mean = float(np.mean(finite_values))
  hours = len(finite_values)
  return {
    "mean": round(annual_mean, 6),
    "capacityBasis": CAPACITY_BASIS,
    "capacityBasisLabel": CAPACITY_BASIS_LABEL,
    "capacityMw": round(capacity_mw, 3),
    "annualGenerationGwh": round(annual_mean * capacity_mw * hours / 1000, 6),
    "peakPowerMw": round(float(finite_values[peak_index]) * capacity_mw, 6),
    "lowPowerMw": round(float(finite_values[low_index]) * capacity_mw, 6),
    "peak": {"hourOfYear": peak_index, "value": round(float(finite_values[peak_index]), 6)},
    "low": {"hourOfYear": low_index, "value": round(float(finite_values[low_index]), 6)},
    "monthlyMeans": monthly_means,
  }


def validate_file(handle: h5py.File) -> tuple[int, int]:
  missing = [name for name in EXPECTED_VARIABLES if name not in handle]
  if missing:
    raise SystemExit(f"Missing required VRE variable(s): {', '.join(missing)}")

  wind_shape = tuple(handle["CF_Wind"].shape)
  solar_shape = tuple(handle["CF_PV"].shape)
  lon_lat_shape = tuple(handle["lon_lat_of_VRE_output"].shape)
  if wind_shape != solar_shape:
    raise SystemExit(f"CF_Wind shape {wind_shape} does not match CF_PV shape {solar_shape}")
  if wind_shape[0] != EXPECTED_HOURS:
    raise SystemExit(f"Expected {EXPECTED_HOURS} hourly rows for 2021-2060, got {wind_shape[0]}")
  if lon_lat_shape != (2, wind_shape[1]):
    raise SystemExit(f"Expected lon/lat shape (2, {wind_shape[1]}), got {lon_lat_shape}")
  return wind_shape


def build_dataset(input_path: Path, output_dir: Path, gcm: str, scenario: str) -> dict[str, Any]:
  if not input_path.exists():
    raise SystemExit(f"VRE .mat file not found: {input_path}")
  if not ADMIN1_GEOJSON.exists():
    raise SystemExit(f"Province boundary file not found: {ADMIN1_GEOJSON}")

  output_dir.mkdir(parents=True, exist_ok=True)
  generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
  provinces = load_china_provinces(ADMIN1_GEOJSON)

  annual_summary: list[dict[str, Any]] = []
  warnings: list[dict[str, Any]] = []
  written_files: list[str] = []

  with h5py.File(input_path, "r") as handle:
    hours, grid_count = validate_file(handle)
    lon_lat = np.array(handle["lon_lat_of_VRE_output"][:], dtype=np.float64)
    regions, fallback_diagnostics = assign_regions(lon_lat, provinces)
    capacity_by_region, capacity_diagnostics = load_capacity_basis(provinces, regions)

    for technology, meta in TECHNOLOGIES.items():
      dataset = handle[meta["dataset"]]
      for year, start, end in year_slices():
        year_data = np.array(dataset[start:end, :], dtype=np.float32)
        data_min = float(np.nanmin(year_data))
        data_max = float(np.nanmax(year_data))
        if data_min < -1e-5 or data_max > 1.00001:
          warnings.append({
            "technology": technology,
            "year": year,
            "min": round(data_min, 6),
            "max": round(data_max, 6),
            "message": "Capacity factor values outside [0, 1] were clipped in hourly JSON output.",
          })

        for region in regions:
          capacity_mw = capacity_by_region.get(region.id, {}).get(technology, 0.0)
          region_values = np.nanmean(year_data[:, region.grid_indices], axis=1)
          stats = summarize_hourly(region_values, year, capacity_mw)
          annual_summary.append({
            "regionId": region.id,
            "regionLabel": region.label,
            "technology": technology,
            "year": year,
            **stats,
          })

          hourly_payload = {
            "gcm": gcm,
            "scenario": scenario,
            "regionId": region.id,
            "regionLabel": region.label,
            "technology": technology,
            "unit": "capacity_factor",
            "powerUnit": "mw",
            "energyUnit": "gwh",
            "capacityBasis": CAPACITY_BASIS,
            "capacityBasisLabel": CAPACITY_BASIS_LABEL,
            "capacityMw": round(capacity_mw, 3),
            "scale": 10000,
            "year": year,
            "hours": int(end - start),
            "values": quantize_capacity_factor(region_values),
            "stats": stats,
          }
          hourly_path = output_dir / "hourly" / region.id / f"{year}-{technology}.json"
          write_json(hourly_path, hourly_payload)
          written_files.append(str(hourly_path.relative_to(REPO_ROOT)))

  region_payload = [
    {
      "id": region.id,
      "label": region.label,
      "gridCount": int(len(region.grid_indices)),
      "fallbackAssignedGridCount": int(region.fallback_assigned),
      "capacityMwByTechnology": capacity_by_region.get(region.id, {technology: 0.0 for technology in TECHNOLOGIES}),
    }
    for region in regions
  ]

  summary_payload = {
    "generatedAt": generated_at,
    "gcm": gcm,
    "scenario": scenario,
    "unit": "capacity_factor",
    "powerUnit": "mw",
    "energyUnit": "gwh",
    "capacityBasis": CAPACITY_BASIS,
    "capacityBasisLabel": CAPACITY_BASIS_LABEL,
    "annual": annual_summary,
  }
  write_json(output_dir / "summary.json", summary_payload)
  written_files.append(str((output_dir / "summary.json").relative_to(REPO_ROOT)))

  manifest_payload = {
    "generatedAt": generated_at,
    "generatedBy": "scripts/build-climate-vre-data.py",
    "gcm": gcm,
    "scenario": scenario,
    "unit": "capacity_factor",
    "powerUnit": "mw",
    "energyUnit": "gwh",
    "capacityBasis": CAPACITY_BASIS,
    "capacityBasisLabel": CAPACITY_BASIS_LABEL,
    "timeRange": {
      "start": f"{START_YEAR}-01-01T00:00:00",
      "end": f"{END_YEAR}-12-31T23:00:00",
      "hours": EXPECTED_HOURS,
    },
    "source": {
      "input": str(input_path),
      "paper": PAPER_URL,
      "zenodo": ZENODO_URL,
      "code": CODE_URL,
    },
    "technologies": [
      {"key": key, "label": meta["label"]}
      for key, meta in TECHNOLOGIES.items()
    ],
    "years": list(range(START_YEAR, END_YEAR + 1)),
    "regions": region_payload,
    "summaryPath": "/data/climate-vre/summary.json",
    "hourlyPathTemplate": "/data/climate-vre/hourly/{regionId}/{year}-{technology}.json",
  }
  write_json(output_dir / "manifest.json", manifest_payload)
  written_files.append(str((output_dir / "manifest.json").relative_to(REPO_ROOT)))

  report_payload = {
    "status": "ok",
    "generatedAt": generated_at,
    "input": str(input_path),
    "outputDir": str(output_dir),
    "variables": list(EXPECTED_VARIABLES),
    "hours": EXPECTED_HOURS,
    "gridCount": int(region_payload[0]["gridCount"]),
    "regions": region_payload,
    "capacityBasis": capacity_diagnostics,
    "warnings": warnings,
    "fallbackAssignments": {
      "count": len(fallback_diagnostics),
      "sample": fallback_diagnostics[:25],
    },
    "writtenFileCount": len(written_files),
    "writtenFilesSample": written_files[:30],
  }
  write_json(output_dir / "agent-report.json", report_payload)
  written_files.append(str((output_dir / "agent-report.json").relative_to(REPO_ROOT)))
  return report_payload


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Build GFDL-ESM4 SSP126 VRE projection data for the website.")
  parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Path to VRE_gfdl-esm4_ssp126_2021_2060.mat")
  parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory under public/data")
  parser.add_argument("--gcm", default="gfdl-esm4", help="GCM id for manifest metadata")
  parser.add_argument("--scenario", default="ssp126", help="Scenario id for manifest metadata")
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  report = build_dataset(args.input.resolve(), args.output.resolve(), args.gcm, args.scenario)
  print(json.dumps({
    "status": report["status"],
    "regions": len(report["regions"]),
    "writtenFileCount": report["writtenFileCount"],
    "warnings": len(report["warnings"]),
    "fallbackAssignments": report["fallbackAssignments"]["count"],
  }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
  main()
