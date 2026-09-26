#!/usr/bin/env python3
"""Import CDS W5E5 daily NetCDF files into the weather climate tables.

The CDS request is delivered as monthly global NetCDF files.  This importer
keeps only the already registered China point-list grid (3848 points), writes
one daily frame per source file/date, and records an idempotent state file so
an interrupted run can be resumed safely.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import time
from datetime import date
from pathlib import Path
from typing import Any

import netCDF4
import numpy as np
import psycopg2
from psycopg2.extras import Json, execute_values


FILE_RE = re.compile(r"^(?P<name>[^_]+)_W5E5_(?P<year>\d{4})(?P<month>\d{2})_v3\.0\.nc$", re.I)
VARIABLES = {
    "Tair": ("tas", "Near-Surface Air Temperature"),
    "Qair": ("huss", "Near-Surface Specific Humidity"),
    "PSurf": ("ps", "Surface Air Pressure"),
    "SWdown": ("rsds", "Surface Downwelling Shortwave Radiation"),
    "Wind": ("sfcwind", "Near-Surface Wind Speed"),
    "pr": ("pr", "Precipitation"),
}
SOURCE_ID = 342217  # W5E5 DOI: 10.48364/ISIMIP.342217 (legacy column name)
SOURCE_URL = "https://cds.climate.copernicus.eu/datasets/derived-near-surface-meteorological-variables?tab=download"
LICENSE = "CC-BY-4.0"
BATCH_DAYS = 31


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import W5E5 monthly NetCDF files into PostgreSQL.")
    parser.add_argument("--root", type=Path, required=True, help="Directory containing the extracted nc/ directory")
    parser.add_argument("--connection-string", default=None, help="PostgreSQL connection string; preferably supplied via env")
    parser.add_argument("--connection-env", default="W5E5_DATABASE_URL", help="Environment variable holding the connection string")
    parser.add_argument("--limit-files", type=int, default=None, help="Import at most N files (for a canary run)")
    return parser.parse_args()


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def read_state(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "pending", "completedFiles": [], "failedFiles": []}


def as_float32(values: Any) -> np.ndarray:
    # netCDF4 returns a masked array when a fill value is present.
    values = np.ma.filled(values, np.nan)
    values = np.asarray(values, dtype="<f4")
    return np.ascontiguousarray(values, dtype="<f4")


def file_digests(path: Path) -> tuple[str, str]:
    md5 = hashlib.md5()
    sha256 = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            md5.update(chunk)
            sha256.update(chunk)
    return md5.hexdigest(), sha256.hexdigest()


def date_values(dataset: netCDF4.Dataset) -> list[date]:
    coordinate = dataset.variables["time"]
    calendar = str(getattr(coordinate, "calendar", "standard"))
    decoded = netCDF4.num2date(
        coordinate[:],
        units=str(coordinate.units),
        calendar=calendar,
        only_use_cftime_datetimes=False,
        only_use_python_datetimes=True,
    )
    return [date(int(item.year), int(item.month), int(item.day)) for item in decoded]


def load_existing_grid(connection: Any) -> tuple[int, np.ndarray]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, point_count, coordinate_data
            FROM weather.climate_projection_grids
            WHERE spatial_resolution_deg=0.5
            ORDER BY point_count ASC
            LIMIT 1
            """,
        )
        row = cursor.fetchone()
    if row is None:
        raise RuntimeError("No 0.5-degree climate grid exists in weather.climate_projection_grids")
    grid_id, point_count, compressed = int(row[0]), int(row[1]), bytes(row[2])
    raw = gzip.decompress(compressed)
    coordinates = np.frombuffer(raw, dtype="<f4").reshape((point_count, 2))
    if coordinates.shape != (point_count, 2):
        raise RuntimeError(f"Unexpected existing grid shape: {coordinates.shape}")
    return grid_id, np.ascontiguousarray(coordinates, dtype="<f8")


