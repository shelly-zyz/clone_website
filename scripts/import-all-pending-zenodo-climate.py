#!/usr/bin/env python3
"""Sequentially import pending Zenodo climate sources while retaining originals."""

from __future__ import annotations

import argparse
import ctypes
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import psycopg2
from dotenv import dotenv_values


VARIABLE_PRIORITY = {
    "rsds": 0,
    "sfcwind": 1,
    "tas": 2,
    "huss": 3,
    "ps": 4,
}


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
    parser = argparse.ArgumentParser(
        description="Import all pending Zenodo climate files one at a time.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=2,
        help="Retries per file after the first failed attempt.",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        help="Write all orchestrator and child-process output to this file.",
    )
    parser.add_argument(
        "--variables",
        help="Optional comma-separated variable allowlist, for example sfcwind,tas.",
    )
    parser.add_argument(
        "--checkpoint-days",
        type=int,
        default=155,
        help=(
            "Cleanly restart the single-file importer after this many successful "
            "days to avoid degraded long-lived RDS sessions."
        ),
    )
    return parser.parse_args()


def load_database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    ssl_enabled = str(values.get("DATABASE_SSL", "")).lower() == "true"
    return str(connection_string), ssl_enabled


def connect(connection_string: str, ssl_enabled: bool) -> Any:
    return psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
        connect_timeout=20,
    )


def pending_sources(
    connection: Any,
    variables: set[str] | None = None,
) -> list[tuple[str, str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT file_name, variable, period_start
            FROM website_data.climate_projection_sources
            WHERE import_status IS DISTINCT FROM 'imported'
            ORDER BY period_start, file_name
            """,
        )
        rows = list(cursor.fetchall())
    if variables is not None:
        rows = [row for row in rows if str(row[1]).lower() in variables]
    rows.sort(
        key=lambda row: (
            VARIABLE_PRIORITY.get(str(row[1]).lower(), 99),
            row[2],
            row[0],
        ),
    )
    return rows


def database_size(connection: Any) -> str:
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
        return str(cursor.fetchone()[0])


def source_status(connection: Any, file_name: str) -> tuple[str, int, str | None]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT import_status, imported_days, error
            FROM website_data.climate_projection_sources
            WHERE file_name=%s
            """,
            (file_name,),
        )
        row = cursor.fetchone()
    if row is None:
        raise RuntimeError(f"Source disappeared from the catalog: {file_name}")
    return str(row[0]), int(row[1] or 0), row[2]


def first_missing_day(connection: Any, file_name: str) -> tuple[int, int]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT s.id, s.period_start, s.period_end
            FROM website_data.climate_projection_sources s
            WHERE s.file_name=%s
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
              ON actual.source_id=%s
             AND actual.valid_date=expected.day::date
            WHERE actual.valid_date IS NULL
            """,
            (period_start, period_start, period_end, source_id),
        )
        missing_index = cursor.fetchone()[0]
    return (
        expected_days if missing_index is None else int(missing_index),
        expected_days,
    )


def run_and_stream(command: list[str], repo_root: Path) -> int:
    process = subprocess.Popen(
        command,
        cwd=repo_root,
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
        raise RuntimeError("--max-retries must be zero or greater.")
    if args.checkpoint_days <= 0:
        raise RuntimeError("--checkpoint-days must be positive.")
    variables = None
    if args.variables:
        variables = {
            value.strip().lower()
            for value in args.variables.split(",")
            if value.strip()
        }
        if not variables:
            raise RuntimeError("--variables must contain at least one variable.")
    if args.log_file is not None:
        args.log_file.parent.mkdir(parents=True, exist_ok=True)
        log_stream = args.log_file.open("a", encoding="utf-8", buffering=1)
        sys.stdout = log_stream
        sys.stderr = log_stream
        print(f"\nImporter process started: pid={os.getpid()}", flush=True)

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    importer = script_dir / "import-zenodo-climate-projection.py"
    verifier = script_dir / "finalize-climate-import.py"
    connection_string, ssl_enabled = load_database_config(repo_root)

    connection = connect(connection_string, ssl_enabled)
    try:
        sources = pending_sources(connection, variables)
        print(
            f"Pending files: {len(sources)}; "
            f"variables: {','.join(sorted(variables)) if variables else 'all'}; "
            f"database size before import: {database_size(connection)}",
            flush=True,
        )
    finally:
        connection.close()

    completed = 0
    for index, (file_name, variable, period_start) in enumerate(sources, start=1):
        print(
            f"\n=== [{index}/{len(sources)}] {file_name} "
            f"({variable}, {period_start}) ===",
            flush=True,
        )
        success = False
        failure_attempts = 0
        segment = 0
        while failure_attempts <= args.max_retries:
            segment += 1
            print(
                f"Segment {segment}; failures "
                f"{failure_attempts}/{args.max_retries}",
                flush=True,
            )
            connection = connect(connection_string, ssl_enabled)
            try:
                resume_day, expected_days = first_missing_day(connection, file_name)
            finally:
                connection.close()
            if resume_day == expected_days:
                print(
                    f"All {expected_days} daily frames already exist; "
                    "running final verification.",
                    flush=True,
                )
                exit_code = 0
            else:
                print(
                    f"Resuming at day {resume_day}/{expected_days}",
                    flush=True,
                )
                command = [
                    sys.executable,
                    str(importer),
                    "--file",
                    file_name,
                    "--keep-netcdf",
                ]
                if resume_day > 0:
                    command.extend(["--start-day", str(resume_day)])
                checkpointed = expected_days - resume_day > args.checkpoint_days
                if checkpointed:
                    command.extend(
                        [
                            "--limit-days",
                            str(args.checkpoint_days),
                        ],
                    )
                exit_code = run_and_stream(command, repo_root)
                if exit_code == 0 and checkpointed:
                    print(
                        f"Checkpoint completed through day "
                        f"{resume_day + args.checkpoint_days}/{expected_days}; "
                        "opening a fresh database session.",
                        flush=True,
                    )
                    continue
            if exit_code == 0:
                verify_code = run_and_stream(
                    [sys.executable, str(verifier), "--file", file_name],
                    repo_root,
                )
                if verify_code == 0:
                    success = True
                    break
                exit_code = verify_code
            failure_attempts += 1
            if failure_attempts <= args.max_retries:
                print(
                    f"File attempt failed with exit code {exit_code}; "
                    f"retrying in 30 seconds "
                    f"({failure_attempts}/{args.max_retries} failures).",
                    flush=True,
                )
                time.sleep(30)

        connection = connect(connection_string, ssl_enabled)
        try:
            status, imported_days, error = source_status(connection, file_name)
            size = database_size(connection)
        finally:
            connection.close()
        print(
            f"Result: status={status}, imported_days={imported_days}, "
            f"database_size={size}",
            flush=True,
        )
        if not success:
            print(f"Stopped on failed file: {file_name}; error={error}", flush=True)
            return 1
        completed += 1

    print(f"All pending files imported and verified: {completed}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted; the current partial download can be resumed.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
