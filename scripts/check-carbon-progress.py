import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import psycopg2


TARGET_FRAMES = 21664


def load_env() -> None:
    for raw in Path(".env.local").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    load_env()
    connection_string = os.environ["DATABASE_URL"]
    parsed = urlparse(connection_string)
    kwargs = {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": parsed.path.lstrip("/"),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "connect_timeout": 15,
        "application_name": "carbon-progress-hard-timebox",
    }
    if os.environ.get("DATABASE_SSL") == "true" and "sslmode=" not in connection_string:
        kwargs["sslmode"] = "require"

    connection = psycopg2.connect(**kwargs)
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("select count(*)::int from website_data.carbon_emission_frames")
            total = cursor.fetchone()[0]
            cursor.execute(
                """
                select count(*)::int, max(observed_on)::text
                  from website_data.carbon_emission_frames
                 where sector = 'InternationalAviation'
                """
            )
            ia_count, ia_max = cursor.fetchone()
            cursor.execute(
                """
                select count(*)::int
                  from website_data.carbon_emission_frames
                 where sector = 'InternationalAviation'
                   and observed_on >= '2020-08-01'
                   and observed_on < '2020-09-01'
                """
            )
            ia_august = cursor.fetchone()[0]
            cursor.execute(
                """
                select count(*)::int
                  from (
                    select sector, observed_on
                      from website_data.carbon_emission_frames
                     group by sector, observed_on
                    having count(*) > 1
                  ) duplicates
                """
            )
            duplicate_groups = cursor.fetchone()[0]
    finally:
        connection.close()

    print(
        json.dumps(
            {
                "ok": True,
                "total": total,
                "percent": round(total / TARGET_FRAMES * 100, 2),
                "remaining": TARGET_FRAMES - total,
                "InternationalAviation": ia_count,
                "ia_max_date": ia_max,
                "ia_2020_08_count": ia_august,
                "duplicate_groups": duplicate_groups,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
