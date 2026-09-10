#!/usr/bin/env python3
"""Stream the forecasting subset of a verified Hill of Towie archive into PostgreSQL."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import psycopg2
from dotenv import dotenv_values
from psycopg2.extras import Json, execute_values

SOURCE_ID = "hill-of-towie-v2-2025"
EXPECTED_MD5 = "d3cd7edb535a45ffca1c7028b397f035"
EXPECTED_BYTES = 1_596_220_683


def optional_float(value: str | None) -> float | None:
    if value is None or not value.strip():
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def optional_int(value: str | None) -> int | None:
    parsed = optional_float(value)
    return int(parsed) if parsed is not None else None


def optional_bool(value: str | None) -> bool | None:
    if value is None or not value.strip():
        return None
    normalized = value.strip().lower()
    if normalized in {"1", "true", "t", "yes"}:
        return True
    if normalized in {"0", "false", "f", "no"}:
        return False
    return None


def utc_timestamp(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("empty timestamp")
    parsed = datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    return parsed.isoformat(sep=" ")


def signal_quality(power_kw: float | None, wind_speed: float | None) -> str:
    if power_kw is None or wind_speed is None:
        return "missing"
    if power_kw < -115 or power_kw > 2_415 or wind_speed < 0 or wind_speed > 60:
        return "suspect"
    return "valid"


def observation_quality(power_mw: float | None) -> str:
    if power_mw is None:
        return "missing"
    # Negative net output is retained in the raw table for provenance, but it
    # is not a valid non-negative generation label for training.
    if power_mw < 0 or power_mw > 50.715:
        return "suspect"
    return "valid"


def read_rows(archive: zipfile.ZipFile, name: str) -> Iterable[dict[str, str]]:
    with archive.open(name) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as text:
        yield from csv.DictReader(text)


def build_month_rows(
    archive: zipfile.ZipFile,
    year: int,
    month: int,
    station_to_turbine: dict[str, str],
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    suffix = f"{year}_{month:02d}.csv"
    power: dict[tuple[str, str], float | None] = {}
    wind: dict[tuple[str, str], float | None] = {}
    availability: dict[tuple[str, str], tuple[float | None, float | None, float | None]] = {}

    for row in read_rows(archive, f"tblSCTurGrid_{suffix}"):
        key = (utc_timestamp(row["TimeStamp"]), row["StationId"])
        power[key] = optional_float(row.get("wtc_ActPower_mean"))
    for row in read_rows(archive, f"tblSCTurbine_{suffix}"):
        key = (utc_timestamp(row["TimeStamp"]), row["StationId"])
        wind[key] = optional_float(row.get("wtc_AcWindSp_mean"))
    for row in read_rows(archive, f"tblSCTurFlag_{suffix}"):
        key = (utc_timestamp(row["TimeStamp"]), row["StationId"])
        availability[key] = (
            optional_float(row.get("wtc_ScInOper_timeon")),
            optional_float(row.get("wtc_ScReToOp_timeon")),
            optional_float(row.get("wtc_ScTurSto_timeon")),
        )

    signal_rows: list[tuple[Any, ...]] = []
    for timestamp, station_id in sorted(set(power) | set(wind) | set(availability)):
        turbine_id = station_to_turbine.get(station_id)
        if turbine_id is None:
            raise RuntimeError(f"Unknown station ID {station_id}")
        power_kw = power.get((timestamp, station_id))
        wind_speed = wind.get((timestamp, station_id))
        running, ready, error = availability.get((timestamp, station_id), (None, None, None))
        fault_outage = None if error is None else error > 0
        signal_rows.append((
            SOURCE_ID, timestamp, turbine_id, power_kw, wind_speed,
            running, ready, error, fault_outage, None, signal_quality(power_kw, wind_speed),
        ))

    observation_rows: list[tuple[Any, ...]] = []
    for row in read_rows(archive, f"tblGridScientific_{suffix}"):
        active_power = optional_float(row.get("ActivePowerMean"))
        observation_rows.append((
            SOURCE_ID, utc_timestamp(row["TimeStamp"]), active_power,
            optional_float(row.get("ActiveEnergy")), optional_int(row.get("WPSStatus")),
            optional_bool(row.get("DataOk")), observation_quality(active_power),
        ))
    return signal_rows, observation_rows


def file_md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured")
    return str(connection_string), str(values.get("DATABASE_SSL", "")).lower() == "true"


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    archive_path = repo_root / ".forecast-data" / "hill-of-towie" / "2025.zip"
    metadata_path = repo_root / ".forecast-data" / "hill-of-towie" / "Hill_of_Towie_turbine_metadata.csv"
    profile_path = repo_root / ".forecast-data" / "hill-of-towie" / "site-profile.json"
    metadata_only = "--metadata-only" in sys.argv[1:]
    if metadata_only:
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        connection_string, ssl_enabled = load_database_config(repo_root)
        connection = psycopg2.connect(connection_string, sslmode="require" if ssl_enabled else "disable", connect_timeout=20)
        try:
            with connection.cursor() as cursor:
                cursor.execute("UPDATE website_data.forecast_scada_sources SET metadata=%s,updated_at=now() WHERE source_id=%s", (Json(profile), SOURCE_ID))
                if cursor.rowcount != 1:
                    raise RuntimeError("Imported Hill of Towie source row was not found")
            connection.commit()
            print(json.dumps({"sourceId": SOURCE_ID, "metadataUpdated": True}), flush=True)
            return 0
        finally:
            connection.close()
    if archive_path.stat().st_size != EXPECTED_BYTES:
        raise RuntimeError("2025 archive byte size does not match the pinned source manifest")
    actual_md5 = file_md5(archive_path)
    if actual_md5 != EXPECTED_MD5:
        raise RuntimeError(f"2025 archive MD5 mismatch: {actual_md5}")

    with metadata_path.open(encoding="utf-8-sig", newline="") as source:
        turbines = list(csv.DictReader(source))
    station_to_turbine = {row["Station ID"]: row["Turbine Name"] for row in turbines}
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    connection_string, ssl_enabled = load_database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
        connect_timeout=20,
        application_name="hill-of-towie-import",
    )
    imported_signals = 0
    imported_observations = 0
    try:
        with connection.cursor() as cursor:
            cursor.execute((repo_root / "scripts" / "forecast-scada-schema.sql").read_text(encoding="utf-8"))
            cursor.execute(
                """
                INSERT INTO website_data.forecast_scada_sources (
                  source_id,source_name,doi,source_url,license,archive_year,archive_file_name,
                  archive_size_bytes,archive_md5,native_resolution_minutes,entity_id,timezone,
                  import_status,metadata
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'loading',%s)
                ON CONFLICT (source_id) DO UPDATE SET
                  archive_size_bytes=EXCLUDED.archive_size_bytes,archive_md5=EXCLUDED.archive_md5,
                  import_status='loading',metadata=EXCLUDED.metadata,updated_at=now()
                """,
                (SOURCE_ID, "Hill of Towie Wind Farm Open Data", "10.5281/zenodo.20204946",
                 "https://zenodo.org/records/20204946", "CC-BY-4.0", 2025, "2025.zip",
                 EXPECTED_BYTES, EXPECTED_MD5, 10, "hill-of-towie", "UTC", Json(profile)),
            )
            turbine_values = [(
                SOURCE_ID, row["Turbine Name"], int(row["Station ID"]), float(row["Latitude"]),
                float(row["Longitude"]), float(row["Rated power (kW)"]), row["Manufacturer"],
                row["Model"], float(row["Hub Height (m)"]), float(row["Rotor Diameter (m)"]),
            ) for row in turbines]
            execute_values(cursor, """
                INSERT INTO website_data.forecast_scada_turbines (
                  source_id,turbine_id,station_id,latitude,longitude,rated_power_kw,
                  manufacturer,model,hub_height_m,rotor_diameter_m
                ) VALUES %s
                ON CONFLICT (source_id,turbine_id) DO UPDATE SET
                  station_id=EXCLUDED.station_id,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
                  rated_power_kw=EXCLUDED.rated_power_kw,manufacturer=EXCLUDED.manufacturer,
                  model=EXCLUDED.model,hub_height_m=EXCLUDED.hub_height_m,rotor_diameter_m=EXCLUDED.rotor_diameter_m
            """, turbine_values)
        connection.commit()

        with zipfile.ZipFile(archive_path) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError(f"ZIP CRC check failed at {bad}")
            for month in range(1, 13):
                signal_rows, observation_rows = build_month_rows(archive, 2025, month, station_to_turbine)
                with connection.cursor() as cursor:
                    execute_values(cursor, """
                        INSERT INTO website_data.forecast_scada_turbine_signals (
                          source_id,observed_at,turbine_id,active_power_kw,wind_speed_mps,
                          running_seconds,ready_seconds,error_seconds,fault_outage_flag,
                          curtailment_flag,quality_code
                        ) VALUES %s
                        ON CONFLICT (source_id,observed_at,turbine_id) DO UPDATE SET
                          active_power_kw=EXCLUDED.active_power_kw,wind_speed_mps=EXCLUDED.wind_speed_mps,
                          running_seconds=EXCLUDED.running_seconds,ready_seconds=EXCLUDED.ready_seconds,
                          error_seconds=EXCLUDED.error_seconds,fault_outage_flag=EXCLUDED.fault_outage_flag,
                          curtailment_flag=EXCLUDED.curtailment_flag,quality_code=EXCLUDED.quality_code
                    """, signal_rows, page_size=5_000)
                    execute_values(cursor, """
                        INSERT INTO website_data.forecast_scada_observations (
                          source_id,observed_at,active_power_mw,active_energy_mwh,
                          source_status,source_data_ok,quality_code
                        ) VALUES %s
                        ON CONFLICT (source_id,observed_at) DO UPDATE SET
                          active_power_mw=EXCLUDED.active_power_mw,active_energy_mwh=EXCLUDED.active_energy_mwh,
                          source_status=EXCLUDED.source_status,source_data_ok=EXCLUDED.source_data_ok,
                          quality_code=EXCLUDED.quality_code
                    """, observation_rows, page_size=5_000)
                connection.commit()
                imported_signals += len(signal_rows)
                imported_observations += len(observation_rows)
                print(json.dumps({"month": month, "turbineSignals": len(signal_rows), "observations": len(observation_rows)}), flush=True)

        with connection.cursor() as cursor:
            cursor.execute("""
                UPDATE website_data.forecast_scada_sources
                SET import_status='imported', imported_at=now(), updated_at=now()
                WHERE source_id=%s
            """, (SOURCE_ID,))
        connection.commit()
        print(json.dumps({
            "sourceId": SOURCE_ID, "status": "imported", "turbines": len(turbines),
            "turbineSignalsProcessed": imported_signals,
            "observationsProcessed": imported_observations,
            "archiveBytes": EXPECTED_BYTES, "archiveMd5": EXPECTED_MD5,
        }, indent=2), flush=True)
        return 0
    except Exception:
        connection.rollback()
        try:
            with connection.cursor() as cursor:
                cursor.execute("UPDATE website_data.forecast_scada_sources SET import_status='failed',updated_at=now() WHERE source_id=%s", (SOURCE_ID,))
            connection.commit()
        except Exception:
            connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
