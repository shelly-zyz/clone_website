#!/usr/bin/env python3
"""Download one Zenodo climate NetCDF file, import daily grid chunks, then remove it.

The script intentionally processes exactly one named Zenodo file per invocation.
This bounds scratch-disk usage and makes every imported source independently
restartable and auditable.
"""

from __future__ import annotations

import argparse
import ctypes
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import netCDF4
import numpy as np
import psycopg2
from dotenv import dotenv_values
from psycopg2.extras import Json, execute_values


ZENODO_API = "https://zenodo.org/api/records/{record_id}"
USER_AGENT = "OpenGridWorks-Zenodo-Climate-Importer/1.0"
FILE_PATTERN = re.compile(
    r"^(?P<gcm>.+)_(?P<scenario>ssp\d+)_(?P<variable>[a-z0-9]+)_"
    r"(?P<start>\d{4})_(?P<end>\d{4})\.nc$",
    re.IGNORECASE,
)
BATCH_DAYS = 31


def ensure_normal_priority() -> None:
    """Avoid Windows Task Scheduler's below-normal default throttling imports."""
    if os.name != "nt":
        return
    normal_priority_class = 0x00000020
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.SetPriorityClass.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
    kernel32.SetPriorityClass.restype = ctypes.c_bool
    current_process = kernel32.GetCurrentProcess()
    if not kernel32.SetPriorityClass(current_process, normal_priority_class):
        raise ctypes.WinError()


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    parser = argparse.ArgumentParser(
        description="Import one Zenodo hourly climate NetCDF into PostgreSQL daily chunks.",
    )
    parser.add_argument("--record-id", type=int, default=20501729)
    parser.add_argument("--file", required=True, help="Exact file name in the Zenodo record.")
    parser.add_argument(
        "--scratch-dir",
        type=Path,
        default=repo_root / ".scratch" / "zenodo-climate",
    )
    parser.add_argument(
        "--keep-netcdf",
        action="store_true",
        help="Keep the downloaded NetCDF after a successful database import.",
    )
    parser.add_argument(
        "--start-day",
        type=int,
        default=0,
        help="Zero-based first day to import. Used for bounded parallel backfills.",
    )
    parser.add_argument(
        "--limit-days",
        type=int,
        help="Import only the first N days for a pipeline test.",
    )
    return parser.parse_args()


def request_json(url: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, 4):
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.load(response)
        except Exception as error:
            last_error = error
            print(
                f"Zenodo metadata attempt {attempt}/3 failed: {error}",
                flush=True,
            )
            if attempt < 3:
                time.sleep(min(30, attempt * 3))
    raise RuntimeError(f"Zenodo metadata request failed after 3 attempts: {last_error}")


def zenodo_file(record: dict[str, Any], file_name: str) -> dict[str, Any]:
    for item in record.get("files", []):
        if item.get("key") == file_name:
            return item
    raise RuntimeError(f"File is not present in Zenodo record: {file_name}")


