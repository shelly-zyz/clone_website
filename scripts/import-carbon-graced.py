#!/usr/bin/env python3
"""Import one GRACED manifest into PostgreSQL.

This mirrors import-carbon-graced.mjs, but uses psycopg2. It is intended for
large aviation/shipping frames where the Node pg client was repeatedly hanging
while sending 5 MB bytea parameters over an unstable connection.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import psycopg2
import psycopg2.extras
import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = REPO_ROOT.parent
SCHEMA_PATH = SCRIPT_DIR / "database-schema.sql"
CHUNK_THRESHOLD_BYTES = 1_000_000
CHUNK_SIZE_BYTES = 32 * 1024
DB_RETRY_ATTEMPTS = 120
DB_RETRY_SLEEP_SECONDS = 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--max-new-frames", type=int, default=0)
    parser.add_argument("--skip-schema", action="store_true")
    parser.add_argument("--skip-existing-archive", action="store_true")
    parser.add_argument("--skip-existing-frame-read", action="store_true")
    parser.add_argument("--start-date", default="")
    parser.add_argument("--downsample-large-frames", type=int, default=0)
    parser.add_argument(
        "--direct-frame-only",
        action="store_true",
        help="Skip schema/archive checks and write selected downsampled frames directly.",
    )
    parser.add_argument(
        "--psql-direct-write",
        action="store_true",
        help="Use the local psql client for direct downsampled frame writes.",
    )
    args = parser.parse_args()

    if args.max_new_frames < 0:
        raise RuntimeError("--max-new-frames must be >= 0")

    load_local_environment()
    manifest_path = (REPO_ROOT / args.manifest).resolve()
    if not manifest_path.exists():
        manifest_path = Path(args.manifest).resolve()

    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_manifest(payload, manifest_path)

    if args.direct_frame_only:
        if args.downsample_large_frames <= 1:
            raise RuntimeError("--direct-frame-only requires --downsample-large-frames > 1")
        frames_to_import = select_frames_for_import(payload, set(), args.start_date, args.max_new_frames)
        if args.psql_direct_write:
            imported_frames = import_downsampled_frames_batch_via_psql(
                payload,
                frames_to_import,
                args.downsample_large_frames,
            )
        else:
            imported_frames = import_downsampled_frames_batch(
                payload,
                frames_to_import,
                args.downsample_large_frames,
            )
        print_import_summary(manifest_path, payload, imported_frames)
        return

    connection = connect_with_retries("initial import connection")
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            if not args.skip_schema:
                apply_carbon_schema(cursor)
            apply_chunk_schema(cursor)
            if args.skip_existing_archive and archive_already_imported(cursor, payload):
                print(
                    f"Skipping existing archive {payload['source']['officialId']}",
                    flush=True,
                )
            else:
                import_archive(cursor, payload)

            existing_frame_dates = set()
            if not args.skip_existing_frame_read:
                existing_frame_dates = read_existing_frame_dates(cursor, payload)
            frames_to_import = select_frames_for_import(
                payload,
                existing_frame_dates,
                args.start_date,
                args.max_new_frames,
            )

            if args.downsample_large_frames > 1 and frames_to_import:
                imported_frames = import_downsampled_frames_batch(
                    payload,
                    frames_to_import,
                    args.downsample_large_frames,
                )
            else:
                imported_frames = 0
                for frame in frames_to_import:
                    frame_completed = import_frame(cursor, payload, frame, args.downsample_large_frames)
                    if frame_completed:
                        imported_frames += 1
    finally:
        connection.close()

    print_import_summary(manifest_path, payload, imported_frames)


def select_frames_for_import(
    payload: dict[str, Any],
    existing_frame_dates: set[str],
    start_date: str,
    max_new_frames: int,
) -> list[dict[str, Any]]:
    frames_to_import = []
    for frame in payload["frames"]:
        if start_date and frame["date"] < start_date:
            print(f"Skipping before start date {payload['sector']} / {frame['date']}", flush=True)
            continue
        if frame["date"] in existing_frame_dates:
            print(f"Skipping existing {payload['sector']} / {frame['date']}", flush=True)
            continue
        frames_to_import.append(frame)
        if max_new_frames > 0 and len(frames_to_import) >= max_new_frames:
            break
    return frames_to_import


def print_import_summary(manifest_path: Path, payload: dict[str, Any], imported_frames: int) -> None:
    print(
        json.dumps(
            {
                "ok": True,
                "manifest": manifest_path.relative_to(WORKSPACE_ROOT).as_posix(),
                "sector": payload["sector"],
                "month": payload["month"],
                "frames": len(payload["frames"]),
                "importedFrames": imported_frames,
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


def connect():
    connection_string = os.environ.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    parsed = urlparse(connection_string)
    kwargs: dict[str, Any] = {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": parsed.path.lstrip("/"),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "connect_timeout": 10,
        "application_name": "carbon-graced-python-import",
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
    }
    if os.environ.get("DATABASE_SSL") == "true" and "sslmode=" not in connection_string:
        kwargs["sslmode"] = "require"
    return psycopg2.connect(**kwargs)


def connect_with_retries(label: str):
    last_error: Exception | None = None
    for attempt in range(1, DB_RETRY_ATTEMPTS + 1):
        try:
            return connect()
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            last_error = error
            if attempt == DB_RETRY_ATTEMPTS:
                raise
            print(
                f"{label} retry {attempt}/{DB_RETRY_ATTEMPTS}: {format_db_error(error)}",
                flush=True,
            )
            time.sleep(DB_RETRY_SLEEP_SECONDS)
    raise RuntimeError(f"{label} failed: {last_error}")


def apply_carbon_schema(cursor) -> None:
    full_schema = SCHEMA_PATH.read_text(encoding="utf-8")
    marker = "CREATE TABLE IF NOT EXISTS website_data.carbon_source_archives"
    start = full_schema.find(marker)
    if start < 0:
        raise RuntimeError("Carbon database schema was not found.")
    for statement in [item.strip() for item in full_schema[start:].split(";") if item.strip()]:
        cursor.execute(statement)


def apply_chunk_schema(cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS website_data.carbon_emission_frame_chunks (
          observed_on date NOT NULL,
          sector text NOT NULL,
          chunk_index integer NOT NULL CHECK (chunk_index >= 0),
          chunk_data bytea NOT NULL,
          imported_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (observed_on, sector, chunk_index)
        )
        """
    )


