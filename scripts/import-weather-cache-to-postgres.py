#!/usr/bin/env python3
"""Import the latest decoded GFS Weather Earth fields into PostgreSQL."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import psycopg2
from dotenv import dotenv_values
from psycopg2.extras import Json


def database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    ssl_enabled = str(values.get("DATABASE_SSL", "")).lower() == "true"
    return str(connection_string), ssl_enabled


def apply_schema(connection: Any, schema_path: Path) -> None:
    sql = schema_path.read_text(encoding="utf-8")
    start = sql.index("CREATE TABLE IF NOT EXISTS website_data.weather_forecast_fields")
    end = sql.index("CREATE TABLE IF NOT EXISTS website_data.climate_projection_sources")
    with connection.cursor() as cursor:
        cursor.execute(sql[start:end])
    connection.commit()


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    cache_dir = repo_root / ".weather-cache"
    manifest = json.loads((cache_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("refreshStatus") != "live":
        raise RuntimeError("Weather cache is not a live GFS refresh.")

    connection_string, ssl_enabled = database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
    )
    imported: list[str] = []
    try:
        apply_schema(connection, script_dir / "database-schema.sql")
        for metric in manifest["metrics"]:
            path = cache_dir / f"{metric['key']}.json"
            raw = path.read_bytes()
            field = json.loads(raw)
            header = field["header"]
            compressed = gzip.compress(raw, compresslevel=6)
            sha256 = hashlib.sha256(compressed).hexdigest()
            metadata = {
                "encoding": field.get("encoding"),
                "stats": field.get("stats"),
                "nativeLevelLabel": metric.get("nativeLevelLabel"),
                "generatedAt": field.get("generatedAt"),
                "cacheFileBytes": len(raw),
                "compressedBytes": len(compressed),
                "payloadFormat": "WeatherEarth JSON; arrays retain project quantization",
                "acquisitionMode": "operational-live-sync",
                "restoredHistoricalSnapshot": False,
            }
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO website_data.weather_forecast_fields (
                      source, run_time_utc, forecast_hour, valid_time_utc,
                      metric, unit, field_kind, width, height,
                      longitude_min, latitude_max, dx, dy, compression,
                      payload_json_gzip, payload_sha256, metadata
                    ) VALUES (
                      %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                      'gzip',%s,%s,%s
                    )
                    ON CONFLICT (source, run_time_utc, forecast_hour, metric)
                    DO UPDATE SET
                      valid_time_utc=EXCLUDED.valid_time_utc,
                      unit=EXCLUDED.unit,
                      field_kind=EXCLUDED.field_kind,
                      payload_json_gzip=EXCLUDED.payload_json_gzip,
                      payload_sha256=EXCLUDED.payload_sha256,
                      metadata=EXCLUDED.metadata,
                      imported_at=now()
                    """,
                    (
                        field["source"],
                        header["refTime"],
                        int(header["forecastTime"]),
                        field["validTimeUtc"],
                        field["key"],
                        metric["unit"],
                        field["kind"],
                        int(header["nx"]),
                        int(header["ny"]),
                        float(header["lo1"]),
                        float(header["la1"]),
                        float(header["dx"]),
                        float(header["dy"]),
                        psycopg2.Binary(compressed),
                        sha256,
                        Json(metadata),
                    ),
                )
            connection.commit()
            imported.append(field["key"])

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
                  'noaa-gfs-live','气象地球','NOAA GFS operational forecast',
                  'NOAA/NCEP',
                  'https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p50',
                  'GRIB2 decoded and quantized grid','global',0.5,0.5,
                  '6-hour model cycles / 3-hour forecast steps',
                  %s::timestamptz::date,%s::timestamptz::date,'public NOMADS HTTPS',
                  false,'US Government public data','downloaded','imported',
                  'website_data.weather_forecast_fields','high',
                  'NOAA/NCEP业务GFS预报自动同步；它是近实时数值预报，不是地面实时观测。运行时刻、有效时刻和同步状态见metadata。',
                  %s
                )
                ON CONFLICT (dataset_key) DO UPDATE SET
                  coverage_start=EXCLUDED.coverage_start,
                  coverage_end=EXCLUDED.coverage_end,
                  acquisition_status=EXCLUDED.acquisition_status,
                  database_status=EXCLUDED.database_status,
                  notes=EXCLUDED.notes,
                  metadata=EXCLUDED.metadata,
                  updated_at=now()
                """,
                (
                    manifest["runTimeUtc"],
                    manifest["validTimeUtc"],
                    Json(
                        {
                            "runTimeUtc": manifest["runTimeUtc"],
                            "validTimeUtc": manifest["validTimeUtc"],
                            "forecastHour": manifest["forecastHour"],
                            "metrics": imported,
                            "refreshStatus": manifest["refreshStatus"],
                            "acquisitionMode": "operational-live-sync",
                            "restoredHistoricalSnapshot": False,
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
                "source": manifest["source"],
                "runTimeUtc": manifest["runTimeUtc"],
                "validTimeUtc": manifest["validTimeUtc"],
                "metrics": imported,
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
