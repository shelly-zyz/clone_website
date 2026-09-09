#!/usr/bin/env python3
"""Count imported carbon frames for one sector/month with short DB timeouts."""

from __future__ import annotations

import os
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import psycopg2


def load_local_environment() -> None:
    env_path = Path(".env.local")
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def main() -> None:
    load_local_environment()
    sector = os.environ["CARBON_CHECK_SECTOR"]
    month = os.environ["CARBON_CHECK_MONTH"]
    connection_string = os.environ["DATABASE_URL"]
    parsed = urlparse(connection_string)
    kwargs = {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": parsed.path.lstrip("/"),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "connect_timeout": 15,
        "application_name": "carbon-backfill-count",
    }
    if os.environ.get("DATABASE_SSL") == "true" and "sslmode=" not in connection_string:
        kwargs["sslmode"] = "require"

    for _attempt in range(1, 4):
        try:
            connection = psycopg2.connect(**kwargs)
            connection.autocommit = True
            cursor = connection.cursor()
            cursor.execute(
                """
                select count(*)::int as frames
                  from website_data.carbon_emission_frames
                 where sector = %s
                   and observed_on >= %s::date
                   and observed_on < (%s::date + interval '1 month')
                """,
                (sector, f"{month}-01", f"{month}-01"),
            )
            print(int(cursor.fetchone()[0]))
            cursor.close()
            connection.close()
            return
        except Exception:
            time.sleep(2)

    print(-1)


if __name__ == "__main__":
    main()
