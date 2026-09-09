#!/usr/bin/env python3
"""Verify a segmented climate import and mark its source file complete."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    return parser.parse_args()


def database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured.")
    ssl_enabled = str(values.get("DATABASE_SSL", "")).lower() == "true"
    return str(connection_string), ssl_enabled


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    connection_string, ssl_enabled = database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, period_start, period_end
                FROM website_data.climate_projection_sources
                WHERE file_name=%s
                """,
                (args.file,),
            )
            source = cursor.fetchone()
            if source is None:
                raise RuntimeError(f"Climate source is not registered: {args.file}")
            source_id, period_start, period_end = source
            expected_days = (period_end - period_start).days + 1
            cursor.execute(
                """
                SELECT count(*), min(valid_date), max(valid_date),
                       count(*) FILTER (
                         WHERE octet_length(frame_data)=0 OR frame_sha256 IS NULL
                       )
                FROM website_data.climate_projection_daily
                WHERE source_id=%s
                """,
                (source_id,),
            )
            imported_days, first_date, last_date, invalid_frames = cursor.fetchone()
            cursor.execute(
                """
                SELECT count(*)
                FROM generate_series(%s::date,%s::date,'1 day'::interval) expected(day)
                LEFT JOIN website_data.climate_projection_daily actual
                  ON actual.source_id=%s
                 AND actual.valid_date=expected.day::date
                WHERE actual.valid_date IS NULL
                """,
                (period_start, period_end, source_id),
            )
            missing_days = int(cursor.fetchone()[0])
            if (
                int(imported_days) != expected_days
                or first_date != period_start
                or last_date != period_end
                or int(invalid_frames) != 0
                or missing_days != 0
            ):
                raise RuntimeError(
                    "Climate import is incomplete: "
                    f"expected={expected_days}, imported={imported_days}, "
                    f"range={first_date}..{last_date}, missing={missing_days}, "
                    f"invalid={invalid_frames}",
                )
            cursor.execute(
                """
                UPDATE website_data.climate_projection_sources
                SET import_status='imported', imported_days=%s, error=NULL,
                    imported_at=now(), updated_at=now()
                WHERE id=%s
                """,
                (expected_days, source_id),
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
                "file": args.file,
                "expectedDays": expected_days,
                "importedDays": int(imported_days),
                "firstDate": first_date.isoformat(),
                "lastDate": last_date.isoformat(),
                "missingDays": missing_days,
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