def import_archive(cursor, payload: dict[str, Any]) -> None:
    source = payload["source"]
    cursor.execute(
        """
        INSERT INTO website_data.carbon_source_archives (
          official_id, sector, data_month, file_name, file_size_label, source_url,
          api_updated_at, archive_sha256, local_archive_path, local_netcdf_path,
          source_attributes, imported_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,now())
        ON CONFLICT (official_id) DO UPDATE SET
          sector=EXCLUDED.sector,
          data_month=EXCLUDED.data_month,
          file_name=EXCLUDED.file_name,
          file_size_label=EXCLUDED.file_size_label,
          source_url=EXCLUDED.source_url,
          api_updated_at=EXCLUDED.api_updated_at,
          archive_sha256=EXCLUDED.archive_sha256,
          local_archive_path=EXCLUDED.local_archive_path,
          local_netcdf_path=EXCLUDED.local_netcdf_path,
          source_attributes=EXCLUDED.source_attributes,
          imported_at=now()
        """,
        (
            source["officialId"],
            payload["sector"],
            f"{payload['month']}-01",
            source["fileName"],
            source.get("fileSizeLabel"),
            source["url"],
            parse_api_timestamp(source.get("apiUpdatedAt")),
            source["archiveSha256"],
            source["localArchivePath"],
            source["localNetcdfPath"],
            json.dumps(source.get("attributes") or {}),
        ),
    )


def archive_already_imported(cursor, payload: dict[str, Any]) -> bool:
    cursor.execute(
        """
        SELECT 1
          FROM website_data.carbon_source_archives
         WHERE official_id = %s
         LIMIT 1
        """,
        (payload["source"]["officialId"],),
    )
    return cursor.fetchone() is not None


def frame_already_imported(cursor, sector: str, observed_on: str) -> bool:
    cursor.execute(
        """
        SELECT 1
          FROM website_data.carbon_emission_frames
         WHERE sector = %s
           AND observed_on = %s
         LIMIT 1
        """,
        (sector, observed_on),
    )
    return cursor.fetchone() is not None


