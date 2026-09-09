#!/usr/bin/env python3
"""Stream GISPO renewable-resource CSVs into PostgreSQL at project resolution.

The upstream files use a 0.25-degree global grid. This importer does not keep
local copies: it streams every CSV over HTTPS, aggregates it to the project's
0.5-degree convention, and writes the derived records to PostgreSQL. Original
resolution, source year, units, and aggregation assumptions remain explicit.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import psycopg2
import requests
from dotenv import dotenv_values
from psycopg2.extras import Json, execute_values


SOURCE_KEY = "gispo-global-renewable-resource-era5-2019"
BASE_URL = (
    "https://raw.githubusercontent.com/mrziheng/"
    "GlobalRenewableEnergyResource/main/VREPotential"
)
FILES = {
    "distributed-solar-pv": "dpv_attr_era5_cell_2019.csv",
    "utility-solar-pv": "upv_attr_era5_cell_2019.csv",
    "onshore-wind": "onshore_attr_era5_cell_2019.csv",
    "offshore-wind": "offshore_attr_era5_cell_2019.csv",
}
SOURCE_RESOLUTION = 0.25
PROJECT_RESOLUTION = 0.5
SOURCE_YEAR = 2019
USER_AGENT = "OpenGridWorks-GISPO-Importer/1.0"


def database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    ssl_enabled = str(values.get("DATABASE_SSL", "")).lower() == "true"
    return str(connection_string), ssl_enabled


def apply_schema(connection: Any, schema_path: Path) -> None:
    sql = schema_path.read_text(encoding="utf-8")
    catalog_start = sql.index("CREATE TABLE IF NOT EXISTS website_data.dataset_catalog")
    projection_start = sql.index(
        "CREATE TABLE IF NOT EXISTS website_data.climate_projection_sources",
    )
    with connection.cursor() as cursor:
        cursor.execute("CREATE SCHEMA IF NOT EXISTS website_data AUTHORIZATION CURRENT_USER")
        cursor.execute(sql[catalog_start:projection_start])
    connection.commit()


def top_left_05(longitude: float, latitude: float) -> tuple[float, float]:
    longitude_05 = math.floor((longitude + 1e-9) * 2.0) / 2.0
    latitude_05 = math.ceil((latitude - 1e-9) * 2.0) / 2.0
    return longitude_05, latitude_05


def stream_rows(url: str):
    local_root = os.environ.get("GISPO_SOURCE_DIR")
    if local_root:
        local_file = Path(local_root) / url.rsplit("/", 1)[-1]
        with local_file.open(encoding="utf-8-sig", newline="") as source:
            yield from csv.DictReader(source)
        return
    with requests.get(
        url,
        stream=True,
        timeout=(30, 180),
        headers={"User-Agent": USER_AGENT},
    ) as response:
        response.raise_for_status()
        lines = (line.decode("utf-8-sig") for line in response.iter_lines() if line)
        yield from csv.DictReader(lines)


def aggregate_file(technology: str, file_name: str) -> tuple[list[tuple[Any, ...]], int]:
    url = f"{BASE_URL}/{file_name}"
    groups: dict[tuple[float, float, str, str], dict[str, float]] = defaultdict(
        lambda: {
            "capacity": 0.0,
            "weighted_cf": 0.0,
            "cf_sum": 0.0,
            "max_cf": float("-inf"),
            "count": 0.0,
        },
    )
    source_count = 0
    for row in stream_rows(url):
        longitude = float(row["lon"])
        latitude = float(row["lat"])
        longitude_05, latitude_05 = top_left_05(longitude, latitude)
        region = row["region"].strip() or "unknown"
        grid = row["grid"].strip() or "unknown"
        annual_cf = float(row["annual_cf"])
        capacity = float(row["cap_poten"])
        max_cf = float(row["max_cf"])
        group = groups[(longitude_05, latitude_05, region, grid)]
        group["capacity"] += capacity
        group["weighted_cf"] += annual_cf * max(capacity, 0.0)
        group["cf_sum"] += annual_cf
        group["max_cf"] = max(group["max_cf"], max_cf)
        group["count"] += 1.0
        source_count += 1

    result: list[tuple[Any, ...]] = []
    assumptions = Json(
        {
            "coordinateMeaning": "top-left corner of 0.5-degree cell",
            "sourceCoordinateMeaning": "top-left corner of 0.25-degree cell",
            "capacityPotentialUnit": "GW",
            "capacityAggregation": "sum",
            "annualCapacityFactorAggregation": (
                "capacity-potential-weighted mean; arithmetic mean when total potential is zero"
            ),
            "maxCapacityFactorAggregation": "maximum",
            "climateBasis": "ERA5 2019",
            "usage": "scenario reference; do not mix directly with 2021-2060 GFDL-ESM4 SSP126",
        },
    )
    for (longitude, latitude, region, grid), values in groups.items():
        count = int(values["count"])
        if values["capacity"] > 0:
            annual_cf = values["weighted_cf"] / values["capacity"]
        else:
            annual_cf = values["cf_sum"] / count
        result.append(
            (
                SOURCE_KEY,
                technology,
                longitude,
                latitude,
                region,
                grid,
                SOURCE_YEAR,
                SOURCE_RESOLUTION,
                PROJECT_RESOLUTION,
                annual_cf,
                values["capacity"],
                values["max_cf"],
                count,
                assumptions,
            ),
        )
    return result, source_count


def replace_technology(connection: Any, technology: str, rows: list[tuple[Any, ...]]) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM website_data.renewable_resource_potential
            WHERE source_key=%s AND technology=%s
            """,
            (SOURCE_KEY, technology),
        )
        execute_values(
            cursor,
            """
            INSERT INTO website_data.renewable_resource_potential (
              source_key, technology, longitude, latitude, region, grid,
              source_year, source_resolution_deg, project_resolution_deg,
              annual_capacity_factor, capacity_potential_gw, max_capacity_factor,
              source_cell_count, assumptions
            ) VALUES %s
            """,
            rows,
            page_size=5000,
        )
    connection.commit()


