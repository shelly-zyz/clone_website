#!/usr/bin/env python3
"""Register selected paper climate scenarios and write a verified download manifest.

The DOI links in the paper can resolve to newer Zenodo record versions.  This
script always uses the record returned by the supplied current record id, keeps
the canonical DOI and file checksums, and is safe to run repeatedly.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import requests
from dotenv import dotenv_values
from psycopg2.extras import Json


DEFAULT_RECORDS = (17448039, 17461234, 17470247)
FILE_PATTERN = re.compile(
    r"^(?P<gcm>.+)_(?P<scenario>ssp\d+)_(?P<variable>[a-z0-9]+)_"
    r"(?P<start>\d{4})_(?P<end>\d{4})\.nc$",
    re.IGNORECASE,
)
VRE_PATTERN = re.compile(
    r"^VRE_(?P<gcm>.+)_(?P<scenario>ssp\d+)_2021_2060\.mat$",
    re.IGNORECASE,
)
ALLOWED_VARIABLES = {"huss", "rsds", "tas", "sfcwind", "ps"}


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--record-id",
        type=int,
        action="append",
        dest="record_ids",
        help="Canonical Zenodo record id; repeat for multiple scenarios.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=repo_root.parent / "outputs" / "20260920-climate-scenarios" / "download-manifest.json",
    )
    return parser.parse_args()


def database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    ssl_enabled = str(values.get("DATABASE_SSL", "")).lower() == "true"
    return str(connection_string), ssl_enabled


def fetch_record(record_id: int) -> dict[str, Any]:
    response = requests.get(
        f"https://zenodo.org/api/records/{record_id}",
        timeout=180,
        headers={"User-Agent": "OpenGridWorks-Zenodo-Climate-Importer/1.0"},
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not payload.get("files"):
        raise RuntimeError(f"Zenodo record {record_id} did not contain files.")
    return payload


def record_manifest(record: dict[str, Any], requested_id: int) -> dict[str, Any]:
    metadata = record.get("metadata", {})
    canonical_id = int(record["id"])
    files: list[dict[str, Any]] = []
    for raw in record.get("files", []):
        key = str(raw.get("key", ""))
        if not key.endswith(".nc") and not key.endswith(".mat"):
            continue
        if key.endswith(".nc"):
            match = FILE_PATTERN.fullmatch(key)
            if not match or match.group("variable").lower() not in ALLOWED_VARIABLES:
                raise RuntimeError(f"Unexpected climate file in record {canonical_id}: {key}")
            kind = "climate_netcdf"
            gcm = match.group("gcm").lower()
            scenario = match.group("scenario").lower()
            period_start = f"{match.group('start')}-01-01"
            period_end = f"{match.group('end')}-12-31"
            variable = match.group("variable").lower()
        else:
            match = VRE_PATTERN.fullmatch(key)
            if not match:
                raise RuntimeError(f"Unexpected MAT file in record {canonical_id}: {key}")
            kind = "vre_mat"
            gcm = match.group("gcm").lower()
            scenario = match.group("scenario").lower()
            period_start = "2021-01-01"
            period_end = "2060-12-31"
            variable = None
        checksum = str(raw.get("checksum", ""))
        if not checksum.startswith("md5:") or len(checksum) != 36:
            raise RuntimeError(f"Missing official MD5 for {key}")
        files.append(
            {
                "filename": key,
                "kind": kind,
                "record_id": canonical_id,
                "requested_record_id": requested_id,
                "gcm": gcm,
                "scenario": scenario,
                "variable": variable,
                "period_start": period_start,
                "period_end": period_end,
                "bytes": int(raw["size"]),
                "checksum": checksum,
                "download_url": raw["links"]["self"],
            }
        )
    nc_files = [item for item in files if item["kind"] == "climate_netcdf"]
    mat_files = [item for item in files if item["kind"] == "vre_mat"]
    if len(nc_files) != 20 or len(mat_files) != 1:
        raise RuntimeError(
            f"Record {canonical_id} expected 20 NetCDF + 1 VRE MAT, "
            f"got {len(nc_files)} + {len(mat_files)}"
        )
    scenario = nc_files[0]["scenario"]
    gcm = nc_files[0]["gcm"]
    if any(item["scenario"] != scenario or item["gcm"] != gcm for item in files):
        raise RuntimeError(f"Record {canonical_id} mixes GCM/SSP values")
    return {
        "requested_record_id": requested_id,
        "record_id": canonical_id,
        "doi": metadata.get("doi") or record.get("doi"),
        "title": metadata.get("title"),
        "license": (metadata.get("license") or {}).get("id", "cc-by-4.0"),
        "record_url": f"https://zenodo.org/records/{canonical_id}",
        "gcm": gcm,
        "scenario": scenario,
        "files": files,
    }


def register_sources(connection: Any, records: list[dict[str, Any]]) -> dict[str, int]:
    registered = 0
    catalogs = 0
    with connection.cursor() as cursor:
        for record in records:
            gcm = record["gcm"]
            scenario = record["scenario"]
            dataset_key = f"zenodo-{gcm}-{scenario}-hourly-climate"
            nc_files = [file for file in record["files"] if file["kind"] == "climate_netcdf"]
            for item in nc_files:
                cursor.execute(
                    """
                    INSERT INTO website_data.climate_projection_sources (
                      zenodo_record_id, file_name, gcm, scenario, variable,
                      period_start, period_end, spatial_resolution_deg, source_url,
                      expected_size_bytes, md5, license, download_status,
                      import_status, source_attributes, updated_at
                    ) VALUES (
                      %s,%s,%s,%s,%s,%s,%s,0.5,%s,%s,%s,%s,
                      CASE WHEN EXISTS (
                        SELECT 1 FROM website_data.climate_projection_sources
                        WHERE file_name=%s AND download_status='verified'
                      ) THEN 'verified' ELSE 'pending' END,
                      CASE WHEN EXISTS (
                        SELECT 1 FROM website_data.climate_projection_sources
                        WHERE file_name=%s AND import_status='imported'
                      ) THEN 'imported' ELSE 'pending' END,
                      %s,now()
                    )
                    ON CONFLICT (file_name) DO UPDATE SET
                      zenodo_record_id=EXCLUDED.zenodo_record_id,
                      source_url=EXCLUDED.source_url,
                      expected_size_bytes=EXCLUDED.expected_size_bytes,
                      md5=EXCLUDED.md5,
                      license=EXCLUDED.license,
                      gcm=EXCLUDED.gcm,
                      scenario=EXCLUDED.scenario,
                      variable=EXCLUDED.variable,
                      period_start=EXCLUDED.period_start,
                      period_end=EXCLUDED.period_end,
                      download_status=CASE
                        WHEN website_data.climate_projection_sources.download_status='verified'
                        THEN 'verified' ELSE EXCLUDED.download_status END,
                      import_status=CASE
                        WHEN website_data.climate_projection_sources.import_status='imported'
                        THEN 'imported' ELSE EXCLUDED.import_status END,
                      source_attributes=website_data.climate_projection_sources.source_attributes
                        || EXCLUDED.source_attributes,
                      error=NULL,
                      updated_at=now()
                    """,
                    (
                        record["record_id"],
                        item["filename"],
                        item["gcm"],
                        item["scenario"],
                        item["variable"],
                        date.fromisoformat(item["period_start"]),
                        date.fromisoformat(item["period_end"]),
                        item["download_url"],
                        item["bytes"],
                        item["checksum"][4:],
                        record["license"],
                        item["filename"],
                        item["filename"],
                        Json(
                            {
                                "title": record["title"],
                                "publication_date": record.get("publication_date"),
                                "zenodo_record_url": record["record_url"],
                                "canonical_doi": record["doi"],
                                "requested_record_id": record["requested_record_id"],
                                "record_id": record["record_id"],
                                "truthStatus": "published-model-scenario-not-observation",
                            }
                        ),
                    ),
                )
                registered += 1

            cursor.execute(
                """
                INSERT INTO website_data.dataset_catalog (
                  dataset_key, earth_layer, name, provider, source_url, data_type,
                  spatial_scope, source_resolution_deg, project_resolution_deg,
                  temporal_resolution, coverage_start, coverage_end, access_method,
                  auth_required, license, acquisition_status, database_status,
                  database_relation, priority, notes, metadata
                ) VALUES (
                  %s,'气象地球',%s,'Chen et al. / Zenodo',%s,
                  'NetCDF: huss, ps, rsds, sfcwind, tas','mainland China',
                  0.5,0.5,'hourly','2021-01-01','2060-12-31',
                  'public Zenodo HTTPS',false,%s,'pending','pending',
                  'website_data.climate_projection_daily','high',%s,%s
                )
                ON CONFLICT (dataset_key) DO UPDATE SET
                  name=EXCLUDED.name, source_url=EXCLUDED.source_url,
                  acquisition_status=CASE
                    WHEN website_data.dataset_catalog.database_status='imported'
                    THEN website_data.dataset_catalog.acquisition_status
                    ELSE EXCLUDED.acquisition_status END,
                  database_status=CASE
                    WHEN website_data.dataset_catalog.database_status='imported'
                    THEN 'imported' ELSE EXCLUDED.database_status END,
                  notes=EXCLUDED.notes,
                  metadata=website_data.dataset_catalog.metadata || EXCLUDED.metadata,
                  updated_at=now()
                """,
                (
                    dataset_key,
                    f"{gcm.upper()} {scenario.upper()} hourly climate projections",
                    record["record_url"],
                    record["license"],
                    "逐文件保留官方 MD5；导入完成后按日帧终验；长期模型情景，不是观测或天气预报。",
                    Json(
                        {
                            "recordId": record["record_id"],
                            "requestedRecordId": record["requested_record_id"],
                            "doi": record["doi"],
                            "netcdfFiles": len(nc_files),
                            "vreMatFile": next(
                                item["filename"]
                                for item in record["files"]
                                if item["kind"] == "vre_mat"
                            ),
                            "truthStatus": "published-model-scenario-not-observation",
                        }
                    ),
                ),
            )
            catalogs += 1
    connection.commit()
    return {"registered_sources": registered, "catalog_rows": catalogs}


def main() -> int:
    args = parse_args()
    record_ids = tuple(args.record_ids or DEFAULT_RECORDS)
    if len(set(record_ids)) != len(record_ids):
        raise RuntimeError("Duplicate record ids were supplied.")
    records = [record_manifest(fetch_record(record_id), record_id) for record_id in record_ids]
    all_files = [item for record in records for item in record["files"]]
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "records": records,
        "files": all_files,
        "climate_netcdf_files": [item for item in all_files if item["kind"] == "climate_netcdf"],
        "vre_mat_files": [item for item in all_files if item["kind"] == "vre_mat"],
        "total_bytes": sum(int(item["bytes"]) for item in all_files),
        "netcdf_bytes": sum(int(item["bytes"]) for item in all_files if item["kind"] == "climate_netcdf"),
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    repo_root = Path(__file__).resolve().parent.parent
    connection_string, ssl_enabled = database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
        connect_timeout=20,
    )
    try:
        result = register_sources(connection, records)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    print(
        json.dumps(
            {
                "ok": True,
                "manifest": str(args.manifest),
                "records": [
                    {
                        "requested": record["requested_record_id"],
                        "canonical": record["record_id"],
                        "doi": record["doi"],
                        "gcm": record["gcm"],
                        "scenario": record["scenario"],
                        "files": len(record["files"]),
                    }
                    for record in records
                ],
                "netcdf_files": len(manifest["climate_netcdf_files"]),
                "vre_mat_files": len(manifest["vre_mat_files"]),
                "netcdf_bytes": manifest["netcdf_bytes"],
                "total_bytes": manifest["total_bytes"],
                **result,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