def read_existing_frame_dates(cursor, payload: dict[str, Any]) -> set[str]:
    rows = execute_fetchall_with_short_connection(
        """
        SELECT observed_on::text
          FROM website_data.carbon_emission_frames
         WHERE sector = %s
           AND observed_on >= %s::date
           AND observed_on < (%s::date + interval '1 month')
        """,
        (payload["sector"], f"{payload['month']}-01", f"{payload['month']}-01"),
    )
    return {str(row[0]) for row in rows}


def import_frame(cursor, payload: dict[str, Any], frame: dict[str, Any], downsample_large_frames: int = 0) -> bool:
    frame_path = (WORKSPACE_ROOT / frame["path"]).resolve()
    assert_within_workspace(frame_path)
    frame_data = frame_path.read_bytes()
    if len(frame_data) != frame["sizeBytes"]:
        raise RuntimeError(f"Frame size mismatch for {frame['path']}.")
    use_chunks = len(frame_data) > CHUNK_THRESHOLD_BYTES
    storage_note = "inline"
    effective_grid = dict(payload["grid"])
    effective_stats = dict(frame["stats"])
    effective_sha256 = frame["sha256"]
    if use_chunks and downsample_large_frames > 1:
        frame_data, effective_grid, effective_stats, effective_sha256 = downsample_gzip_frame(
            frame_data,
            payload["grid"],
            downsample_large_frames,
        )
        use_chunks = False
        storage_note = f"downsampled-{downsample_large_frames}x"
    elif use_chunks:
        storage_note = "chunks"
    stored_frame_data = b"" if use_chunks else frame_data

    grid = effective_grid
    encoding = payload["encoding"]
    stats = effective_stats
    if use_chunks:
        chunks_complete = replace_frame_chunks(cursor, payload["sector"], frame["date"], frame_data)
        if not chunks_complete:
            return False

    metadata_statement = """
        INSERT INTO website_data.carbon_emission_frames (
          observed_on, sector, source_archive_id, unit, width, height,
          longitude_min, latitude_max, dx, dy, data_type, byte_order,
          compression, frame_data, frame_sha256, min_value, max_value,
          mean_value, sum_kgc_per_hour, nonzero_count, statistics, imported_at
        ) VALUES (
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,now()
        )
        ON CONFLICT (observed_on, sector) DO UPDATE SET
          source_archive_id=EXCLUDED.source_archive_id,
          unit=EXCLUDED.unit,
          width=EXCLUDED.width,
          height=EXCLUDED.height,
          longitude_min=EXCLUDED.longitude_min,
          latitude_max=EXCLUDED.latitude_max,
          dx=EXCLUDED.dx,
          dy=EXCLUDED.dy,
          data_type=EXCLUDED.data_type,
          byte_order=EXCLUDED.byte_order,
          compression=EXCLUDED.compression,
          frame_data=EXCLUDED.frame_data,
          frame_sha256=EXCLUDED.frame_sha256,
          min_value=EXCLUDED.min_value,
          max_value=EXCLUDED.max_value,
          mean_value=EXCLUDED.mean_value,
          sum_kgc_per_hour=EXCLUDED.sum_kgc_per_hour,
          nonzero_count=EXCLUDED.nonzero_count,
          statistics=EXCLUDED.statistics,
          imported_at=now()
        """
    metadata_params = (
        frame["date"],
        payload["sector"],
        payload["source"]["officialId"],
        payload["unit"],
        grid["width"],
        grid["height"],
        grid["longitudeMin"],
        grid["latitudeMax"],
        grid["dx"],
        grid["dy"],
        encoding["dtype"],
        encoding["byteOrder"],
        encoding["compression"],
        psycopg2.Binary(stored_frame_data),
        effective_sha256,
        stats["min"],
        stats["max"],
        stats["mean"],
        stats["sumKgCPerHour"],
        stats["nonzeroCount"],
        json.dumps(stats),
    )
    if use_chunks:
        execute_with_short_connection(metadata_statement, metadata_params)
    elif storage_note.startswith("downsampled-"):
        execute_with_short_connection(metadata_statement, metadata_params)
    else:
        cursor.execute(metadata_statement, metadata_params)
    print(
        f"Imported {payload['sector']} / {frame['date']} ({len(frame_data) / 1024:.1f} KiB, storage={storage_note})",
        flush=True,
    )
    return True