def upsert_catalog(connection: Any, source_rows: int, project_rows: int) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO website_data.dataset_catalog (
              dataset_key, earth_layer, name, provider, source_url, data_type,
              spatial_scope, source_resolution_deg, project_resolution_deg,
              temporal_resolution, coverage_start, coverage_end, access_method,
              auth_required, license, acquisition_status, database_status,
              database_relation, priority, notes, metadata
            ) VALUES (
              %s,'电力地球',
              'GISPO global renewable resource and installable-capacity potential',
              'Ziheng Zhu et al.',
              'https://github.com/mrziheng/GlobalRenewableEnergyResource',
              'CSV grid-cell attributes','global',0.25,0.5,'annual',
              '2019-01-01','2019-12-31','public HTTPS',false,'CC-BY-4.0',
              'downloaded','imported',
              'website_data.renewable_resource_potential','high',
              '四类技术已按项目0.5°口径聚合；原始0.25°和ERA5 2019假设保留用于审计。',
              %s
            )
            ON CONFLICT (dataset_key) DO UPDATE SET
              earth_layer=EXCLUDED.earth_layer,
              acquisition_status=EXCLUDED.acquisition_status,
              database_status=EXCLUDED.database_status,
              database_relation=EXCLUDED.database_relation,
              notes=EXCLUDED.notes,
              metadata=EXCLUDED.metadata,
              updated_at=now()
            """,
            (
                SOURCE_KEY,
                Json(
                    {
                        "technologies": list(FILES),
                        "sourceRows": source_rows,
                        "projectRows": project_rows,
                        "capacityPotentialUnit": "GW",
                        "sourceYear": SOURCE_YEAR,
                    },
                ),
            ),
        )
    connection.commit()


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    connection_string, ssl_enabled = database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
    )
    source_total = 0
    project_total = 0
    summary: dict[str, Any] = {}
    try:
        apply_schema(connection, script_dir / "database-schema.sql")
        for technology, file_name in FILES.items():
            print(f"Streaming and aggregating {technology}: {file_name}", flush=True)
            rows, source_count = aggregate_file(technology, file_name)
            replace_technology(connection, technology, rows)
            source_total += source_count
            project_total += len(rows)
            summary[technology] = {
                "sourceRows": source_count,
                "projectRows": len(rows),
            }
            print(
                f"Imported {technology}: {source_count} source cells -> "
                f"{len(rows)} project records",
                flush=True,
            )
        upsert_catalog(connection, source_total, project_total)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    print(
        json.dumps(
            {
                "ok": True,
                "source": SOURCE_KEY,
                "sourceResolutionDeg": SOURCE_RESOLUTION,
                "projectResolutionDeg": PROJECT_RESOLUTION,
                "sourceRows": source_total,
                "projectRows": project_total,
                "technologies": summary,
                "localFilesCreated": False,
            },
            ensure_ascii=False,
            indent=2,
        ),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
