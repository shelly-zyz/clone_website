#!/usr/bin/env python3
"""Import extracted GFS point values and build hourly Hill of Towie backtest pairs."""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import psycopg2
from dotenv import dotenv_values
from psycopg2.extras import Json, execute_values


NWP_SOURCE_ID = "noaa-ncei-gfs-forecast-grid004"
SCADA_SOURCE_ID = "hill-of-towie-v2-2025"
LICENSE = "NOAA public data; Hill of Towie CC-BY-4.0"


def parse_timestamp(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso_timestamp(value: datetime) -> str:
    return parse_timestamp(value).isoformat().replace("+00:00", "Z")


def hour_end(value: datetime) -> datetime:
    """Map end-of-period ten-minute records to the hour they complete."""
    utc = parse_timestamp(value)
    boundary = utc.replace(minute=0, second=0, microsecond=0)
    return boundary if utc == boundary else boundary + timedelta(hours=1)


def aggregate_hourly_observations(rows: Iterable[tuple[datetime, float | None]], minimum_samples: int = 6) -> dict[datetime, float]:
    grouped: dict[datetime, list[tuple[datetime, float | None]]] = {}
    for observed_at, power in rows:
        end = hour_end(observed_at)
        grouped.setdefault(end, []).append((parse_timestamp(observed_at), power))

    aggregated: dict[datetime, float] = {}
    for end, values in grouped.items():
        ordered = sorted(values, key=lambda item: item[0])
        timestamps = [item[0] for item in ordered]
        if len(timestamps) != minimum_samples or len(set(timestamps)) != minimum_samples:
            continue
        if timestamps[-1] - timestamps[0] != timedelta(minutes=50):
            continue
        if any(power is None or not math.isfinite(float(power)) or float(power) < 0 for _timestamp, power in ordered):
            continue
        aggregated[end] = sum(float(power) for _timestamp, power in ordered) / minimum_samples
    return dict(sorted(aggregated.items()))


def load_nwp_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen_valid_times: set[datetime] = set()
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid NWP JSON at line {line_number}: {error}") from error
            valid_time = parse_timestamp(record["valid_time"])
            issue_time = parse_timestamp(record["issue_time"])
            if issue_time >= valid_time:
                raise ValueError(f"NWP issue time is not before valid time at line {line_number}")
            if valid_time in seen_valid_times:
                raise ValueError(f"duplicate NWP valid time at line {line_number}: {valid_time.isoformat()}")
            for field in ("u100_mps", "v100_mps", "wind_speed_mps"):
                value = float(record[field])
                if not math.isfinite(value) or (field == "wind_speed_mps" and value < 0):
                    raise ValueError(f"invalid NWP {field} at line {line_number}")
            record["issue_time"] = issue_time
            record["valid_time"] = valid_time
            seen_valid_times.add(valid_time)
            records.append(record)
    return sorted(records, key=lambda record: record["valid_time"])


def interpolate_nwp(records: list[dict[str, Any]], target: datetime) -> dict[str, Any] | None:
    target_time = parse_timestamp(target)
    if not records:
        return None
    exact = next((record for record in records if record["valid_time"] == target_time), None)
    if exact is not None:
        return {
            "issue_time": exact["issue_time"],
            "valid_time": target_time,
            "u100_mps": float(exact["u100_mps"]),
            "v100_mps": float(exact["v100_mps"]),
            "wind_speed_mps": float(exact["wind_speed_mps"]),
            "method": "native-3-hour",
            "native_prev_valid_time": exact["valid_time"],
            "native_next_valid_time": exact["valid_time"],
            "fraction": 0.0,
        }

    for previous, following in zip(records, records[1:]):
        if not (previous["valid_time"] < target_time < following["valid_time"]):
            continue
        issue_time = max(previous["issue_time"], following["issue_time"])
        if issue_time >= target_time:
            raise ValueError("NWP interpolation would use an issue time at or after the target")
        span = (following["valid_time"] - previous["valid_time"]).total_seconds()
        fraction = (target_time - previous["valid_time"]).total_seconds() / span
        u100 = float(previous["u100_mps"]) + fraction * (float(following["u100_mps"]) - float(previous["u100_mps"]))
        v100 = float(previous["v100_mps"]) + fraction * (float(following["v100_mps"]) - float(previous["v100_mps"]))
        return {
            "issue_time": issue_time,
            "valid_time": target_time,
            "u100_mps": u100,
            "v100_mps": v100,
            "wind_speed_mps": math.hypot(u100, v100),
            "method": "linear-vector-interpolation",
            "native_prev_valid_time": previous["valid_time"],
            "native_next_valid_time": following["valid_time"],
            "fraction": fraction,
        }
    return None


def build_training_row(
    target: datetime,
    observed_power_mw: float,
    nwp: dict[str, Any],
    available_capacity_mw: float,
    outage_flag: bool,
    profile: dict[str, Any],
) -> dict[str, Any]:
    if observed_power_mw < 0:
        raise ValueError("negative observed generation cannot become a training label")
    entity = profile["entity"]
    centroid = entity["centroid"]
    return {
        "entity_id": entity["id"],
        "entity_level": "plant",
        "technology": entity["technology"],
        "entity_latitude": centroid["latitude"],
        "entity_longitude": centroid["longitude"],
        "observed_at": iso_timestamp(target),
        "observed_power_mw": float(observed_power_mw),
        "observed_power_unit": "MW",
        "nwp_issue_time": iso_timestamp(nwp["issue_time"]),
        "nwp_valid_time": iso_timestamp(target),
        "nwp_u100_mps": float(nwp["u100_mps"]),
        "nwp_v100_mps": float(nwp["v100_mps"]),
        "nwp_wind_speed_mps": float(nwp["wind_speed_mps"]),
        "nwp_interpolation_method": nwp["method"],
        "nwp_native_prev_valid_time": iso_timestamp(nwp["native_prev_valid_time"]),
        "nwp_native_next_valid_time": iso_timestamp(nwp["native_next_valid_time"]),
        "nwp_interpolation_fraction": float(nwp["fraction"]),
        "installed_capacity_mw": float(entity["installedCapacityMw"]),
        "available_capacity_mw": min(float(entity["installedCapacityMw"]), max(0.0, float(available_capacity_mw))),
        "outage_flag": bool(outage_flag),
        # The source has reduction evidence, but no authoritative grid-
        # curtailment label. False is a required schema placeholder, while
        # curtailment_known=false prevents promotion.
        "curtailment_flag": False,
        "curtailment_known": False,
        "timezone": entity["timezone"],
        "quality_code": "valid",
        "data_identity": "observed",
        "observation_source": SCADA_SOURCE_ID,
        "nwp_source": NWP_SOURCE_ID,
        "data_license": LICENSE,
        "resolution_minutes": 60,
        "audit_status": "research-only",
        "metadata": {
            "curtailmentStatus": "unknown-no-authoritative-grid-label",
            "availableCapacityMethod": "mean rated capacity excluding rows with explicit fault_outage_flag",
            "nwpNativeResolutionHours": 3,
        },
    }


def load_database_config(repo_root: Path) -> tuple[str, bool]:
    values = {**dotenv_values(repo_root / ".env.local"), **os.environ}
    connection_string = values.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL is not configured")
    return str(connection_string), str(values.get("DATABASE_SSL", "")).lower() == "true"


def point_values(records: list[dict[str, Any]], entity_id: str) -> list[tuple[Any, ...]]:
    values: list[tuple[Any, ...]] = []
    for record in records:
        values.append((
            NWP_SOURCE_ID,
            entity_id,
            record["issue_time"],
            record["valid_time"],
            int(record["forecast_hour"]),
            float(record["target_latitude"]),
            float(record["target_longitude"]),
            float(record["grid_latitude"]),
            float(record["grid_longitude"]),
            float(record["u100_mps"]),
            float(record["v100_mps"]),
            float(record["wind_speed_mps"]),
            record.get("quality_code", "valid"),
            record["source_file_url"],
            record["source_index_url"],
            record.get("source_file_etag"),
            record.get("source_file_bytes"),
            int(record["selected_range_start"]),
            int(record["selected_range_end"]),
            int(record["selected_payload_bytes"]),
            record["selected_payload_md5"],
            Json({"selectedFields": record.get("selected_fields", [])}),
        ))
    return values


def training_values(rows: Iterable[dict[str, Any]]) -> list[tuple[Any, ...]]:
    fields = (
        "entity_id", "observed_at", "entity_level", "technology", "entity_latitude", "entity_longitude",
        "observed_power_mw", "observed_power_unit", "nwp_issue_time", "nwp_valid_time", "nwp_u100_mps",
        "nwp_v100_mps", "nwp_wind_speed_mps", "nwp_interpolation_method", "nwp_native_prev_valid_time",
        "nwp_native_next_valid_time", "nwp_interpolation_fraction", "installed_capacity_mw",
        "available_capacity_mw", "outage_flag", "curtailment_flag", "curtailment_known", "timezone",
        "quality_code", "data_identity", "observation_source", "nwp_source", "data_license",
        "resolution_minutes", "audit_status", "metadata",
    )
    return [tuple(Json(row[field]) if field == "metadata" else row[field] for field in fields) for row in rows]


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    nwp_path = repo_root / ".forecast-data" / "noaa-gfs" / "hill-of-towie-2025" / "hill-of-towie-2025-gfs-100m.ndjson"
    profile_path = repo_root / ".forecast-data" / "hill-of-towie" / "site-profile.json"
    if not nwp_path.exists():
        raise RuntimeError(f"NWP point file is missing: {nwp_path}")
    records = load_nwp_records(nwp_path)
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    entity_id = profile["entity"]["id"]
    connection_string, ssl_enabled = load_database_config(repo_root)
    connection = psycopg2.connect(
        connection_string,
        sslmode="require" if ssl_enabled else "disable",
        connect_timeout=20,
        application_name="hill-of-towie-nwp-import",
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute((repo_root / "scripts" / "forecast-nwp-schema.sql").read_text(encoding="utf-8"))
            metadata = {
                "entityId": entity_id,
                "target": profile["entity"]["centroid"],
                "selectedFields": ["UGRD:100 m above ground", "VGRD:100 m above ground"],
                "nativeForecastResolutionHours": 3,
                "pairingResolutionMinutes": 60,
                "curtailmentKnown": False,
                "sourceReductionEvidence": [
                    "wtc_PowerRed_endvalue",
                    "wtc_PowerRed_timeon",
                    "wtc_PowerRef_endvalue",
                ],
                "pointRows": len(records),
            }
            cursor.execute(
                """
                INSERT INTO website_data.forecast_nwp_sources (
                  source_id,source_name,publisher,product_url,data_identity,native_resolution_hours,
                  grid_resolution_degrees,entity_id,import_status,metadata
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'loading',%s)
                ON CONFLICT (source_id) DO UPDATE SET
                  source_name=EXCLUDED.source_name,publisher=EXCLUDED.publisher,product_url=EXCLUDED.product_url,
                  data_identity=EXCLUDED.data_identity,native_resolution_hours=EXCLUDED.native_resolution_hours,
                  grid_resolution_degrees=EXCLUDED.grid_resolution_degrees,entity_id=EXCLUDED.entity_id,
                  import_status='loading',metadata=EXCLUDED.metadata,updated_at=now()
                """,
                (NWP_SOURCE_ID, "NOAA GFS 0.5 degree historical issued forecast", "NOAA National Centers for Environmental Information", "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast", "historical-issued-forecast", 3, 0.5, entity_id, Json(metadata)),
            )
            execute_values(cursor, """
                INSERT INTO website_data.forecast_nwp_points (
                  source_id,entity_id,issue_time,valid_time,forecast_hour,target_latitude,target_longitude,
                  grid_latitude,grid_longitude,u100_mps,v100_mps,wind_speed_mps,quality_code,source_file_url,
                  source_index_url,source_file_etag,source_file_bytes,selected_range_start,selected_range_end,
                  selected_payload_bytes,selected_payload_md5,metadata
                ) VALUES %s
                ON CONFLICT (source_id,entity_id,issue_time,forecast_hour) DO UPDATE SET
                  valid_time=EXCLUDED.valid_time,target_latitude=EXCLUDED.target_latitude,target_longitude=EXCLUDED.target_longitude,
                  grid_latitude=EXCLUDED.grid_latitude,grid_longitude=EXCLUDED.grid_longitude,u100_mps=EXCLUDED.u100_mps,
                  v100_mps=EXCLUDED.v100_mps,wind_speed_mps=EXCLUDED.wind_speed_mps,quality_code=EXCLUDED.quality_code,
                  source_file_url=EXCLUDED.source_file_url,source_index_url=EXCLUDED.source_index_url,source_file_etag=EXCLUDED.source_file_etag,
                  source_file_bytes=EXCLUDED.source_file_bytes,selected_range_start=EXCLUDED.selected_range_start,
                  selected_range_end=EXCLUDED.selected_range_end,selected_payload_bytes=EXCLUDED.selected_payload_bytes,
                  selected_payload_md5=EXCLUDED.selected_payload_md5,metadata=EXCLUDED.metadata
            """, point_values(records, entity_id), page_size=500)

            # quality_code is a derived audit field, not a rewrite of the
            # source value.  Keep the already-imported raw observation while
            # preventing negative net output from appearing source-valid in
            # subsequent quality reports.
            cursor.execute(
                """
                UPDATE website_data.forecast_scada_observations
                SET quality_code='suspect'
                WHERE source_id=%s AND active_power_mw < 0
                """,
                (SCADA_SOURCE_ID,),
            )

            cursor.execute(
                "SELECT observed_at,active_power_mw FROM website_data.forecast_scada_observations WHERE source_id=%s ORDER BY observed_at",
                (SCADA_SOURCE_ID,),
            )
            hourly_observations = aggregate_hourly_observations(cursor.fetchall())
            cursor.execute("""
                WITH slices AS (
                  SELECT
                    date_trunc('hour', s.observed_at - interval '1 second') + interval '1 hour' AS hour_end,
                    s.observed_at,
                    sum(CASE WHEN coalesce(s.fault_outage_flag, false) THEN 0 ELSE t.rated_power_kw / 1000.0 END) AS available_mw,
                    bool_or(coalesce(s.fault_outage_flag, false)) AS outage_flag
                  FROM website_data.forecast_scada_turbine_signals s
                  JOIN website_data.forecast_scada_turbines t
                    ON t.source_id=s.source_id AND t.turbine_id=s.turbine_id
                  WHERE s.source_id=%s
                  GROUP BY 1,2
                )
                SELECT hour_end,avg(available_mw),bool_or(outage_flag),count(*)
                FROM slices
                GROUP BY hour_end
                ORDER BY hour_end
            """, (SCADA_SOURCE_ID,))
            availability = {
                parse_timestamp(row[0]): (float(row[1]), bool(row[2]))
                for row in cursor.fetchall()
                if int(row[3]) >= 6
            }
            training_rows: list[dict[str, Any]] = []
            installed_capacity = float(profile["entity"]["installedCapacityMw"])
            for target, observed_power in hourly_observations.items():
                nwp = interpolate_nwp(records, target)
                if nwp is None:
                    continue
                available_capacity, outage_flag = availability.get(target, (installed_capacity, False))
                training_rows.append(build_training_row(target, observed_power, nwp, available_capacity, outage_flag, profile))
            execute_values(cursor, """
                INSERT INTO website_data.forecast_training_pairs (
                  entity_id,observed_at,entity_level,technology,entity_latitude,entity_longitude,observed_power_mw,
                  observed_power_unit,nwp_issue_time,nwp_valid_time,nwp_u100_mps,nwp_v100_mps,nwp_wind_speed_mps,
                  nwp_interpolation_method,nwp_native_prev_valid_time,nwp_native_next_valid_time,nwp_interpolation_fraction,
                  installed_capacity_mw,available_capacity_mw,outage_flag,curtailment_flag,curtailment_known,timezone,
                  quality_code,data_identity,observation_source,nwp_source,data_license,resolution_minutes,audit_status,metadata
                ) VALUES %s
                ON CONFLICT (entity_id,observed_at) DO UPDATE SET
                  entity_level=EXCLUDED.entity_level,technology=EXCLUDED.technology,entity_latitude=EXCLUDED.entity_latitude,
                  entity_longitude=EXCLUDED.entity_longitude,observed_power_mw=EXCLUDED.observed_power_mw,
                  observed_power_unit=EXCLUDED.observed_power_unit,nwp_issue_time=EXCLUDED.nwp_issue_time,
                  nwp_valid_time=EXCLUDED.nwp_valid_time,nwp_u100_mps=EXCLUDED.nwp_u100_mps,nwp_v100_mps=EXCLUDED.nwp_v100_mps,
                  nwp_wind_speed_mps=EXCLUDED.nwp_wind_speed_mps,nwp_interpolation_method=EXCLUDED.nwp_interpolation_method,
                  nwp_native_prev_valid_time=EXCLUDED.nwp_native_prev_valid_time,nwp_native_next_valid_time=EXCLUDED.nwp_native_next_valid_time,
                  nwp_interpolation_fraction=EXCLUDED.nwp_interpolation_fraction,installed_capacity_mw=EXCLUDED.installed_capacity_mw,
                  available_capacity_mw=EXCLUDED.available_capacity_mw,outage_flag=EXCLUDED.outage_flag,
                  curtailment_flag=EXCLUDED.curtailment_flag,curtailment_known=EXCLUDED.curtailment_known,
                  timezone=EXCLUDED.timezone,quality_code=EXCLUDED.quality_code,data_identity=EXCLUDED.data_identity,
                  observation_source=EXCLUDED.observation_source,nwp_source=EXCLUDED.nwp_source,data_license=EXCLUDED.data_license,
                  resolution_minutes=EXCLUDED.resolution_minutes,audit_status=EXCLUDED.audit_status,metadata=EXCLUDED.metadata
            """, training_values(training_rows), page_size=500)
            cursor.execute(
                "UPDATE website_data.forecast_nwp_sources SET import_status=%s,imported_at=now(),updated_at=now(),metadata=metadata || %s::jsonb WHERE source_id=%s",
                ("paired-research-only" if training_rows else "nwp-points-only", Json({"pairRows": len(training_rows), "curtailmentKnown": False, "curtailmentStatus": "unknown-no-authoritative-grid-label"}), NWP_SOURCE_ID),
            )
        connection.commit()
        print(json.dumps({"sourceId": NWP_SOURCE_ID, "nwpPointRows": len(records), "hourlyObservationRows": len(hourly_observations), "trainingPairRows": len(training_rows), "status": "paired-research-only" if training_rows else "nwp-points-only"}, default=str, indent=2))
        return 0
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
