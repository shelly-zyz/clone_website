"""Build China map data from downloaded source archives.

The app consumes a compact point dataset in the same shape as the existing
OpenGridWorks-style map data. This script keeps the large downloaded archives
outside the Next.js bundle and writes a generated JSON file for the frontend.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import struct
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import pandas as pd


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT.parent / "data"
SUPPLEMENT_DATA_DIR = REPO_ROOT.parent / "supplement data"
OUTPUT_FILE = REPO_ROOT / "src" / "lib" / "china-map-data.generated.json"
CHINA_PV_SUMMARY_FILE = REPO_ROOT / "public" / "data" / "china-pv" / "solar-footprints-summary.json"
VALIDATION_DIR = REPO_ROOT / "public" / "data" / "china-validation"
OFFICIAL_TOTALS_FILE = VALIDATION_DIR / "official-totals.json"
COVERAGE_SUMMARY_FILE = VALIDATION_DIR / "coverage-summary.json"
RISK_CANDIDATE_FILE = VALIDATION_DIR / "coastal-risk-candidate.json"
PEERINGDB_MANUAL_REVIEW_FILE = REPO_ROOT / "docs" / "research" / "opengridworks" / "peeringdb-cn-manual-review.csv"

CURRENT_YEAR = 2026
GEM_MIN_CAPACITY_MW = 100
HYDRO_MIN_CAPACITY_MW = 100
PEERINGDB_FACILITY_URL = "https://www.peeringdb.com/api/fac"
PEERINGDB_FIELDS = [
  "id",
  "name",
  "org_id",
  "org_name",
  "city",
  "state",
  "country",
  "latitude",
  "longitude",
  "website",
  "status",
  "updated",
]


@dataclass(frozen=True)
class SourceSummary:
  name: str
  rows_read: int
  rows_used: int
  rows_enriched: int = 0
  rows_rejected: int = 0
  notes: tuple[str, ...] = ()


def clean_string(value: object, fallback: str = "") -> str:
  if value is None:
    return fallback
  if isinstance(value, float) and math.isnan(value):
    return fallback
  text = str(value).strip()
  if text in {"", "-", "--", "nan", "NaN"}:
    return fallback
  return re.sub(r"\s+", " ", text)


def clean_number(value: object) -> float | None:
  if value is None:
    return None
  if isinstance(value, float) and math.isnan(value):
    return None
  text = str(value).replace(",", "").strip()
  if text in {"", "-", "--", "nan", "NaN"}:
    return None
  try:
    number = float(text)
  except ValueError:
    return None
  if not math.isfinite(number):
    return None
  return number


def is_valid_china_coordinate(lat: float | None, lng: float | None) -> bool:
  return (
    lat is not None
    and lng is not None
    and 18 <= lat <= 54
    and 73 <= lng <= 136
  )


def slugify(value: str, fallback: str) -> str:
  slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
  return slug or fallback


def make_asset(
  *,
  prefix: str,
  raw_id: str,
  name: str,
  technology: str,
  capacity_mw: float,
  status: str,
  source: str,
  lat: float,
  lng: float,
  owner: object = "",
  operator: object = "",
  source_id: object = "",
  commissioning_year: object = None,
  extra: dict[str, object] | None = None,
) -> dict[str, object]:
  asset: dict[str, object] = {
    "id": f"cn-{prefix}-{slugify(raw_id, slugify(name, 'asset'))}",
    "name": name,
    "technology": technology,
    "capacityMw": round(capacity_mw, 2),
    "status": status,
    "countryCode": "CN",
    "regionId": "china",
    "source": source,
    "lat": round(lat, 6),
    "lng": round(lng, 6),
  }

  optional_strings = {
    "owner": clean_string(owner),
    "operator": clean_string(operator),
    "sourceId": clean_string(source_id),
  }
  for key, value in optional_strings.items():
    if value:
      asset[key] = value

  year = clean_number(commissioning_year)
  if year is not None and 1800 <= year <= CURRENT_YEAR + 30:
    asset["commissioningYear"] = int(year)

  if extra:
    for key, value in extra.items():
      if isinstance(value, str):
        cleaned = clean_string(value)
        if cleaned:
          asset[key] = cleaned
      elif isinstance(value, int | float) and math.isfinite(value):
        asset[key] = round(float(value), 3)

  return asset


def normalize_city(value: str) -> str:
  return {
    "Beijin": "Beijing",
    "Shangai": "Shanghai",
    "Hohhot City": "Hohhot",
    "Chengde city": "Chengde",
  }.get(value, value)


def map_wri_fuel(value: str) -> str | None:
  return {
    "Coal": "coal",
    "Gas": "gas",
    "Nuclear": "nuclear",
    "Oil": "oil",
    "Geothermal": "geothermal",
    "Biomass": "biomass",
    "Waste": "biomass",
    "Other": "other",
  }.get(value)


def map_gem_status(value: str) -> str | None:
  status = value.lower()
  if any(word in status for word in ["cancelled", "shelved", "retired", "mothballed"]):
    return None
  if "operating" in status:
    return "Operating"
  if "construction" in status and "pre-construction" not in status:
    return "Construction"
  if "permit" in status:
    return "Permitting"
  return "Planned"


def map_hydro_status(value: str, start_year: float | None) -> str:
  status = value.lower()
  if "operating" in status or "completed" in status:
    return "Operating"
  if "construction" in status and "pre-construction" not in status:
    return "Construction"
  if "permit" in status:
    return "Permitting"
  if "announced" in status or "pre-construction" in status or "planned" in status:
    return "Planned"
  if start_year is not None and start_year > CURRENT_YEAR:
    return "Planned"
  return "Operating"


def read_wri_non_variable_renewables() -> tuple[list[dict[str, object]], SourceSummary]:
  archive = DATA_DIR / "globalpowerplantdatabasev130.zip"
  rows: list[dict[str, object]] = []
  rows_read = 0
  rows_enriched = 0

  with zipfile.ZipFile(archive) as zf:
    with zf.open("global_power_plant_database.csv") as csv_file:
      text_file = io.TextIOWrapper(csv_file, encoding="utf-8", newline="")
      reader = csv.DictReader(text_file)
      for row in reader:
        if row.get("country") != "CHN":
          continue
        rows_read += 1
        technology = map_wri_fuel(clean_string(row.get("primary_fuel")))
        capacity = clean_number(row.get("capacity_mw"))
        lat = clean_number(row.get("latitude"))
        lng = clean_number(row.get("longitude"))
        if (
          technology is None
          or capacity is None
          or capacity <= 0
          or not is_valid_china_coordinate(lat, lng)
        ):
          continue
        raw_id = clean_string(row.get("gppd_idnr"), clean_string(row.get("name"), "wri"))
        owner = clean_string(row.get("owner"))
        if owner:
          rows_enriched += 1
        rows.append(make_asset(
          prefix="wri",
          raw_id=raw_id,
          name=clean_string(row.get("name"), "China power plant"),
          technology=technology,
          capacity_mw=capacity,
          status="Operating",
          source="Global Power Plant Database v1.3.0",
          lat=lat or 0,
          lng=lng or 0,
          owner=owner,
          source_id=raw_id,
          commissioning_year=row.get("commissioning_year"),
        ))

  return rows, SourceSummary(
    "Global Power Plant Database v1.3.0",
    rows_read,
    len(rows),
    rows_enriched=rows_enriched,
    rows_rejected=rows_read - len(rows),
    notes=("Owner is preserved when WRI provides it.",),
  )


def read_gem_workbook(
  *,
  member_name: str,
  sheet_name: str,
  technology_for_row: Callable[[pd.Series], str],
  source_name: str,
  prefix: str,
) -> tuple[list[dict[str, object]], SourceSummary]:
  archive = DATA_DIR / "gem-data.zip"
  rows: list[dict[str, object]] = []

  with zipfile.ZipFile(archive) as zf:
    dataframe = pd.read_excel(io.BytesIO(zf.read(member_name)), sheet_name=sheet_name)

  china_rows = dataframe[dataframe["Country/Area"] == "China"]
  rows_enriched = 0
  for _, row in china_rows.iterrows():
    capacity = clean_number(row.get("Capacity (MW)"))
    lat = clean_number(row.get("Latitude"))
    lng = clean_number(row.get("Longitude"))
    status = map_gem_status(clean_string(row.get("Status")))
    if (
      capacity is None
      or capacity < GEM_MIN_CAPACITY_MW
      or status is None
      or not is_valid_china_coordinate(lat, lng)
    ):
      continue

    project_name = clean_string(row.get("Project Name"), "China energy project")
    phase_name = clean_string(row.get("Phase Name"))
    display_name = project_name if phase_name in {"", "--"} else f"{project_name} - {phase_name}"
    raw_id = clean_string(row.get("GEM phase ID"), clean_string(row.get("GEM location ID"), display_name))
    owner = clean_string(row.get("Owner"), clean_string(row.get("Owner Name in Local Language / Script")))
    operator = clean_string(row.get("Operator"), clean_string(row.get("Operator Name in Local Language / Script")))
    if owner or operator:
      rows_enriched += 1

    rows.append(make_asset(
      prefix=prefix,
      raw_id=raw_id,
      name=display_name,
      technology=technology_for_row(row),
      capacity_mw=capacity,
      status=status,
      source=source_name,
      lat=lat or 0,
      lng=lng or 0,
      owner=owner,
      operator=operator,
      source_id=raw_id,
      commissioning_year=row.get("Start year"),
    ))

  return rows, SourceSummary(
    source_name,
    len(china_rows),
    len(rows),
    rows_enriched=rows_enriched,
    rows_rejected=len(china_rows) - len(rows),
    notes=("Owner, operator, GEM IDs, and start year are preserved when available.",),
  )


def read_gem_assets() -> tuple[list[dict[str, object]], list[SourceSummary]]:
  solar, solar_summary = read_gem_workbook(
    member_name="Global-Solar-Power-Tracker-February-2026.xlsx",
    sheet_name="Utility-Scale (1 MW+)",
    technology_for_row=lambda _row: "solar",
    source_name="Global Energy Monitor Solar Power Tracker, February 2026",
    prefix="gem-solar",
  )
  wind, wind_summary = read_gem_workbook(
    member_name="Global-Wind-Power-Tracker-February-2026.xlsx",
    sheet_name="Data",
    technology_for_row=lambda row: "offshore" if "offshore" in clean_string(row.get("Installation Type")).lower() else "wind",
    source_name="Global Energy Monitor Wind Power Tracker, February 2026",
    prefix="gem-wind",
  )
  return [*solar, *wind], [solar_summary, wind_summary]


def read_china_hydro_assets() -> tuple[list[dict[str, object]], SourceSummary]:
  archive = DATA_DIR / "China Hydropower Station Dataset.zip"
  with zipfile.ZipFile(archive) as zf:
    dataframe = pd.read_excel(io.BytesIO(zf.read("Final_Hydro_Completed.xlsx")), sheet_name="Sheet1")

  rows: list[dict[str, object]] = []
  rows_enriched = 0
  for _, row in dataframe.iterrows():
    capacity = clean_number(row.get("Capacity_mw"))
    lat = clean_number(row.get("Lat"))
    lng = clean_number(row.get("Lon"))
    if (
      capacity is None
      or capacity < HYDRO_MIN_CAPACITY_MW
      or not is_valid_china_coordinate(lat, lng)
    ):
      continue
    start_year = clean_number(row.get("Start_year"))
    name = clean_string(row.get("Name"), "China hydropower station")
    raw_id = clean_string(row.get("Feature ID"), name)
    extra = hydro_extra_from_row(
      river=row.get("River"),
      main_basin=row.get("Main_basin"),
      dam_height_m=row.get("Dam_height_m"),
      reservoir_area_km2=row.get("Res_area_km2"),
      reservoir_volume_mm3=row.get("Res_vol_Mm3"),
      head_m=row.get("Head_m"),
      annual_generation_mwh=row.get("Annual_Power_Generation_MWh"),
    )
    if extra:
      rows_enriched += 1
    rows.append(make_asset(
      prefix="hydro",
      raw_id=raw_id,
      name=name,
      technology="hydro",
      capacity_mw=capacity,
      status=map_hydro_status(clean_string(row.get("Status")), start_year),
      source="China Hydropower Station Dataset",
      lat=lat or 0,
      lng=lng or 0,
      source_id=raw_id,
      commissioning_year=start_year,
      extra=extra,
    ))

  return rows, SourceSummary(
    "China Hydropower Station Dataset",
    len(dataframe),
    len(rows),
    rows_enriched=rows_enriched,
    rows_rejected=len(dataframe) - len(rows),
    notes=("River, basin, dam, reservoir, head, and annual generation fields are preserved when available.",),
  )


def hydro_extra_from_row(
  *,
  river: object = "",
  main_basin: object = "",
  dam_name: object = "",
  reservoir_name: object = "",
  dam_height_m: object = None,
  reservoir_area_km2: object = None,
  reservoir_volume_mm3: object = None,
  reservoir_volume_km3: object = None,
  head_m: object = None,
  annual_generation_mwh: object = None,
) -> dict[str, object]:
  extra: dict[str, object] = {}
  for key, value in {
    "river": river,
    "mainBasin": main_basin,
    "damName": dam_name,
    "reservoirName": reservoir_name,
  }.items():
    text = clean_string(value)
    if text:
      extra[key] = text

  for key, value in {
    "damHeightM": dam_height_m,
    "reservoirAreaKm2": reservoir_area_km2,
    "reservoirVolumeMm3": reservoir_volume_mm3,
    "reservoirVolumeKm3": reservoir_volume_km3,
    "headM": head_m,
    "annualGenerationMwh": annual_generation_mwh,
  }.items():
    number = clean_number(value)
    if number is not None and number >= 0:
      extra[key] = number
  return extra


def coordinate_key(lat: object, lng: object, precision: int = 2) -> tuple[float, float] | None:
  lat_number = clean_number(lat)
  lng_number = clean_number(lng)
  if not is_valid_china_coordinate(lat_number, lng_number):
    return None
  return (round(float(lat_number), precision), round(float(lng_number), precision))


def read_glohydrores_assets(
  existing_hydro_assets: list[dict[str, object]],
) -> tuple[list[dict[str, object]], SourceSummary]:
  archive = DATA_DIR / "14526360.zip"
  if not archive.exists():
    return [], SourceSummary(
      "GloHydroRes v1",
      0,
      0,
      notes=("Archive 14526360.zip is not present; no GloHydroRes enrichment was applied.",),
    )

  with zipfile.ZipFile(archive) as zf:
    dataframe = pd.read_csv(io.BytesIO(zf.read("GloHydroRes_vs1.csv")))

  china_rows = dataframe[dataframe["country"].astype(str).str.lower() == "china"]
  existing_by_name = {
    hydro_name_key(str(asset["name"])): asset
    for asset in existing_hydro_assets
    if hydro_name_key(str(asset["name"]))
  }
  existing_by_coord = {
    coordinate_key(asset.get("lat"), asset.get("lng")): asset
    for asset in existing_hydro_assets
    if coordinate_key(asset.get("lat"), asset.get("lng")) is not None
  }
  new_assets: list[dict[str, object]] = []
  rows_enriched = 0
  rows_valid = 0

  for _, row in china_rows.iterrows():
    capacity = clean_number(row.get("capacity_mw"))
    lat = clean_number(row.get("plant_lat"))
    lng = clean_number(row.get("plant_lon"))
    if (
      capacity is None
      or capacity < HYDRO_MIN_CAPACITY_MW
      or not is_valid_china_coordinate(lat, lng)
    ):
      continue

    rows_valid += 1
    name = clean_string(row.get("name"), "China hydropower station")
    name_key = hydro_name_key(name)
    coord_key = coordinate_key(lat, lng)
    matched_asset = existing_by_name.get(name_key) or existing_by_coord.get(coord_key)
    extra = hydro_extra_from_row(
      river=row.get("river"),
      dam_name=row.get("dam_name"),
      reservoir_name=row.get("res_name"),
      dam_height_m=row.get("dam_height_m"),
      reservoir_area_km2=row.get("res_area_km2"),
      reservoir_volume_km3=row.get("res_vol_km3"),
      head_m=row.get("head_m"),
    )

    if matched_asset is not None:
      changed = False
      for key, value in extra.items():
        if key not in matched_asset:
          matched_asset[key] = value
          changed = True
      if "sourceId" in matched_asset:
        matched_asset["sourceId"] = f"{matched_asset['sourceId']}|{clean_string(row.get('ID'))}"
      else:
        matched_asset["sourceId"] = clean_string(row.get("ID"))
      if changed:
        rows_enriched += 1
      continue

    raw_id = clean_string(row.get("ID"), name)
    new_assets.append(make_asset(
      prefix="glohydrores",
      raw_id=raw_id,
      name=name,
      technology="hydro",
      capacity_mw=capacity,
      status=map_hydro_status("", clean_number(row.get("year"))),
      source="GloHydroRes v1",
      lat=lat or 0,
      lng=lng or 0,
      source_id=raw_id,
      commissioning_year=row.get("year"),
      extra=extra,
    ))

  return new_assets, SourceSummary(
    "GloHydroRes v1",
    len(china_rows),
    len(new_assets),
    rows_enriched=rows_enriched,
    rows_rejected=len(china_rows) - rows_valid,
    notes=("Rows matching China Hydropower Station Dataset are used for enrichment; only unmatched valid >=100 MW rows become new assets.",),
  )


def read_dbf_records_from_zip(zip_name: str, member_filter: Callable[[str], bool]) -> Iterable[tuple[str, dict[str, str]]]:
  with zipfile.ZipFile(DATA_DIR / zip_name) as zf:
    for entry in zf.infolist():
      if not entry.filename.lower().endswith(".dbf") or not member_filter(entry.filename):
        continue
      raw = zf.read(entry.filename)
      header_length = struct.unpack("<H", raw[8:10])[0]
      record_length = struct.unpack("<H", raw[10:12])[0]
      record_count = struct.unpack("<I", raw[4:8])[0]
      fields: list[tuple[str, int, int]] = []
      position = 32
      offset = 1
      while position + 32 <= header_length and raw[position] != 0x0D:
        name = raw[position:position + 11].split(b"\x00", 1)[0].decode("ascii", errors="ignore")
        length = raw[position + 16]
        fields.append((name, length, offset))
        offset += length
        position += 32

      for index in range(record_count):
        start = header_length + index * record_length
        record = raw[start:start + record_length]
        values = {
          name: record[field_offset:field_offset + length].strip().decode("gbk", errors="ignore")
          for name, length, field_offset in fields
        }
        yield entry.filename, values


def source_summary_from_footprints(summary: dict[str, object]) -> SourceSummary:
  rows_read = int(summary.get("rowsRead", 0))
  rows_used = int(summary.get("rowsUsed", 0))
  return SourceSummary(
    str(summary.get("name", "Photovoltaic footprints")),
    rows_read,
    rows_used,
    rows_rejected=max(0, rows_read - rows_used),
    notes=(
      "Footprints are summarized for spatial coverage only.",
      "No installed capacity is inferred from footprint area.",
    ),
  )


def read_cpvpd_summary() -> tuple[dict[str, object], SourceSummary]:
  rows_read = 0
  rows_used = 0
  total_area_sq_m = 0.0
  used_area_sq_m = 0.0
  by_province: Counter[str] = Counter()
  for _, row in read_dbf_records_from_zip("CPVPD-2024.zip", lambda member: True):
    rows_read += 1
    area = clean_number(row.get("Area"))
    lat = clean_number(row.get("latitude"))
    lng = clean_number(row.get("longitude"))
    if area is not None and area > 0:
      total_area_sq_m += area
    if area is not None and area >= 1_000_000 and is_valid_china_coordinate(lat, lng):
      rows_used += 1
      used_area_sq_m += area
      by_province[_.split("/")[-1].removesuffix(".dbf")] += 1

  summary = {
    "name": "CPVPD-2024 photovoltaic footprints",
    "archive": "CPVPD-2024.zip",
    "year": 2024,
    "areaUnit": "square_meters",
    "rowsRead": rows_read,
    "rowsUsed": rows_used,
    "minRenderedAreaSqM": 1_000_000,
    "totalAreaSqM": round(total_area_sq_m, 3),
    "usedAreaSqM": round(used_area_sq_m, 3),
    "provinceCounts": dict(sorted(by_province.items())),
    "capacityPolicy": "Do not infer installed MW from footprint area; use GEM/WRI/official totals for capacity.",
  }
  return summary, source_summary_from_footprints(summary)


def read_chinapv_summary() -> tuple[list[dict[str, object]], SourceSummary]:
  archive = DATA_DIR / "14292571.zip"
  if not archive.exists():
    summary = {
      "name": "ChinaPV photovoltaic footprints",
      "archive": "14292571.zip",
      "rowsRead": 0,
      "rowsUsed": 0,
      "capacityPolicy": "Archive is missing; no ChinaPV history summary was generated.",
    }
    return [summary], source_summary_from_footprints(summary)

  summaries: list[dict[str, object]] = []
  total_rows_read = 0
  total_rows_used = 0
  for member_name, year in [
    ("ChinaPV_2015_v1.1.dbf", 2015),
    ("ChinaPV_2020_v1.1.dbf", 2020),
  ]:
    rows_read = 0
    rows_used = 0
    total_area = 0.0
    by_province: Counter[str] = Counter()
    for _, row in read_dbf_records_from_zip("14292571.zip", lambda member, needle=member_name: member.endswith(needle)):
      rows_read += 1
      area = clean_number(row.get("Area"))
      lat = clean_number(row.get("Lat"))
      lng = clean_number(row.get("Lon"))
      province = clean_string(row.get("Province"), "unknown")
      if area is not None and area > 0:
        total_area += area
      if is_valid_china_coordinate(lat, lng):
        rows_used += 1
        by_province[province] += 1
    total_rows_read += rows_read
    total_rows_used += rows_used
    summaries.append({
      "name": f"ChinaPV {year} photovoltaic footprints",
      "archive": "14292571.zip",
      "member": member_name,
      "year": year,
      "areaUnit": "source_area_units",
      "rowsRead": rows_read,
      "rowsUsed": rows_used,
      "totalAreaSourceUnits": round(total_area, 6),
      "provinceCounts": dict(sorted(by_province.items())),
      "capacityPolicy": "Do not infer installed MW from footprint area; use GEM/WRI/official totals for capacity.",
    })

  return summaries, SourceSummary(
    "ChinaPV photovoltaic footprints",
    total_rows_read,
    total_rows_used,
    rows_rejected=max(0, total_rows_read - total_rows_used),
    notes=("2015 and 2020 footprint layers are summarized as historical spatial coverage only.",),
  )


def write_pv_summary(cpvpd_summary: dict[str, object], chinapv_summaries: list[dict[str, object]]) -> None:
  payload = {
    "generatedBy": "scripts/build-china-map-data.py",
    "notes": [
      "CPVPD-2024 is treated as the current photovoltaic footprint layer.",
      "ChinaPV 2015/2020 is treated as historical footprint context.",
      "Footprint area is never converted into installed capacity in this pipeline.",
    ],
    "sources": [cpvpd_summary, *chinapv_summaries],
  }
  CHINA_PV_SUMMARY_FILE.parent.mkdir(parents=True, exist_ok=True)
  CHINA_PV_SUMMARY_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_peeringdb_facilities() -> list[dict[str, object]]:
  query = urllib.parse.urlencode({
    "country": "CN",
    "limit": "250",
    "fields": ",".join(PEERINGDB_FIELDS),
  })
  request = urllib.request.Request(
    f"{PEERINGDB_FACILITY_URL}?{query}",
    headers={
      "Accept": "application/json",
      "User-Agent": "OpenGridWorks China data builder",
    },
  )
  with urllib.request.urlopen(request, timeout=30) as response:
    payload = json.loads(response.read().decode("utf-8"))
  data = payload.get("data")
  if not isinstance(data, list):
    raise ValueError("PeeringDB facility API returned no data array")
  return [row for row in data if isinstance(row, dict)]


def read_peeringdb_data_centers() -> tuple[list[dict[str, object]], SourceSummary]:
  facilities = fetch_peeringdb_facilities()
  assets: list[dict[str, object]] = []
  manual_review_rows: list[dict[str, object]] = []

  for row in facilities:
    if clean_string(row.get("status")) != "ok":
      continue

    facility_id = clean_string(row.get("id"))
    name = clean_string(row.get("name"), "PeeringDB facility")
    operator = clean_string(row.get("org_name"), "Unknown operator")
    raw_city = clean_string(row.get("city"))
    city = normalize_city(raw_city)
    state = clean_string(row.get("state"))
    lat = clean_number(row.get("latitude"))
    lng = clean_number(row.get("longitude"))
    website = clean_string(row.get("website"))
    updated = clean_string(row.get("updated"))

    if not is_valid_china_coordinate(lat, lng):
      manual_review_rows.append({
        "peeringdb_id": facility_id,
        "name": name,
        "operator": operator,
        "raw_city": raw_city,
        "normalized_city": city,
        "state": state,
        "website": website,
        "updated": updated,
        "review_source": "",
        "reviewed_at": "",
        "coordinate_confidence": "",
        "review_action": "Find precise facility coordinates using Data Center Map, operator website, or manual research.",
      })
      continue

    assets.append({
      "id": f"cn-peeringdb-fac-{facility_id}",
      "name": name,
      "kind": "data-center",
      "operator": operator,
      "countryCode": "CN",
      "regionId": "china",
      "source": "PeeringDB facility API",
      "city": city,
      "state": state,
      "status": clean_string(row.get("status")),
      "updated": updated,
      "website": website,
      "review_source": "PeeringDB facility API",
      "reviewed_at": updated,
      "coordinate_confidence": "api-provided",
      "lat": round(lat or 0, 6),
      "lng": round(lng or 0, 6),
    })

  PEERINGDB_MANUAL_REVIEW_FILE.parent.mkdir(parents=True, exist_ok=True)
  with PEERINGDB_MANUAL_REVIEW_FILE.open("w", encoding="utf-8", newline="") as csv_file:
    fieldnames = [
      "peeringdb_id",
      "name",
      "operator",
      "raw_city",
      "normalized_city",
      "state",
      "website",
      "updated",
      "review_source",
      "reviewed_at",
      "coordinate_confidence",
      "review_action",
    ]
    writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(manual_review_rows)

  return assets, SourceSummary(
    "PeeringDB facility API (China)",
    len(facilities),
    len(assets),
    rows_rejected=len(facilities) - len(assets),
    notes=("Rows without usable coordinates are preserved for Data Center Map or operator-site manual review.",),
  )


def hydro_name_key(name: str) -> str:
  normalized = re.sub(r"[^a-z0-9]+", "", name.lower())
  for suffix in [
    "hydroelectricplant",
    "hydropowerstation",
    "hydropowerplant",
    "powerstation",
    "station",
    "plant",
    "dam",
  ]:
    normalized = normalized.replace(suffix, "")
  return normalized


def dedupe_assets(assets: Iterable[dict[str, object]]) -> list[dict[str, object]]:
  by_id: dict[str, dict[str, object]] = {}
  geo_seen: dict[tuple[str, float, float], dict[str, object]] = {}
  hydro_names_seen: set[str] = set()

  for asset in sorted(assets, key=lambda row: float(row["capacityMw"]), reverse=True):
    key = str(asset["id"])
    technology = str(asset["technology"])
    lat_key = round(float(asset["lat"]), 2)
    lng_key = round(float(asset["lng"]), 2)
    geo_key = (technology, lat_key, lng_key)

    if key in by_id:
      continue
    if technology == "hydro":
      name_key = hydro_name_key(str(asset["name"]))
      if name_key and name_key in hydro_names_seen:
        continue
      hydro_names_seen.add(name_key)
    if technology in {"hydro", "solar", "wind", "offshore"} and geo_key in geo_seen:
      continue
    by_id[key] = asset
    geo_seen[geo_key] = asset

  return sorted(by_id.values(), key=lambda row: (str(row["technology"]), str(row["name"])))


def source_summary_payload(summary: SourceSummary) -> dict[str, object]:
  return {
    "name": summary.name,
    "rows_read": summary.rows_read,
    "rows_used": summary.rows_used,
    "rows_enriched": summary.rows_enriched,
    "rows_rejected": summary.rows_rejected,
    "notes": list(summary.notes),
  }


def technology_capacity(assets: Iterable[dict[str, object]]) -> dict[str, dict[str, float | int]]:
  totals: dict[str, dict[str, float | int]] = {}
  for asset in assets:
    technology = str(asset.get("technology", "other"))
    totals.setdefault(technology, {"count": 0, "capacityMw": 0.0})
    totals[technology]["count"] = int(totals[technology]["count"]) + 1
    totals[technology]["capacityMw"] = round(float(totals[technology]["capacityMw"]) + float(asset.get("capacityMw", 0)), 3)
  return dict(sorted(totals.items()))


def official_totals_payload() -> dict[str, object]:
  return {
    "generatedBy": "scripts/build-china-map-data.py",
    "policy": "Official NEA/NBS totals validate aggregate coverage only. They are not GIS sources and intentionally contain no coordinates.",
    "year": 2024,
    "installedCapacityMw": {
      "source": "National Energy Administration, 2024 national power industry statistics",
      "sourceUrl": "https://www.nea.gov.cn/20250121/097bfd7c1cd3498897639857d86d5dac/c.html",
      "sourceUnit": "10,000 kW",
      "convertedUnit": "MW",
      "total": 3_348_620,
      "hydro": 435_950,
      "thermal": 1_444_450,
      "nuclear": 60_830,
      "wind": 520_680,
      "solar": 886_660,
    },
    "generationGwh": {
      "source": "National Bureau of Statistics, 2024 Statistical Communique",
      "sourceUrl": "https://www.stats.gov.cn/sj/zxfb/202502/t20250228_1958817.html",
      "sourceUnit": "100 million kWh",
      "convertedUnit": "GWh",
      "total": 10_086_880,
      "thermal": 6_374_260,
      "hydro": 1_425_680,
      "nuclear": 450_850,
      "wind": 997_040,
      "solar": 839_040,
      "cleanEnergy": 3_712_600,
    },
    "investmentCnyBillion": {
      "source": "National Energy Administration, 2024 national power industry statistics",
      "sourceUrl": "https://www.nea.gov.cn/20250121/097bfd7c1cd3498897639857d86d5dac/c.html",
      "sourceUnit": "100 million CNY",
      "convertedUnit": "billion CNY",
      "powerSourceProjects": 1_168.7,
      "gridProjects": 608.3,
    },
    "reliabilityReport": {
      "source": "National Energy Administration and China Electricity Council, 2024 National Power Reliability Annual Report",
      "sourceFile": "supplement data/2024 National Power Reliability Annual Report.pdf",
      "published": "2025-03",
      "use": "Reliability and operating benchmark only; not a coordinate or asset source.",
    },
  }


def coverage_row(
  *,
  label: str,
  official_mw: float,
  mapped_mw: float,
  asset_technologies: list[str],
) -> dict[str, object]:
  return {
    "label": label,
    "officialInstalledCapacityMw": round(official_mw, 3),
    "mappedAssetCapacityMw": round(mapped_mw, 3),
    "coverageRatio": round(mapped_mw / official_mw, 4) if official_mw > 0 else None,
    "assetTechnologies": asset_technologies,
  }


def write_official_validation(energy_assets: list[dict[str, object]]) -> None:
  official = official_totals_payload()
  OFFICIAL_TOTALS_FILE.parent.mkdir(parents=True, exist_ok=True)
  OFFICIAL_TOTALS_FILE.write_text(json.dumps(official, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

  by_technology = technology_capacity(energy_assets)

  def mapped_capacity(keys: list[str]) -> float:
    return sum(float(by_technology.get(key, {}).get("capacityMw", 0)) for key in keys)

  installed = official["installedCapacityMw"]
  coverage = {
    "generatedBy": "scripts/build-china-map-data.py",
    "policy": "Coverage compares mapped asset capacity to official aggregate totals. Differences are QA signals, not coordinate corrections.",
    "assetCapacityByTechnology": by_technology,
    "installedCapacityCoverage": [
      coverage_row(label="hydro", official_mw=float(installed["hydro"]), mapped_mw=mapped_capacity(["hydro"]), asset_technologies=["hydro"]),
      coverage_row(label="wind", official_mw=float(installed["wind"]), mapped_mw=mapped_capacity(["wind", "offshore"]), asset_technologies=["wind", "offshore"]),
      coverage_row(label="solar", official_mw=float(installed["solar"]), mapped_mw=mapped_capacity(["solar"]), asset_technologies=["solar"]),
      coverage_row(label="nuclear", official_mw=float(installed["nuclear"]), mapped_mw=mapped_capacity(["nuclear"]), asset_technologies=["nuclear"]),
      coverage_row(label="thermal", official_mw=float(installed["thermal"]), mapped_mw=mapped_capacity(["coal", "gas", "oil", "biomass", "other"]), asset_technologies=["coal", "gas", "oil", "biomass", "other"]),
      coverage_row(label="total", official_mw=float(installed["total"]), mapped_mw=sum(float(row["capacityMw"]) for row in by_technology.values()), asset_technologies=sorted(by_technology.keys())),
    ],
    "officialGenerationGwh": official["generationGwh"],
    "officialInvestmentCnyBillion": official["investmentCnyBillion"],
    "nonGisAssertion": {
      "officialTotalsContainCoordinates": False,
      "officialTotalsUsedAsGisSource": False,
    },
  }
  COVERAGE_SUMMARY_FILE.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sample_coastal_risk_with_rasterio(
  tif_path: Path,
  assets: list[dict[str, object]],
) -> dict[str, object]:
  try:
    import rasterio  # type: ignore[import-not-found]
  except ImportError:
    return {
      "samplingStatus": "skipped",
      "reason": "rasterio is not installed in the current Python environment.",
      "assetExposureRows": 0,
    }

  sampled = 0
  valid = 0
  outside = 0
  positive = 0
  max_value = None
  with rasterio.open(tif_path) as dataset:
    nodata = dataset.nodata
    for asset in assets:
      lat = clean_number(asset.get("lat"))
      lng = clean_number(asset.get("lng"))
      if lat is None or lng is None:
        outside += 1
        continue
      if not (dataset.bounds.left <= lng <= dataset.bounds.right and dataset.bounds.bottom <= lat <= dataset.bounds.top):
        outside += 1
        continue
      sampled += 1
      value = next(dataset.sample([(lng, lat)]))[0]
      if nodata is not None and value == nodata:
        continue
      if not math.isfinite(float(value)):
        continue
      valid += 1
      if float(value) > 0:
        positive += 1
      max_value = float(value) if max_value is None else max(max_value, float(value))

  return {
    "samplingStatus": "sampled",
    "assetExposureRows": sampled,
    "validExposureRows": valid,
    "outsideRasterRows": outside,
    "positiveExposureRows": positive,
    "maxExposureValue": max_value,
  }


def write_risk_candidate(energy_assets: list[dict[str, object]], data_center_assets: list[dict[str, object]]) -> None:
  tif_path = SUPPLEMENT_DATA_DIR / "inuncoast_historical_nosub_hist_rp0005_0.tif"
  payload: dict[str, object] = {
    "generatedBy": "scripts/build-china-map-data.py",
    "sourceFile": "supplement data/inuncoast_historical_nosub_hist_rp0005_0.tif",
    "renderByDefault": False,
    "use": "Candidate coastal flood exposure overlay for later risk analysis; not part of the base map.",
  }
  if not tif_path.exists():
    payload["samplingStatus"] = "skipped"
    payload["reason"] = "Supplemental GeoTIFF is not present."
  else:
    payload["rasterMetadata"] = {
      "crs": "EPSG:4326",
      "bounds": [-180, -90, 180, 90],
      "pixelSizeDegrees": [0.008333333333333333, 0.008333333333333333],
      "nodata": -9999,
    }
    assets_for_sampling = [
      {"kind": "energy", **asset}
      for asset in energy_assets
    ] + [
      {"kind": "data-center", **asset}
      for asset in data_center_assets
    ]
    payload.update(sample_coastal_risk_with_rasterio(tif_path, assets_for_sampling))
  RISK_CANDIDATE_FILE.parent.mkdir(parents=True, exist_ok=True)
  RISK_CANDIDATE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
  missing = [
    path.name
    for path in [
      DATA_DIR / "globalpowerplantdatabasev130.zip",
      DATA_DIR / "gem-data.zip",
      DATA_DIR / "China Hydropower Station Dataset.zip",
      DATA_DIR / "CPVPD-2024.zip",
      DATA_DIR / "14292571.zip",
      DATA_DIR / "14526360.zip",
    ]
    if not path.exists()
  ]
  if missing:
    raise FileNotFoundError(f"Missing downloaded data archive(s): {', '.join(missing)}")

  wri_assets, wri_summary = read_wri_non_variable_renewables()
  gem_assets, gem_summaries = read_gem_assets()
  hydro_assets, hydro_summary = read_china_hydro_assets()
  glohydrores_assets, glohydrores_summary = read_glohydrores_assets(hydro_assets)
  cpvpd_footprints, cpvpd_summary = read_cpvpd_summary()
  chinapv_footprints, chinapv_summary = read_chinapv_summary()
  write_pv_summary(cpvpd_footprints, chinapv_footprints)
  data_center_assets, peeringdb_summary = read_peeringdb_data_centers()

  energy_assets = dedupe_assets([*wri_assets, *gem_assets, *hydro_assets, *glohydrores_assets])
  source_summaries = [
    wri_summary,
    *gem_summaries,
    hydro_summary,
    glohydrores_summary,
    cpvpd_summary,
    chinapv_summary,
    peeringdb_summary,
  ]
  write_official_validation(energy_assets)
  write_risk_candidate(energy_assets, data_center_assets)

  payload = {
    "meta": {
      "generatedBy": "scripts/build-china-map-data.py",
      "notes": [
        f"GEM solar/wind rows are filtered to projects >= {GEM_MIN_CAPACITY_MW} MW and non-cancelled statuses.",
        f"Hydropower rows are filtered to stations >= {HYDRO_MIN_CAPACITY_MW} MW.",
        f"PV footprint summaries are written to {CHINA_PV_SUMMARY_FILE.relative_to(REPO_ROOT)} and are never converted to installed MW.",
        "Downloaded OSM PBF is processed by scripts/build-china-osm-power-data.py into local GeoJSON and vector tiles for OSM power infrastructure.",
        f"PeeringDB facilities with coordinates are rendered without inferred MW load; missing-coordinate facilities are written to {PEERINGDB_MANUAL_REVIEW_FILE.relative_to(REPO_ROOT)}.",
        f"Official NEA/NBS validation outputs are written to {VALIDATION_DIR.relative_to(REPO_ROOT)} and are not GIS sources.",
        f"Supplemental coastal risk metadata is written to {RISK_CANDIDATE_FILE.relative_to(REPO_ROOT)} and is not rendered by default.",
      ],
      "sources": [
        source_summary_payload(summary)
        for summary in source_summaries
      ],
    },
    "energyAssets": energy_assets,
    "dataCenters": data_center_assets,
    "gridLines": [],
    "substations": [],
  }

  OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  print(f"Wrote {OUTPUT_FILE}")
  print(f"Wrote {CHINA_PV_SUMMARY_FILE}")
  print(f"Wrote {OFFICIAL_TOTALS_FILE}")
  print(f"Wrote {COVERAGE_SUMMARY_FILE}")
  print(f"Wrote {RISK_CANDIDATE_FILE}")
  print(f"Energy assets: {len(energy_assets)}")
  print(f"Data centers: {len(data_center_assets)}")
  print(f"Manual review: {PEERINGDB_MANUAL_REVIEW_FILE}")
  for source in payload["meta"]["sources"]:
    print(
      f"- {source['name']}: used {source['rows_used']} / "
      f"read {source['rows_read']} / enriched {source['rows_enriched']} / "
      f"rejected {source['rows_rejected']}"
    )


if __name__ == "__main__":
  main()
