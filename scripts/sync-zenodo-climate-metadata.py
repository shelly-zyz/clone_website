#!/usr/bin/env python3
"""Register every climate NetCDF in a Zenodo record before binary import."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

import psycopg2
import requests
from dotenv import dotenv_values
from psycopg2.extras import Json


RECORD_ID = 20501729
FILE_PATTERN = re.compile(
    r"^(?P<gcm>.+)_(?P<scenario>ssp\d+)_(?P<variable>[a-z0-9]+)_"
    r"(?P<start>\d{4})_(?P<end>\d{4})\.nc$",
    re.IGNORECASE,
)


def database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    ssl_enabled = str(values.get("DATABASE_SSL", "")).lower() == "true"
    return str(connection_string), ssl_enabled


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    record = requests.get(
        f"https://zenodo.org/api/records/{RECORD_ID}",
        timeout=90,
        headers={"User-Agent": "OpenGridWorks-Zenodo-Metadata/1.0"},
    )
    record.raise_for_status()
    payload: dict[str, Any] = record.json()
    metadata = payload["metadata"]

    connection_string, ssl_enabled = database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
    )
    registered = 0
    try:
        with connection.cursor() as cursor:
            for item in payload["files"]:
                parsed = FILE_PATTERN.match(item["key"])
                if not parsed:
                    continue
                cursor.execute(
                    """
                    INSERT INTO website_data.climate_projection_sources (
                      zenodo_record_id, file_name, gcm, scenario, variable,
                      period_start, period_end, spatial_resolution_deg, source_url,
                      expected_size_bytes, md5, license, download_status,
                      import_status, source_attributes, updated_at
                    ) VALUES (
                      %s,%s,%s,%s,%s,%s,%s,0.5,%s,%s,%s,%s,
                      'pending','pending',%s,now()
                    )
                    ON CONFLICT (file_name) DO UPDATE SET
                      source_url=EXCLUDED.source_url,
                      expected_size_bytes=EXCLUDED.expected_size_bytes,
                      md5=EXCLUDED.md5,
                      license=EXCLUDED.license,
                      source_attributes=website_data.climate_projection_sources.source_attributes
                        || EXCLUDED.source_attributes,
                      updated_at=now()
                    """,
                    (
                        RECORD_ID,
                        item["key"],
                        parsed.group("gcm").lower(),
                        parsed.group("scenario").lower(),
                        parsed.group("variable").lower(),
                        date(int(parsed.group("start")), 1, 1),
                        date(int(parsed.group("end")), 12, 31),
                        item["links"]["self"],
                        int(item["size"]),
                        str(item["checksum"]).removeprefix("md5:"),
                        metadata.get("license", {}).get("id", "cc-by-4.0"),
                        Json(
                            {
                                "title": metadata.get("title"),
                                "publicationDate": metadata.get("publication_date"),
                                "zenodoRecordUrl": (
                                    f"https://zenodo.org/records/{RECORD_ID}"
                                ),
                                "metadataRegistered": True,
                            },
                        ),
                    ),
                )
                registered += 1

            cursor.execute(
                """
                SELECT
                  count(*) FILTER (WHERE import_status='imported'),
                  count(*) FILTER (WHERE import_status='partial'),
                  count(*) FILTER (WHERE import_status IN ('pending','failed','importing')),
                  coalesce(sum(expected_size_bytes),0)
                FROM website_data.climate_projection_sources
                WHERE zenodo_record_id=%s
                """,
                (RECORD_ID,),
            )
            imported, partial, remaining, total_bytes = cursor.fetchone()
            cursor.execute(
                """
                INSERT INTO website_data.dataset_catalog (
                  dataset_key, earth_layer, name, provider, source_url, data_type,
                  spatial_scope, source_resolution_deg, project_resolution_deg,
                  temporal_resolution, coverage_start, coverage_end, access_method,
                  auth_required, license, acquisition_status, database_status,
                  database_relation, priority, notes, metadata
                ) VALUES (
                  'zenodo-gfdl-esm4-ssp126-hourly-climate','气象地球',
                  'GFDL-ESM4 SSP1-2.6 hourly climate projections',
                  'Chen et al. / Zenodo',
                  'https://zenodo.org/records/20501729',
                  'NetCDF: huss, ps, rsds, sfcwind, tas','mainland China',
                  0.5,0.5,'hourly','2021-01-01','2060-12-31',
                  'public Zenodo HTTPS',false,'CC-BY-4.0',
                  %s,%s,'website_data.climate_projection_daily','high',
                  '逐文件校验MD5并按日分块保存；不是精确天气预报，而是气候情景投影。',
                  %s
                )
                ON CONFLICT (dataset_key) DO UPDATE SET
                  acquisition_status=EXCLUDED.acquisition_status,
                  database_status=EXCLUDED.database_status,
                  notes=EXCLUDED.notes,
                  metadata=EXCLUDED.metadata,
                  updated_at=now()
                """,
                (
                    "downloaded" if remaining == 0 else "partial",
                    "imported" if remaining == 0 else "partial",
                    Json(
                        {
                            "recordId": RECORD_ID,
                            "registeredNetcdfFiles": registered,
                            "importedFiles": int(imported),
                            "partialFiles": int(partial),
                            "remainingFiles": int(remaining),
                            "expectedBytes": int(total_bytes),
                            "variables": ["huss", "ps", "rsds", "sfcwind", "tas"],
                        },
                    ),
                ),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    print(
        json.dumps(
            {
                "ok": True,
                "recordId": RECORD_ID,
                "registeredNetcdfFiles": registered,
                "imported": int(imported),
                "partial": int(partial),
                "remaining": int(remaining),
                "totalExpectedBytes": int(total_bytes),
            },
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
