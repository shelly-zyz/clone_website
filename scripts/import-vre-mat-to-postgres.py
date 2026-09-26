#!/usr/bin/env python3
"""Import verified paper VRE MATLAB files into the scenario-aware PostgreSQL table.

The server already keeps the original MAT files and their official MD5 values.
This importer reads them in one year at a time, aggregates the same China and
province regions as the website builder, and writes one hourly capacity-factor
row per (GCM, SSP, region, year, technology).  It is restartable: each file is
upserted and its source status is updated only after all rows validate.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import psycopg2
from psycopg2.extras import Json, execute_values


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_builder(path: Path):
    spec = importlib.util.spec_from_file_location("climate_vre_builder", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load builder module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_state(path: Path, state: dict[str, Any]) -> None:
    state["updatedAt"] = utc_now()
    pending = path.with_name(path.name + ".pending")
    pending.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(pending, path)


def md5sum(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    return [item for item in payload.get("files", []) if item.get("kind") == "vre_mat"]


def ensure_schema(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS website_data.climate_vre_sources (
              gcm text NOT NULL,
              scenario text NOT NULL,
              file_name text NOT NULL UNIQUE,
              source_path text NOT NULL,
              expected_size_bytes bigint NOT NULL,
              md5 text NOT NULL,
              period_start date NOT NULL,
              period_end date NOT NULL,
              download_status text NOT NULL DEFAULT 'verified',
              import_status text NOT NULL DEFAULT 'pending',
              imported_rows integer NOT NULL DEFAULT 0,
              source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
              error text,
              imported_at timestamptz,
              updated_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (gcm, scenario)
            )
            """
        )
        cursor.execute(
            """
            ALTER TABLE website_data.climate_vre_hourly
              ADD COLUMN IF NOT EXISTS gcm text,
              ADD COLUMN IF NOT EXISTS scenario text
            """
        )
        cursor.execute(
            """
            UPDATE website_data.climate_vre_hourly
            SET gcm=COALESCE(NULLIF(gcm,''),NULLIF(metadata->>'gcm',''),'gfdl-esm4'),
                scenario=COALESCE(NULLIF(scenario,''),NULLIF(metadata->>'scenario',''),'ssp126')
            WHERE gcm IS NULL OR scenario IS NULL OR gcm='' OR scenario=''
            """
        )
        cursor.execute("ALTER TABLE website_data.climate_vre_hourly ALTER COLUMN gcm SET NOT NULL")
        cursor.execute("ALTER TABLE website_data.climate_vre_hourly ALTER COLUMN scenario SET NOT NULL")
        cursor.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid='website_data.climate_vre_hourly'::regclass
                  AND conname='climate_vre_hourly_model_scenario_pkey'
              ) THEN
                IF EXISTS (
                  SELECT 1 FROM pg_constraint
                  WHERE conrelid='website_data.climate_vre_hourly'::regclass AND contype='p'
                ) THEN
                  EXECUTE 'ALTER TABLE website_data.climate_vre_hourly DROP CONSTRAINT ' ||
                    quote_ident((SELECT conname FROM pg_constraint
                      WHERE conrelid='website_data.climate_vre_hourly'::regclass
                        AND contype='p' LIMIT 1));
                END IF;
                ALTER TABLE website_data.climate_vre_hourly
                  ADD CONSTRAINT climate_vre_hourly_model_scenario_pkey
                  PRIMARY KEY (gcm, scenario, region_id, year, technology);
              END IF;
            END
            $$
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS climate_vre_hourly_model_scenario_idx
              ON website_data.climate_vre_hourly (gcm, scenario, year, technology)
            """
        )
    connection.commit()


def upsert_source(connection: Any, item: dict[str, Any], source_path: Path) -> None:
    filename = str(item["filename"])
    gcm = str(item["gcm"]).lower()
    scenario = str(item["scenario"]).lower()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO website_data.climate_vre_sources (
              gcm, scenario, file_name, source_path, expected_size_bytes, md5,
              period_start, period_end, download_status, import_status, source_attributes
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'verified','importing',%s)
            ON CONFLICT (gcm, scenario) DO UPDATE SET
              file_name=EXCLUDED.file_name, source_path=EXCLUDED.source_path,
              expected_size_bytes=EXCLUDED.expected_size_bytes, md5=EXCLUDED.md5,
              download_status='verified', import_status='importing', error=NULL,
              source_attributes=EXCLUDED.source_attributes, updated_at=now()
            """,
            (
                gcm,
                scenario,
                filename,
                str(source_path),
                int(item["bytes"]),
                str(item["checksum"]).removeprefix("md5:"),
                "2021-01-01",
                "2060-12-31",
                Json(
                    {
                        "kind": "vre_mat",
                        "recordId": int(item["record_id"]),
                        "requestedRecordId": int(item.get("requested_record_id", item["record_id"])),
                        "zenodoUrl": f"https://zenodo.org/records/{item['record_id']}",
                        "truthStatus": "published-model-scenario-not-observation",
                        "unit": "capacity_factor",
                    }
                ),
            ),
        )
    connection.commit()