def coordinate_indices(coordinates: np.ndarray, latitudes: np.ndarray, longitudes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lat0 = float(latitudes[0])
    lon0 = float(longitudes[0])
    lat_step = float(np.median(np.diff(latitudes)))
    lon_step = float(np.median(np.diff(longitudes)))
    if not np.isclose(abs(lat_step), 0.5) or not np.isclose(abs(lon_step), 0.5):
        raise RuntimeError(f"Unexpected W5E5 grid step: lat={lat_step}, lon={lon_step}")
    lon_indices = np.rint((coordinates[:, 0] - lon0) / lon_step).astype(np.int64)
    lat_indices = np.rint((coordinates[:, 1] - lat0) / lat_step).astype(np.int64)
    if np.any(lon_indices < 0) or np.any(lon_indices >= longitudes.size):
        raise RuntimeError("Existing grid longitude falls outside W5E5 coordinates")
    if np.any(lat_indices < 0) or np.any(lat_indices >= latitudes.size):
        raise RuntimeError("Existing grid latitude falls outside W5E5 coordinates")
    if not np.allclose(longitudes[lon_indices], coordinates[:, 0], atol=1e-5):
        raise RuntimeError("Existing grid longitude centers do not match W5E5")
    if not np.allclose(latitudes[lat_indices], coordinates[:, 1], atol=1e-5):
        raise RuntimeError("Existing grid latitude centers do not match W5E5")
    return lat_indices, lon_indices


def upsert_source(
    connection: Any,
    file_path: Path,
    variable: str,
    first_day: date,
    last_day: date,
    file_md5: str,
    file_sha256: str,
) -> int:
    source_name = f"w5e5_v3.0_{variable}_{first_day:%Y%m}_{file_path.name}"
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO weather.climate_projection_sources (
              zenodo_record_id, file_name, gcm, scenario, variable,
              period_start, period_end, spatial_resolution_deg, source_url,
              expected_size_bytes, md5, license, download_status, import_status,
              imported_days, source_attributes, error, updated_at
            ) VALUES (
              %s,%s,'w5e5','historical',%s,%s,%s,0.5,%s,%s,%s,%s,'verified','importing',0,%s,NULL,now()
            )
            ON CONFLICT (file_name) DO UPDATE SET
              expected_size_bytes=EXCLUDED.expected_size_bytes,
              md5=EXCLUDED.md5,
              download_status='verified',
              import_status=CASE WHEN weather.climate_projection_sources.import_status='imported' THEN 'imported' ELSE 'importing' END,
              source_attributes=weather.climate_projection_sources.source_attributes || EXCLUDED.source_attributes,
              error=NULL,
              updated_at=now()
            RETURNING id
            """,
            (
                SOURCE_ID,
                source_name,
                variable,
                first_day,
                last_day,
                SOURCE_URL,
                file_path.stat().st_size,
                file_md5,
                LICENSE,
                Json({"dataset": "W5E5", "version": "3.0", "originalFile": file_path.name, "aggregation": "daily", "sourceDoi": "10.48364/ISIMIP.342217", "sha256": file_sha256}),
            ),
        )
        source_id = int(cursor.fetchone()[0])
    connection.commit()
    return source_id


def import_file(connection: Any, file_path: Path, grid_id: int, coordinates: np.ndarray) -> tuple[int, int, str]:
    match = FILE_RE.match(file_path.name)
    if not match or match.group("name") not in VARIABLES:
        raise RuntimeError(f"Unsupported W5E5 file name: {file_path.name}")
    prefix = match.group("name")
    variable, _ = VARIABLES[prefix]
    file_md5, file_sha256 = file_digests(file_path)
    with netCDF4.Dataset(file_path, "r") as dataset:
        if "lat" not in dataset.variables or "lon" not in dataset.variables or "time" not in dataset.variables:
            raise RuntimeError(f"Missing coordinate in {file_path.name}")
        latitudes = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        longitudes = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        lat_indices, lon_indices = coordinate_indices(coordinates, latitudes, longitudes)
        # Wind files use the NetCDF variable name ``sfcWind`` while the
        # database/application vocabulary is the lowercase ``sfcwind``.
        variable_name = next(
            (name for name in dataset.variables if name.lower() == variable.lower()),
            variable,
        )
        if variable_name not in dataset.variables:
            raise RuntimeError(f"Variable {variable!r} is missing from {file_path.name}")
        variable_object = dataset.variables[variable_name]
        if tuple(variable_object.dimensions) != ("time", "lat", "lon"):
            raise RuntimeError(f"Unexpected dimensions for {file_path.name}: {variable_object.dimensions}")
        dates = date_values(dataset)
        if len(dates) != variable_object.shape[0]:
            raise RuntimeError(f"Time length mismatch for {file_path.name}")
        source_id = upsert_source(connection, file_path, variable, dates[0], dates[-1], file_md5, file_sha256)
        unit = str(getattr(variable_object, "units", "unknown"))
        imported = 0
        batch: list[tuple[Any, ...]] = []
        for day_index, valid_date in enumerate(dates):
            # netCDF4 uses orthogonal indexing for multiple index arrays; read
            # one full 2-D day first, then pair-index the China locations.
            full_day = variable_object[day_index, :, :]
            values = as_float32(full_day[lat_indices, lon_indices])
            finite = np.isfinite(values)
            finite_values = values[finite]
            compressed = gzip.compress(values.tobytes(order="C"), compresslevel=4)
            frame_hash = hashlib.sha256(compressed).hexdigest()
            min_value = float(np.min(finite_values)) if finite_values.size else None
            max_value = float(np.max(finite_values)) if finite_values.size else None
            mean_value = float(np.mean(finite_values, dtype=np.float64)) if finite_values.size else None
            missing_count = int(values.size - finite_values.size)
            stats = {
                "min": min_value,
                "max": max_value,
                "mean": mean_value,
                "missingCount": missing_count,
                "uncompressedBytes": int(values.nbytes),
                "compressedBytes": len(compressed),
                "aggregation": "daily",
                "originalDimensions": ["time", "lat", "lon"],
            }
            batch.append((source_id, grid_id, valid_date, variable, unit, 1, values.size, compressed, frame_hash, min_value, max_value, mean_value, missing_count, Json(stats)))
            imported += 1
            if len(batch) >= BATCH_DAYS or imported == len(dates):
                with connection.cursor() as cursor:
                    execute_values(
                        cursor,
                        """
                        INSERT INTO weather.climate_projection_daily (
                          source_id, grid_id, valid_date, variable, unit, hours, point_count,
                          data_type, byte_order, dimension_order, compression, frame_data,
                          frame_sha256, min_value, max_value, mean_value, missing_count, statistics, imported_at
                        ) VALUES %s
                        ON CONFLICT (source_id, valid_date) DO UPDATE SET
                          grid_id=EXCLUDED.grid_id, variable=EXCLUDED.variable, unit=EXCLUDED.unit,
                          hours=EXCLUDED.hours, point_count=EXCLUDED.point_count,
                          data_type=EXCLUDED.data_type, byte_order=EXCLUDED.byte_order,
                          dimension_order=EXCLUDED.dimension_order, compression=EXCLUDED.compression,
                          frame_data=EXCLUDED.frame_data, frame_sha256=EXCLUDED.frame_sha256,
                          min_value=EXCLUDED.min_value, max_value=EXCLUDED.max_value,
                          mean_value=EXCLUDED.mean_value, missing_count=EXCLUDED.missing_count,
                          statistics=EXCLUDED.statistics, imported_at=now()
                        """,
                        batch,
                        template="(%s,%s,%s,%s,%s,%s,%s,'float32','little-endian','hour,location','gzip',%s,%s,%s,%s,%s,%s,%s,now())",
                        page_size=len(batch),
                    )
                connection.commit()
                batch.clear()
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE weather.climate_projection_sources
                SET grid_id=%s, imported_days=%s, import_status='imported', imported_at=now(), error=NULL,
                    source_attributes=source_attributes || %s::jsonb, updated_at=now()
                WHERE id=%s
                """,
                (grid_id, imported, Json({"unit": unit, "pointCount": int(coordinates.shape[0]), "hoursPerFrame": 1}), source_id),
            )
        connection.commit()
    return source_id, imported, file_sha256