def download_with_resume(url: str, target: Path, expected_size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f"{target.name}.part")
    if target.exists() and target.stat().st_size == expected_size:
        print(f"Using complete scratch file: {target}")
        return
    last_error: Exception | None = None
    for attempt in range(1, 21):
        downloaded = partial.stat().st_size if partial.exists() else 0
        if downloaded > expected_size:
            raise RuntimeError(f"Partial file is larger than expected: {partial}")
        if downloaded == expected_size:
            break
        headers = {"User-Agent": USER_AGENT}
        if downloaded:
            headers["Range"] = f"bytes={downloaded}-"
        request = urllib.request.Request(url, headers=headers)
        mode = "ab" if downloaded else "wb"
        try:
            print(
                f"Download connection {attempt}/20, resuming at "
                f"{downloaded / 1024 / 1024:.1f} MiB",
                flush=True,
            )
            with urllib.request.urlopen(request, timeout=240) as response:
                if downloaded and response.status != 206:
                    raise RuntimeError("Zenodo did not honor the resume range request.")
                with partial.open(mode) as output:
                    last_report = time.monotonic()
                    while True:
                        chunk = response.read(4 * 1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
                        downloaded += len(chunk)
                        now = time.monotonic()
                        if now - last_report >= 5:
                            print(
                                f"Downloaded {downloaded / 1024 / 1024:.1f}/"
                                f"{expected_size / 1024 / 1024:.1f} MiB",
                                flush=True,
                            )
                            last_report = now
            if downloaded == expected_size:
                break
            last_error = RuntimeError(
                f"Connection ended early at {downloaded} of {expected_size} bytes",
            )
        except Exception as error:
            last_error = error
            print(f"Download connection failed: {error}", flush=True)
        if attempt < 20:
            time.sleep(min(30, attempt * 3))
    if not partial.exists() or partial.stat().st_size != expected_size:
        actual_size = partial.stat().st_size if partial.exists() else 0
        raise RuntimeError(
            f"Incomplete download after 20 connections: expected {expected_size}, "
            f"got {actual_size}; last error: {last_error}",
        )
    os.replace(partial, target)


def file_md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file_md5(path: Path, expected_md5: str) -> Path:
    marker = path.with_name(f"{path.name}.md5-ok")
    stat = path.stat()
    signature = f"{expected_md5}:{stat.st_size}:{stat.st_mtime_ns}"
    try:
        if marker.read_text(encoding="utf-8").strip() == signature:
            print(f"Using cached MD5 verification: {expected_md5}", flush=True)
            return marker
    except FileNotFoundError:
        pass
    actual_md5 = file_md5(path)
    if actual_md5 != expected_md5:
        raise RuntimeError(f"MD5 mismatch: expected {expected_md5}, got {actual_md5}")
    marker.write_text(signature, encoding="utf-8")
    print(f"Verified MD5: {actual_md5}", flush=True)
    return marker


def load_database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    ssl_enabled = str(values.get("DATABASE_SSL", "")).lower() == "true"
    return str(connection_string), ssl_enabled


def catalog_file(
    repo_root: Path,
    record_id: int,
    file_name: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    connection_string, ssl_enabled = load_database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
        connect_timeout=20,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT zenodo_record_id, source_url, expected_size_bytes, md5,
                       license, source_attributes
                FROM website_data.climate_projection_sources
                WHERE file_name=%s
                """,
                (file_name,),
            )
            row = cursor.fetchone()
    finally:
        connection.close()
    if row is None:
        raise RuntimeError(f"Climate source is not registered: {file_name}")
    stored_record_id, source_url, expected_size, md5, license_id, attributes = row
    if int(stored_record_id) != record_id:
        raise RuntimeError(
            f"Catalog record mismatch for {file_name}: "
            f"expected {record_id}, got {stored_record_id}",
        )
    source_attributes = attributes or {}
    record = {
        "id": int(stored_record_id),
        "metadata": {
            "title": source_attributes.get("title"),
            "publication_date": source_attributes.get("publication_date"),
            "license": {"id": license_id or "cc-by-4.0"},
        },
    }
    item = {
        "key": file_name,
        "size": int(expected_size),
        "checksum": f"md5:{md5}",
        "links": {"self": source_url},
    }
    return record, item


def apply_projection_schema(connection: Any, schema_path: Path) -> None:
    sql = schema_path.read_text(encoding="utf-8")
    start = sql.index("CREATE TABLE IF NOT EXISTS website_data.climate_projection_sources")
    end = sql.index("CREATE TABLE IF NOT EXISTS website_data.carbon_source_archives")
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtext('opengridworks-climate-schema'))",
        )
        cursor.execute("CREATE SCHEMA IF NOT EXISTS website_data AUTHORIZATION CURRENT_USER")
        cursor.execute(sql[start:end])
    connection.commit()


def find_coordinate(dataset: netCDF4.Dataset, names: tuple[str, ...]) -> str:
    for name in names:
        if name in dataset.variables:
            return name
    raise RuntimeError(f"Missing coordinate variable; expected one of {names}")


def find_data_variable(dataset: netCDF4.Dataset, expected: str) -> str:
    if expected in dataset.variables:
        return expected
    candidates = [
        name
        for name, variable in dataset.variables.items()
        if len(variable.dimensions) in {2, 3}
        and name not in {"time", "lat", "latitude", "lon", "longitude"}
    ]
    if len(candidates) == 1:
        return candidates[0]
    raise RuntimeError(f"Could not identify data variable {expected!r}; candidates={candidates}")


def json_float(value: float) -> float:
    return round(float(value), 8)


def decoded_dates(time_variable: Any, period_start: date) -> list[date]:
    units = str(getattr(time_variable, "units", ""))
    values = np.asarray(time_variable[:], dtype=np.float64)
    if units.strip().lower() == "hours utc+08":
        rounded = np.rint(values).astype(np.int64)
        if not np.allclose(values, rounded) or not np.array_equal(
            rounded,
            np.arange(rounded.size, dtype=np.int64),
        ):
            raise RuntimeError("Non-contiguous time values for the 'hours UTC+08' convention.")
        return [period_start + timedelta(days=int(value) // 24) for value in rounded]
    calendar = getattr(time_variable, "calendar", "standard")
    timestamps = netCDF4.num2date(
        time_variable[:],
        units=time_variable.units,
        calendar=calendar,
        only_use_cftime_datetimes=False,
        only_use_python_datetimes=False,
    )
    result: list[date] = []
    for value in timestamps:
        result.append(date(int(value.year), int(value.month), int(value.day)))
    return result


def upsert_grid(
    connection: Any,
    longitudes: np.ndarray,
    latitudes: np.ndarray,
) -> int:
    coordinates = np.column_stack((longitudes, latitudes)).astype("<f4", copy=False)
    coordinates = np.ascontiguousarray(coordinates, dtype="<f4")
    raw = coordinates.tobytes(order="C")
    grid_hash = hashlib.sha256(raw).hexdigest()
    compressed = gzip.compress(raw, compresslevel=9)
    coordinate_sha256 = hashlib.sha256(compressed).hexdigest()
    metadata = {
        "shape": [int(coordinates.shape[0]), 2],
        "columns": ["longitude", "latitude"],
        "uncompressedBytes": len(raw),
        "compressedBytes": len(compressed),
    }
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO website_data.climate_projection_grids (
              grid_hash, grid_type, point_count, spatial_resolution_deg,
              longitude_min, longitude_max, latitude_min, latitude_max,
              data_type, byte_order, coordinate_order, compression,
              coordinate_data, coordinate_sha256, metadata
            ) VALUES (
              %s,'point-list',%s,0.5,%s,%s,%s,%s,'float32','little-endian',
              'location,(longitude,latitude)','gzip',%s,%s,%s
            )
            ON CONFLICT (grid_hash) DO UPDATE SET
              metadata=EXCLUDED.metadata
            RETURNING id
            """,
            (
                grid_hash,
                int(coordinates.shape[0]),
                float(np.min(longitudes)),
                float(np.max(longitudes)),
                float(np.min(latitudes)),
                float(np.max(latitudes)),
                psycopg2.Binary(compressed),
                coordinate_sha256,
                Json(metadata),
            ),
        )
        grid_id = int(cursor.fetchone()[0])
    connection.commit()
    return grid_id


def upsert_source(
    connection: Any,
    record: dict[str, Any],
    item: dict[str, Any],
    parsed: re.Match[str],
    source_url: str,
) -> int:
    checksum = str(item["checksum"]).removeprefix("md5:")
    start_year = int(parsed.group("start"))
    end_year = int(parsed.group("end"))
    metadata = record.get("metadata", {})
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO website_data.climate_projection_sources (
              zenodo_record_id, file_name, gcm, scenario, variable,
              period_start, period_end, spatial_resolution_deg, source_url,
              expected_size_bytes, md5, license, download_status, import_status,
              source_attributes, error, updated_at
            ) VALUES (
              %s,%s,%s,%s,%s,%s,%s,0.5,%s,%s,%s,%s,'verified','importing',%s,NULL,now()
            )
            ON CONFLICT (file_name) DO UPDATE SET
              source_url=EXCLUDED.source_url,
              expected_size_bytes=EXCLUDED.expected_size_bytes,
              md5=EXCLUDED.md5,
              license=EXCLUDED.license,
              download_status='verified',
              import_status='importing',
              source_attributes=EXCLUDED.source_attributes,
              error=NULL,
              updated_at=now()
            RETURNING id
            """,
            (
                record["id"],
                item["key"],
                parsed.group("gcm").lower(),
                parsed.group("scenario").lower(),
                parsed.group("variable").lower(),
                date(start_year, 1, 1),
                date(end_year, 12, 31),
                source_url,
                int(item["size"]),
                checksum,
                metadata.get("license", {}).get("id", "cc-by-4.0"),
                Json(
                    {
                        "title": metadata.get("title"),
                        "publication_date": metadata.get("publication_date"),
                        "zenodo_record_url": f"https://zenodo.org/records/{record['id']}",
                    },
                ),
            ),
        )
        source_id = int(cursor.fetchone()[0])
    connection.commit()
    return source_id


def import_netcdf(
    connection: Any,
    path: Path,
    source_id: int,
    expected_variable: str,
    period_start: date,
    start_day: int,
    limit_days: int | None,
) -> int:
    with netCDF4.Dataset(path, "r") as dataset:
        time_name = find_coordinate(dataset, ("time",))
        lat_name = find_coordinate(dataset, ("lat", "latitude"))
        lon_name = find_coordinate(dataset, ("lon", "longitude"))
        variable_name = find_data_variable(dataset, expected_variable)
        variable = dataset.variables[variable_name]
        chunking = variable.chunking()
        if (
            isinstance(chunking, (list, tuple))
            and len(chunking) == 2
            and all(isinstance(value, int) and value > 0 for value in chunking)
        ):
            location_chunks = (
                int(variable.shape[1]) + int(chunking[1]) - 1
            ) // int(chunking[1])
            working_set_bytes = (
                int(chunking[0])
                * int(chunking[1])
                * int(variable.dtype.itemsize)
                * location_chunks
            )
            cache_bytes = max(
                64 * 1024 * 1024,
                min(384 * 1024 * 1024, int(working_set_bytes * 1.25)),
            )
            variable.set_var_chunk_cache(
                size=cache_bytes,
                nelems=1009,
                preemption=0.75,
            )
            print(
                f"Configured NetCDF chunk cache: "
                f"{cache_bytes / 1024 / 1024:.1f} MiB",
                flush=True,
            )
        location_dimension = dataset.variables[lat_name].dimensions
        if (
            len(location_dimension) != 1
            or dataset.variables[lon_name].dimensions != location_dimension
        ):
            raise RuntimeError("Longitude and latitude must share one location dimension.")
        expected_dims = (
            dataset.variables[time_name].dimensions[0],
            location_dimension[0],
        )
        if variable.dimensions != expected_dims:
            raise RuntimeError(
                f"Unexpected dimension order {variable.dimensions}; expected {expected_dims}",
            )

        latitudes = np.asarray(dataset.variables[lat_name][:], dtype=np.float64)
        longitudes = np.asarray(dataset.variables[lon_name][:], dtype=np.float64)
        all_dates = decoded_dates(dataset.variables[time_name], period_start)
        if len(all_dates) != variable.shape[0]:
            raise RuntimeError("Time coordinate length does not match climate variable.")
        if len(all_dates) % 24 != 0:
            raise RuntimeError(f"Hourly time length is not divisible by 24: {len(all_dates)}")

        total_day_count = len(all_dates) // 24
        if start_day < 0 or start_day >= total_day_count:
            raise RuntimeError(
                f"start-day must be between 0 and {total_day_count - 1}: {start_day}",
            )
        end_day = total_day_count
        if limit_days is not None:
            if limit_days <= 0:
                raise RuntimeError("limit-days must be positive.")
            end_day = min(total_day_count, start_day + limit_days)
        range_day_count = end_day - start_day
        if latitudes.shape != longitudes.shape or latitudes.ndim != 1:
            raise RuntimeError("Longitude and latitude point lists must have the same shape.")
        grid_id = upsert_grid(connection, longitudes, latitudes)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE website_data.climate_projection_sources
                SET grid_id=%s,
                    source_attributes=source_attributes || %s::jsonb,
                    updated_at=now()
                WHERE id=%s
                """,
                (
                    grid_id,
                    Json(
                        {
                            "timeZone": "UTC+08:00",
                            "timeUnits": str(getattr(dataset.variables[time_name], "units", "")),
                            "sourceDimensions": list(variable.dimensions),
                            "sourceShape": list(variable.shape),
                            "unit": str(getattr(variable, "units", "unknown")),
                        },
                    ),
                    source_id,
                ),
            )
        connection.commit()
        unit = str(getattr(variable, "units", "unknown"))

        imported = 0
        batch: list[tuple[Any, ...]] = []
        for day_index in range(start_day, end_day):
            start = day_index * 24
            end = start + 24
            day_dates = all_dates[start:end]
            if len(set(day_dates)) != 1:
                raise RuntimeError(f"Day boundary is not aligned at time index {start}.")
            values = np.ma.filled(variable[start:end, :], np.nan)
            values = np.asarray(values, dtype="<f4")
            values = np.ascontiguousarray(values, dtype="<f4")
            finite = np.isfinite(values)
            finite_values = values[finite]
            compressed = gzip.compress(values.tobytes(order="C"), compresslevel=4)
            frame_sha256 = hashlib.sha256(compressed).hexdigest()
            if finite_values.size:
                min_value = float(np.min(finite_values))
                max_value = float(np.max(finite_values))
                mean_value = float(np.mean(finite_values, dtype=np.float64))
            else:
                min_value = max_value = mean_value = None
            missing_count = int(values.size - finite_values.size)
            stats = {
                "min": min_value,
                "max": max_value,
                "mean": mean_value,
                "missingCount": missing_count,
                "uncompressedBytes": int(values.nbytes),
                "compressedBytes": len(compressed),
            }
            batch.append(
                (
                    source_id,
                    grid_id,
                    day_dates[0],
                    variable_name,
                    unit,
                    int(longitudes.size),
                    psycopg2.Binary(compressed),
                    frame_sha256,
                    min_value,
                    max_value,
                    mean_value,
                    missing_count,
                    Json(stats),
                ),
            )
            imported += 1
            if len(batch) == BATCH_DAYS or imported == range_day_count:
                with connection.cursor() as cursor:
                    execute_values(
                        cursor,
                        """
                    INSERT INTO website_data.climate_projection_daily (
                      source_id, grid_id, valid_date, variable, unit, hours, point_count,
                      data_type, byte_order,
                      dimension_order, compression, frame_data, frame_sha256,
                      min_value, max_value, mean_value, missing_count, statistics,
                      imported_at
                    ) VALUES %s
                    ON CONFLICT (source_id, valid_date) DO UPDATE SET
                      grid_id=EXCLUDED.grid_id,
                      unit=EXCLUDED.unit,
                      hours=EXCLUDED.hours,
                      point_count=EXCLUDED.point_count,
                      frame_data=EXCLUDED.frame_data,
                      frame_sha256=EXCLUDED.frame_sha256,
                      min_value=EXCLUDED.min_value,
                      max_value=EXCLUDED.max_value,
                      mean_value=EXCLUDED.mean_value,
                      missing_count=EXCLUDED.missing_count,
                      statistics=EXCLUDED.statistics,
                      imported_at=now()
                    """,
                        batch,
                        template=(
                            "(%s,%s,%s,%s,%s,24,%s,'float32','little-endian',"
                            "'hour,location','gzip',%s,%s,%s,%s,%s,%s,%s,now())"
                        ),
                        page_size=len(batch),
                    )
                connection.commit()
                print(f"Imported {imported}/{range_day_count} daily chunks", flush=True)
                batch.clear()
        return imported