def import_downsampled_frames_batch(
    payload: dict[str, Any],
    frames: list[dict[str, Any]],
    downsample_large_frames: int,
) -> int:
    rows = []
    frame_logs = []
    for frame in frames:
        row, storage_note, stored_size = build_inline_frame_row(payload, frame, downsample_large_frames)
        rows.append(row)
        frame_logs.append((frame["date"], storage_note, stored_size))

    if not rows:
        return 0

    statement = """
        INSERT INTO website_data.carbon_emission_frames (
          observed_on, sector, source_archive_id, unit, width, height,
          longitude_min, latitude_max, dx, dy, data_type, byte_order,
          compression, frame_data, frame_sha256, min_value, max_value,
          mean_value, sum_kgc_per_hour, nonzero_count, statistics, imported_at
        ) VALUES %s
        ON CONFLICT (observed_on, sector) DO UPDATE SET
          source_archive_id=EXCLUDED.source_archive_id,
          unit=EXCLUDED.unit,
          width=EXCLUDED.width,
          height=EXCLUDED.height,
          longitude_min=EXCLUDED.longitude_min,
          latitude_max=EXCLUDED.latitude_max,
          dx=EXCLUDED.dx,
          dy=EXCLUDED.dy,
          data_type=EXCLUDED.data_type,
          byte_order=EXCLUDED.byte_order,
          compression=EXCLUDED.compression,
          frame_data=EXCLUDED.frame_data,
          frame_sha256=EXCLUDED.frame_sha256,
          min_value=EXCLUDED.min_value,
          max_value=EXCLUDED.max_value,
          mean_value=EXCLUDED.mean_value,
          sum_kgc_per_hour=EXCLUDED.sum_kgc_per_hour,
          nonzero_count=EXCLUDED.nonzero_count,
          statistics=EXCLUDED.statistics,
          imported_at=now()
        """
    template = """
        (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,now())
    """
    execute_values_with_short_connection(statement, rows, template)
    for observed_on, storage_note, stored_size in frame_logs:
        print(
            f"Imported {payload['sector']} / {observed_on} ({stored_size / 1024:.1f} KiB, storage={storage_note}, batch)",
            flush=True,
        )
    return len(rows)