def main() -> int:
    args = parse_args()
    connection_string = args.connection_string or os.environ.get(args.connection_env)
    if not connection_string:
        raise RuntimeError(f"Missing PostgreSQL connection string in {args.connection_env}")
    nc_root = args.root / "nc"
    files = sorted(nc_root.glob("*_W5E5_??????_v3.0.nc"))
    if args.limit_files is not None:
        files = files[: args.limit_files]
    if not files:
        raise RuntimeError(f"No W5E5 NetCDF files found under {nc_root}")
    state_path = args.root / "import-state.json"
    state = read_state(state_path)
    state.update({"status": "running", "root": str(args.root), "totalFiles": len(files), "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    state.setdefault("completedFiles", [])
    state.setdefault("failedFiles", [])
    completed = set(state["completedFiles"])
    completed_days = int(state.get("completedDays", 0))
    failed = {item.get("file") for item in state["failedFiles"] if isinstance(item, dict)}
    connection = psycopg2.connect(connection_string)
    connection.autocommit = False
    try:
        grid_id, coordinates = load_existing_grid(connection)
        state["gridId"] = grid_id
        state["pointCount"] = int(coordinates.shape[0])
        write_state(state_path, state)
        for index, file_path in enumerate(files, start=1):
            if file_path.name in completed:
                continue
            try:
                source_id, imported, file_hash = import_file(connection, file_path, grid_id, coordinates)
                completed.add(file_path.name)
                failed.discard(file_path.name)
                state["completedFiles"] = sorted(completed)
                state["failedFiles"] = [item for item in state["failedFiles"] if item.get("file") != file_path.name]
                completed_days += imported
                state["completedDays"] = completed_days
                state["lastFile"] = {"file": file_path.name, "sourceId": source_id, "importedDays": imported, "sha256": file_hash}
                state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                write_state(state_path, state)
                print(f"Imported {index}/{len(files)} {file_path.name}: {imported} days", flush=True)
            except Exception as error:
                connection.rollback()
                failed.add(file_path.name)
                state["failedFiles"] = [{"file": name, "error": str(error)} for name in sorted(failed)]
                state["status"] = "failed"
                state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                write_state(state_path, state)
                raise
        state["status"] = "complete"
        state["completedFiles"] = sorted(completed)
        state["completedFileCount"] = len(completed)
        state["completedDays"] = completed_days
        state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_state(state_path, state)
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