def set_source_status(
    connection: Any,
    source_id: int,
    status: str,
    imported_days: int,
    error: str | None = None,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE website_data.climate_projection_sources
            SET import_status=%s,
                imported_days=%s,
                error=%s,
                imported_at=CASE WHEN %s='imported' THEN now() ELSE imported_at END,
                updated_at=now()
            WHERE id=%s
            """,
            (status, imported_days, error, status, source_id),
        )
    connection.commit()


def main() -> int:
    ensure_normal_priority()
    args = parse_args()
    parsed = FILE_PATTERN.match(args.file)
    if not parsed:
        raise RuntimeError(f"Unsupported Zenodo climate file name: {args.file}")

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    try:
        record, item = catalog_file(
            repo_root,
            args.record_id,
            args.file,
        )
        print("Using verified database catalog metadata.", flush=True)
    except Exception as catalog_error:
        print(
            f"Database catalog metadata unavailable; requesting Zenodo: "
            f"{catalog_error}",
            flush=True,
        )
        record = request_json(ZENODO_API.format(record_id=args.record_id))
        item = zenodo_file(record, args.file)
    source_url = item["links"]["self"]
    expected_size = int(item["size"])
    expected_md5 = str(item["checksum"]).removeprefix("md5:")
    scratch_path = args.scratch_dir.resolve() / args.file

    print(f"Downloading one source file: {args.file}", flush=True)
    download_with_resume(source_url, scratch_path, expected_size)
    verification_marker = verify_file_md5(scratch_path, expected_md5)

    connection_string, ssl_enabled = load_database_config(repo_root)
    sslmode = "require" if ssl_enabled else "disable"
    connection = psycopg2.connect(
        connection_string,
        sslmode=sslmode,
        connect_timeout=20,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )
    source_id: int | None = None
    imported_days = 0
    try:
        apply_projection_schema(connection, script_dir / "database-schema.sql")
        source_id = upsert_source(connection, record, item, parsed, source_url)
        imported_days = import_netcdf(
            connection,
            scratch_path,
            source_id,
            parsed.group("variable").lower(),
            date(int(parsed.group("start")), 1, 1),
            args.start_day,
            args.limit_days,
        )
        status = (
            "partial"
            if args.start_day > 0 or args.limit_days is not None
            else "imported"
        )
        set_source_status(connection, source_id, status, imported_days)
    except Exception as error:
        try:
            connection.rollback()
        except Exception:
            pass
        if source_id is not None:
            try:
                set_source_status(connection, source_id, "failed", imported_days, str(error))
            except Exception as status_error:
                print(
                    f"Could not record failed status on the closed connection: "
                    f"{status_error}",
                    file=sys.stderr,
                )
        raise
    finally:
        try:
            connection.close()
        except Exception:
            pass

    if not args.keep_netcdf:
        scratch_path.unlink()
        verification_marker.unlink(missing_ok=True)
        print(f"Removed the imported scratch file: {scratch_path}")
    print(
        json.dumps(
            {
                "ok": True,
                "recordId": args.record_id,
                "file": args.file,
                "days": imported_days,
                "databaseStatus": (
                    "partial"
                    if args.start_day > 0 or args.limit_days is not None
                    else "imported"
                ),
                "scratchFileKept": args.keep_netcdf,
            },
            indent=2,
        ),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted; the partial download can be resumed.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