def set_source_status(connection: Any, item: dict[str, Any], status: str, rows: int, error: str | None = None) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE website_data.climate_vre_sources
            SET import_status=%s, imported_rows=%s, error=%s,
                imported_at=CASE WHEN %s='imported' THEN now() ELSE imported_at END,
                updated_at=now()
            WHERE gcm=%s AND scenario=%s
            """,
            (status, rows, error, status, str(item["gcm"]).lower(), str(item["scenario"]).lower()),
        )
    connection.commit()


def import_one(
    connection: Any,
    item: dict[str, Any],
    source_path: Path,
    builder: Any,
    state: dict[str, Any],
    state_path: Path,
) -> int:
    if not source_path.exists():
        raise RuntimeError(f"MAT file is missing: {source_path}")
    expected_size = int(item["bytes"])
    if source_path.stat().st_size != expected_size:
        raise RuntimeError(f"size mismatch for {source_path.name}: expected {expected_size}, got {source_path.stat().st_size}")
    gcm = str(item["gcm"]).lower()
    scenario = str(item["scenario"]).lower()
    upsert_source(connection, item, source_path)
    provinces = builder.load_china_provinces(builder.ADMIN1_GEOJSON)
    imported_rows = 0
    with h5py.File(source_path, "r") as handle:
        builder.validate_file(handle)
        lon_lat = np.array(handle["lon_lat_of_VRE_output"][:], dtype=np.float64)
        regions, diagnostics = builder.assign_regions(lon_lat, provinces)
        capacities, capacity_diagnostics = builder.load_capacity_basis(provinces, regions)
        state["current"]["gridCount"] = int(lon_lat.shape[1])
        state["current"]["regionCount"] = len(regions)
        state["current"]["fallbackAssignments"] = len(diagnostics)
        state["current"]["capacityDiagnostics"] = capacity_diagnostics
        write_state(state_path, state)
        for technology, metadata in builder.TECHNOLOGIES.items():
            dataset = handle[metadata["dataset"]]
            for year, start, end in builder.year_slices():
                year_data = np.array(dataset[start:end, :], dtype=np.float32)
                rows: list[tuple[Any, ...]] = []
                for region in regions:
                    values = np.nanmean(year_data[:, region.grid_indices], axis=1)
                    capacity_mw = capacities.get(region.id, {}).get(technology, 0.0)
                    rows.append(
                        (
                            gcm,
                            scenario,
                            region.id,
                            year,
                            technology,
                            region.label,
                            float(capacity_mw),
                            10000.0,
                            int(end - start),
                            Json(builder.quantize_capacity_factor(values)),
                            Json(builder.summarize_hourly(values, year, capacity_mw)),
                            Json(
                                {
                                    "gcm": gcm,
                                    "scenario": scenario,
                                    "unit": "capacity_factor",
                                    "powerUnit": "mw",
                                    "energyUnit": "gwh",
                                    "capacityBasis": builder.CAPACITY_BASIS,
                                    "capacityBasisLabel": builder.CAPACITY_BASIS_LABEL,
                                    "source": {
                                        "input": str(source_path),
                                        "paper": builder.PAPER_URL,
                                        "zenodo": f"https://zenodo.org/records/{item['record_id']}",
                                    },
                                }
                            ),
                        )
                    )
                with connection.cursor() as cursor:
                    execute_values(
                        cursor,
                        """
                        INSERT INTO website_data.climate_vre_hourly (
                          gcm, scenario, region_id, year, technology, region_label,
                          capacity_mw, scale, hours, values_json, stats, metadata
                        ) VALUES %s
                        ON CONFLICT (gcm, scenario, region_id, year, technology) DO UPDATE SET
                          region_label=EXCLUDED.region_label,
                          capacity_mw=EXCLUDED.capacity_mw,
                          scale=EXCLUDED.scale,
                          hours=EXCLUDED.hours,
                          values_json=EXCLUDED.values_json,
                          stats=EXCLUDED.stats,
                          metadata=EXCLUDED.metadata
                        """,
                        rows,
                        template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        page_size=len(rows),
                    )
                connection.commit()
                imported_rows += len(rows)
                state["current"]["rowsImported"] = imported_rows
                state["current"]["year"] = year
                state["current"]["technology"] = technology
                write_state(state_path, state)
    set_source_status(connection, item, "imported", imported_rows)
    return imported_rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--code-root", type=Path, required=True)
    parser.add_argument("--state-path", type=Path, required=True)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--verify-md5", action="store_true")
    args = parser.parse_args()
    args.root = args.root.resolve()
    args.code_root = args.code_root.resolve()
    args.state_path = args.state_path.resolve()
    if not args.database_url:
        raise RuntimeError("--database-url or DATABASE_URL is required")
    manifest_items = load_manifest(args.root / "download-manifest.json")
    if len(manifest_items) != 3:
        raise RuntimeError(f"Expected 3 VRE MAT manifest entries, got {len(manifest_items)}")
    builder = load_builder(args.code_root / "scripts" / "build-climate-vre-data.py")
    state: dict[str, Any] = {
        "status": "running",
        "phase": "importing_vre_mat",
        "root": str(args.root),
        "startedAt": utc_now(),
        "updatedAt": utc_now(),
        "files": [
            {"file": item["filename"], "gcm": item["gcm"], "scenario": item["scenario"], "bytes": int(item["bytes"]), "md5": str(item["checksum"]).removeprefix("md5:"), "status": "pending", "rowsImported": 0}
            for item in manifest_items
        ],
        "current": None,
        "failed": [],
        "totalRows": 0,
    }
    write_state(args.state_path, state)
    connection = psycopg2.connect(args.database_url, connect_timeout=30, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    try:
        ensure_schema(connection)
        for index, item in enumerate(manifest_items):
            state["current"] = {"file": item["filename"], "scenario": item["scenario"], "status": "importing", "rowsImported": 0}
            state["files"][index]["status"] = "importing"
            write_state(args.state_path, state)
            source_path = args.root / item["filename"]
            if args.verify_md5:
                actual = md5sum(source_path)
                expected = str(item["checksum"]).removeprefix("md5:")
                if actual != expected:
                    raise RuntimeError(f"MD5 mismatch for {source_path.name}: expected {expected}, got {actual}")
            try:
                rows = import_one(connection, item, source_path, builder, state, args.state_path)
                state["files"][index]["status"] = "imported"
                state["files"][index]["rowsImported"] = rows
                state["totalRows"] += rows
                state["current"] = None
                write_state(args.state_path, state)
            except Exception as error:
                connection.rollback()
                set_source_status(connection, item, "failed", int(state["files"][index].get("rowsImported", 0)), str(error))
                state["files"][index]["status"] = "failed"
                state["files"][index]["error"] = str(error)
                state["failed"].append({"file": item["filename"], "error": str(error)})
                state["status"] = "failed"
                state["current"] = None
                write_state(args.state_path, state)
                raise
        state["status"] = "complete"
        state["phase"] = "complete"
        state["finishedAt"] = utc_now()
        state["current"] = None
        write_state(args.state_path, state)
        print(json.dumps({"ok": True, "status": state["status"], "totalRows": state["totalRows"], "files": state["files"]}, ensure_ascii=False, indent=2))
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
