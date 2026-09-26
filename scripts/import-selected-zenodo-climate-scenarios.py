#!/usr/bin/env python3
"""Import the selected Zenodo climate scenarios one verified file at a time."""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

import psycopg2
from dotenv import dotenv_values


VARIABLE_PRIORITY = {"rsds": 0, "sfcwind": 1, "tas": 2, "huss": 3, "ps": 4}


def ensure_normal_priority() -> None:
    if os.name != "nt":
        return
    normal_priority_class = 0x00000020
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.SetPriorityClass.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
    kernel32.SetPriorityClass.restype = ctypes.c_bool
    process = kernel32.GetCurrentProcess()
    if not kernel32.SetPriorityClass(process, normal_priority_class):
        raise ctypes.WinError()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--scratch-dir", type=Path, required=True)
    parser.add_argument("--state-path", type=Path, required=True)
    parser.add_argument("--max-retries", type=int, default=2)
    return parser.parse_args()


def load_database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    return str(connection_string), str(values.get("DATABASE_SSL", "")).lower() == "true"


def connect(connection_string: str, ssl_enabled: bool) -> Any:
    return psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
        connect_timeout=20,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updatedAt"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    pending = path.with_name(f"{path.name}.pending")
    pending.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    pending.replace(path)


def read_state(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def source_status(connection: Any, file_name: str) -> tuple[int, str, int, str | None]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, import_status, imported_days, error
            FROM website_data.climate_projection_sources
            WHERE file_name=%s
            """,
            (file_name,),
        )
        row = cursor.fetchone()
    if row is None:
        raise RuntimeError(f"Climate source is not registered: {file_name}")
    return int(row[0]), str(row[1]), int(row[2] or 0), row[3]


def missing_day(connection: Any, file_name: str) -> tuple[int, int]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, period_start, period_end
            FROM website_data.climate_projection_sources
            WHERE file_name=%s
            """,
            (file_name,),
        )
        source = cursor.fetchone()
        if source is None:
            raise RuntimeError(f"Climate source is not registered: {file_name}")
        source_id, period_start, period_end = source
        expected_days = (period_end - period_start).days + 1
        cursor.execute(
            """
            SELECT min((expected.day::date - %s::date)::int)
            FROM generate_series(%s::date,%s::date,'1 day'::interval) expected(day)
            LEFT JOIN website_data.climate_projection_daily actual
              ON actual.source_id=%s AND actual.valid_date=expected.day::date
            WHERE actual.valid_date IS NULL
            """,
            (period_start, period_start, period_end, source_id),
        )
        missing = cursor.fetchone()[0]
    return expected_days if missing is None else int(missing), expected_days


def run_stream(command: list[str], cwd: Path) -> int:
    print("$ " + " ".join(command), flush=True)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
    return process.wait()


def main() -> int:
    ensure_normal_priority()
    args = parse_args()
    if args.max_retries < 0:
        raise RuntimeError("--max-retries must be zero or greater")
    repo_root = Path(__file__).resolve().parents[1]
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    files = list(manifest.get("climate_netcdf_files", []))
    if len(files) != 60:
        raise RuntimeError(f"Expected 60 NetCDF files in manifest, got {len(files)}")
    files.sort(
        key=lambda item: (
            VARIABLE_PRIORITY.get(str(item["variable"]).lower(), 99),
            str(item["scenario"]),
            str(item["period_start"]),
            str(item["filename"]),
        )
    )
    importer = repo_root / "scripts" / "import-zenodo-climate-projection.py"
    verifier = repo_root / "scripts" / "finalize-climate-import.py"
    connection_string, ssl_enabled = load_database_config(repo_root)
    state = read_state(args.state_path) or {
        "status": "starting",
        "phase": "importing",
        "totalFiles": len(files),
        "completed": [],
        "failed": [],
        "current": None,
    }
    completed = {str(item.get("file")): item for item in state.get("completed", [])}
    state["status"] = "running"
    state["phase"] = "importing"
    state["totalFiles"] = len(files)
    state["totalBytes"] = sum(int(item["bytes"]) for item in files)
    state["completed"] = list(completed.values())
    state["failed"] = []
    write_state(args.state_path, state)

    for index, item in enumerate(files, start=1):
        file_name = str(item["filename"])
        connection = connect(connection_string, ssl_enabled)
        try:
            source_id, status, imported_days, error = source_status(connection, file_name)
            resume_day, expected_days = missing_day(connection, file_name)
        finally:
            connection.close()
        if status == "imported" and resume_day == expected_days:
            completed[file_name] = {
                "file": file_name,
                "recordId": int(item["record_id"]),
                "days": expected_days,
                "skipped": True,
                "verifiedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            }
            state["completed"] = list(completed.values())
            state["current"] = None
            write_state(args.state_path, state)
            print(f"[{index}/{len(files)}] already imported: {file_name}", flush=True)
            continue

        state["current"] = {
            "index": index,
            "file": file_name,
            "recordId": int(item["record_id"]),
            "resumeDay": resume_day,
            "expectedDays": expected_days,
            "phase": "importing",
        }
        write_state(args.state_path, state)
        succeeded = False
        last_error = None
        for attempt in range(args.max_retries + 1):
            connection = connect(connection_string, ssl_enabled)
            try:
                resume_day, expected_days = missing_day(connection, file_name)
            finally:
                connection.close()
            if resume_day == expected_days:
                exit_code = 0
            else:
                command = [
                    sys.executable,
                    str(importer),
                    "--record-id",
                    str(item["record_id"]),
                    "--file",
                    file_name,
                    "--scratch-dir",
                    str(args.scratch_dir),
                    "--keep-netcdf",
                ]
                if resume_day > 0:
                    command.extend(["--start-day", str(resume_day)])
                exit_code = run_stream(command, repo_root)
            if exit_code == 0:
                exit_code = run_stream(
                    [sys.executable, str(verifier), "--file", file_name],
                    repo_root,
                )
            if exit_code == 0:
                succeeded = True
                break
            last_error = f"attempt {attempt + 1} exited with code {exit_code}"
            if attempt < args.max_retries:
                print(f"{last_error}; retrying in 30 seconds", flush=True)
                time.sleep(30)
        if not succeeded:
            state["status"] = "failed"
            state["failed"] = [{"file": file_name, "error": last_error}]
            state["current"] = {**state["current"], "phase": "failed", "error": last_error}
            write_state(args.state_path, state)
            raise RuntimeError(f"Stopped on failed climate file: {file_name}; {last_error}")

        completed[file_name] = {
            "file": file_name,
            "recordId": int(item["record_id"]),
            "days": expected_days,
            "verifiedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        }
        state["completed"] = list(completed.values())
        state["current"] = None
        write_state(args.state_path, state)
        print(f"[{index}/{len(files)}] imported and verified: {file_name}", flush=True)

    state["status"] = "complete"
    state["phase"] = "complete"
    state["finishedAt"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    state["current"] = None
    write_state(args.state_path, state)
    print(json.dumps({"ok": True, "files": len(files), "completed": len(completed)}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