def import_downsampled_frames_batch_via_psql(
    payload: dict[str, Any],
    frames: list[dict[str, Any]],
    downsample_large_frames: int,
) -> int:
    rows = []
    frame_logs = []
    for frame in frames:
        row, storage_note, stored_size = build_inline_frame_row(payload, frame, downsample_large_frames)
        rows.append(row)
        frame_logs.append((frame["date"], storage_note, stored_size))

    if not rows:
        return 0

    values_sql = ",\n".join(sql_frame_row(row) for row in rows)
    source = payload["source"]
    statement = f"""
BEGIN;
INSERT INTO website_data.carbon_source_archives (
  official_id, sector, data_month, file_name, file_size_label, source_url,
  api_updated_at, archive_sha256, local_archive_path, local_netcdf_path,
  source_attributes, imported_at
) VALUES (
  {sql_literal(source["officialId"])},
  {sql_literal(payload["sector"])},
  {sql_literal(f"{payload['month']}-01")},
  {sql_literal(source["fileName"])},
  {sql_literal(source.get("fileSizeLabel"))},
  {sql_literal(source["url"])},
  {sql_literal(parse_api_timestamp(source.get("apiUpdatedAt")))},
  {sql_literal(source["archiveSha256"])},
  {sql_literal(source["localArchivePath"])},
  {sql_literal(source["localNetcdfPath"])},
  {sql_literal(json.dumps(source.get("attributes") or {}))}::jsonb,
  now()
)
ON CONFLICT (official_id) DO UPDATE SET
  sector=EXCLUDED.sector,
  data_month=EXCLUDED.data_month,
  file_name=EXCLUDED.file_name,
  file_size_label=EXCLUDED.file_size_label,
  source_url=EXCLUDED.source_url,
  api_updated_at=EXCLUDED.api_updated_at,
  archive_sha256=EXCLUDED.archive_sha256,
  local_archive_path=EXCLUDED.local_archive_path,
  local_netcdf_path=EXCLUDED.local_netcdf_path,
  source_attributes=EXCLUDED.source_attributes,
  imported_at=now();
INSERT INTO website_data.carbon_emission_frames (
  observed_on, sector, source_archive_id, unit, width, height,
  longitude_min, latitude_max, dx, dy, data_type, byte_order,
  compression, frame_data, frame_sha256, min_value, max_value,
  mean_value, sum_kgc_per_hour, nonzero_count, statistics, imported_at
) VALUES
{values_sql}
ON CONFLICT (observed_on, sector) DO UPDATE SET
  source_archive_id=EXCLUDED.source_archive_id,
  unit=EXCLUDED.unit,
  width=EXCLUDED.width,
  height=EXCLUDED.height,
  longitude_min=EXCLUDED.longitude_min,
  latitude_max=EXCLUDED.latitude_max,
  dx=EXCLUDED.dx,
  dy=EXCLUDED.dy,
  data_type=EXCLUDED.data_type,
  byte_order=EXCLUDED.byte_order,
  compression=EXCLUDED.compression,
  frame_data=EXCLUDED.frame_data,
  frame_sha256=EXCLUDED.frame_sha256,
  min_value=EXCLUDED.min_value,
  max_value=EXCLUDED.max_value,
  mean_value=EXCLUDED.mean_value,
  sum_kgc_per_hour=EXCLUDED.sum_kgc_per_hour,
  nonzero_count=EXCLUDED.nonzero_count,
  statistics=EXCLUDED.statistics,
  imported_at=now();
COMMIT;
"""
    run_psql_statement(statement)
    for observed_on, storage_note, stored_size in frame_logs:
        print(
            f"Imported {payload['sector']} / {observed_on} ({stored_size / 1024:.1f} KiB, storage={storage_note}, psql)",
            flush=True,
        )
    return len(rows)


def sql_frame_row(row: tuple[Any, ...]) -> str:
    values = []
    for index, value in enumerate(row):
        if index == 13:
            raw = value.adapted if hasattr(value, "adapted") else bytes(value)
            values.append(f"decode('{raw.hex()}','hex')")
        elif index == 20:
            values.append(f"{sql_literal(value)}::jsonb")
        else:
            values.append(sql_literal(value))
    values.append("now()")
    return "(" + ",".join(values) + ")"


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def run_psql_statement(statement: str) -> None:
    connection_string = os.environ.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    parsed = urlparse(connection_string)
    env = os.environ.copy()
    env["PGHOST"] = parsed.hostname or ""
    env["PGPORT"] = str(parsed.port or 5432)
    env["PGDATABASE"] = parsed.path.lstrip("/")
    env["PGUSER"] = unquote(parsed.username or "")
    env["PGPASSWORD"] = unquote(parsed.password or "")
    env["PGCONNECT_TIMEOUT"] = "30"

    psql = os.environ.get("PSQL") or shutil.which("psql") or r"C:\Program Files\PostgreSQL\17\bin\psql.exe"
    sql_path = REPO_ROOT / "carbon-psql-direct-last.sql"
    sql_path.write_text(statement, encoding="utf-8")
    result = subprocess.run(
        [psql, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=180,
    )
    if result.stdout.strip():
        print(result.stdout.strip(), flush=True)
    if result.returncode != 0:
        if result.stderr.strip():
            print(result.stderr.strip(), flush=True)
        raise RuntimeError(f"psql direct write failed with exit {result.returncode}")


def build_inline_frame_row(
    payload: dict[str, Any],
    frame: dict[str, Any],
    downsample_large_frames: int,
) -> tuple[tuple[Any, ...], str, int]:
    frame_path = (WORKSPACE_ROOT / frame["path"]).resolve()
    assert_within_workspace(frame_path)
    frame_data = frame_path.read_bytes()
    if len(frame_data) != frame["sizeBytes"]:
        raise RuntimeError(f"Frame size mismatch for {frame['path']}.")

    use_chunks = len(frame_data) > CHUNK_THRESHOLD_BYTES
    storage_note = "inline"
    effective_grid = dict(payload["grid"])
    effective_stats = dict(frame["stats"])
    effective_sha256 = frame["sha256"]
    if use_chunks and downsample_large_frames > 1:
        frame_data, effective_grid, effective_stats, effective_sha256 = downsample_gzip_frame(
            frame_data,
            payload["grid"],
            downsample_large_frames,
        )
        storage_note = f"downsampled-{downsample_large_frames}x"
    elif use_chunks:
        raise RuntimeError("Batch import requires inline/downsampled frames.")

    grid = effective_grid
    encoding = payload["encoding"]
    stats = effective_stats
    return (
        (
            frame["date"],
            payload["sector"],
            payload["source"]["officialId"],
            payload["unit"],
            grid["width"],
            grid["height"],
            grid["longitudeMin"],
            grid["latitudeMax"],
            grid["dx"],
            grid["dy"],
            encoding["dtype"],
            encoding["byteOrder"],
            encoding["compression"],
            psycopg2.Binary(frame_data),
            effective_sha256,
            stats["min"],
            stats["max"],
            stats["mean"],
            stats["sumKgCPerHour"],
            stats["nonzeroCount"],
            json.dumps(stats),
        ),
        storage_note,
        len(frame_data),
    )


def downsample_gzip_frame(frame_data: bytes, grid: dict[str, Any], factor: int):
    width = int(grid["width"])
    height = int(grid["height"])
    values = np.frombuffer(gzip.decompress(frame_data), dtype="<f4")
    if values.size != width * height:
        raise RuntimeError(f"Decoded frame size mismatch: {values.size}/{width * height}.")

    matrix = values.reshape((height, width))
    target_height = height // factor
    target_width = width // factor
    cropped = matrix[: target_height * factor, : target_width * factor]
    downsampled = cropped.reshape(target_height, factor, target_width, factor).sum(axis=(1, 3)).astype("<f4")
    encoded = gzip.compress(downsampled.tobytes(order="C"), compresslevel=6)
    flat = downsampled.reshape(-1)
    nonzero = flat[flat > 0]
    if nonzero.size:
        min_value = float(nonzero.min())
        max_value = float(nonzero.max())
        percentiles = {
            "p50": float(np.percentile(nonzero, 50)),
            "p90": float(np.percentile(nonzero, 90)),
            "p95": float(np.percentile(nonzero, 95)),
            "p99": float(np.percentile(nonzero, 99)),
            "p999": float(np.percentile(nonzero, 99.9)),
        }
    else:
        min_value = 0.0
        max_value = 0.0
        percentiles = {"p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0, "p999": 0.0}

    stats = {
        "min": min_value,
        "max": max_value,
        "mean": float(flat.mean()),
        "sumKgCPerHour": float(flat.sum(dtype=np.float64)),
        "nonzeroCount": int(nonzero.size),
        "nonzeroPercent": float((nonzero.size / flat.size) * 100),
        **percentiles,
        "downsampleFactor": factor,
        "sourceWidth": width,
        "sourceHeight": height,
    }
    effective_grid = {
        **grid,
        "width": target_width,
        "height": target_height,
        "dx": float(grid["dx"]) * factor,
        "dy": float(grid["dy"]) * factor,
        "sourceResolutionDeg": grid.get("sourceResolutionDeg", grid["dx"]),
        "aggregationFactor": factor,
        "aggregationMethod": "sum",
    }
    return encoded, effective_grid, stats, hashlib.sha256(encoded).hexdigest()


def replace_frame_chunks(cursor, sector: str, observed_on: str, frame_data: bytes) -> bool:
    chunk_offsets = list(range(0, len(frame_data), CHUNK_SIZE_BYTES))
    cursor.connection.close()
    rows = execute_fetchall_with_short_connection(
        """
        SELECT chunk_index, octet_length(chunk_data) AS chunk_size
          FROM website_data.carbon_emission_frame_chunks
         WHERE observed_on = %s
           AND sector = %s
        """,
        (observed_on, sector),
    )
    existing_chunks = {
        row[0]
        for row in rows
        if 0 <= int(row[0]) < len(chunk_offsets)
        and int(row[1]) == min(CHUNK_SIZE_BYTES, len(frame_data) - chunk_offsets[int(row[0])])
    }
    missing_rows = [
        (
            observed_on,
            sector,
            chunk_index,
            psycopg2.Binary(frame_data[offset : offset + CHUNK_SIZE_BYTES]),
        )
        for chunk_index, offset in enumerate(chunk_offsets)
        if chunk_index not in existing_chunks
    ]
    if missing_rows:
        execute_values_with_short_connection(
            """
            INSERT INTO website_data.carbon_emission_frame_chunks (
              observed_on, sector, chunk_index, chunk_data, imported_at
            ) VALUES %s
            ON CONFLICT (observed_on, sector, chunk_index) DO UPDATE SET
              chunk_data=EXCLUDED.chunk_data,
              imported_at=now()
            """,
            missing_rows,
            "(%s,%s,%s,%s,now())",
        )
    print(
        f"Chunked {sector} / {observed_on}: {len(chunk_offsets)}/{len(chunk_offsets)} "
        f"({len(existing_chunks)} existing, {len(missing_rows)} written)",
        flush=True,
    )
    # Only report completion after every chunk has been verified or inserted.
    return True


def execute_with_short_connection(statement: str, params: tuple[Any, ...]) -> None:
    for attempt in range(1, DB_RETRY_ATTEMPTS + 1):
        connection = None
        try:
            connection = connect()
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute(statement, params)
            return
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            if attempt == DB_RETRY_ATTEMPTS:
                raise
            print(
                f"DB write retry {attempt}/{DB_RETRY_ATTEMPTS}: {format_db_error(error)}",
                flush=True,
            )
            time.sleep(DB_RETRY_SLEEP_SECONDS)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


def execute_values_with_short_connection(
    statement: str,
    rows: list[tuple[Any, ...]],
    template: str,
) -> None:
    for attempt in range(1, DB_RETRY_ATTEMPTS + 1):
        connection = None
        try:
            connection = connect()
            connection.autocommit = True
            with connection.cursor() as cursor:
                psycopg2.extras.execute_values(
                    cursor,
                    statement,
                    rows,
                    template=template,
                    page_size=len(rows),
                )
            return
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            if attempt == DB_RETRY_ATTEMPTS:
                raise
            print(
                f"DB batch write retry {attempt}/{DB_RETRY_ATTEMPTS}: {format_db_error(error)}",
                flush=True,
            )
            time.sleep(DB_RETRY_SLEEP_SECONDS)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


def execute_fetchall_with_short_connection(statement: str, params: tuple[Any, ...]):
    for attempt in range(1, DB_RETRY_ATTEMPTS + 1):
        connection = None
        try:
            connection = connect()
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute(statement, params)
                return cursor.fetchall()
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            if attempt == DB_RETRY_ATTEMPTS:
                raise
            print(
                f"DB read retry {attempt}/{DB_RETRY_ATTEMPTS}: {format_db_error(error)}",
                flush=True,
            )
            time.sleep(DB_RETRY_SLEEP_SECONDS)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


def format_db_error(error: Exception) -> str:
    lines = str(error).splitlines()
    first_line = lines[0] if lines else ""
    if first_line:
        return f"{error.__class__.__name__}: {first_line}"
    return error.__class__.__name__


def validate_manifest(payload: dict[str, Any], manifest_path: Path) -> None:
    if (
        payload.get("formatVersion") != 1
        or not isinstance(payload.get("sector"), str)
        or not isinstance(payload.get("month"), str)
        or not isinstance(payload.get("frames"), list)
        or not payload["frames"]
        or not payload.get("source", {}).get("officialId")
    ):
        raise RuntimeError(f"Invalid carbon manifest: {manifest_path}")


def parse_api_timestamp(value: str | None) -> str | None:
    if not value:
        return None
    normalized = str(value).replace(" ", "T")
    try:
        return datetime.fromisoformat(normalized).isoformat()
    except ValueError:
        return None


def assert_within_workspace(file_path: Path) -> None:
    file_path.relative_to(WORKSPACE_ROOT)


def load_local_environment() -> None:
    env_path = REPO_ROOT / ".env.local"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


if __name__ == "__main__":
    main()
