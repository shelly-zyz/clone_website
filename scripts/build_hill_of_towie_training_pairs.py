#!/usr/bin/env python3
"""Build an auditable local Hill of Towie SCADA/GFS hourly pair file.

This is the database-independent companion to
``import_hill_of_towie_nwp_to_postgres.py``.  It uses the same source parsing,
hour aggregation, and issue-time-preserving interpolation functions, so the
pairing can be fully checked while the remote PostgreSQL endpoint is offline.
"""

from __future__ import annotations

import json
import math
import sys
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from import_hill_of_towie_nwp_to_postgres import (
        NWP_SOURCE_ID,
        SCADA_SOURCE_ID,
        aggregate_hourly_observations,
        build_training_row,
        hour_end,
        interpolate_nwp,
        iso_timestamp,
        load_nwp_records,
        parse_timestamp,
    )
    from import_hill_of_towie_to_postgres import EXPECTED_BYTES, build_month_rows
except ModuleNotFoundError:
    from scripts.import_hill_of_towie_nwp_to_postgres import (
        NWP_SOURCE_ID,
        SCADA_SOURCE_ID,
        aggregate_hourly_observations,
        build_training_row,
        hour_end,
        interpolate_nwp,
        iso_timestamp,
        load_nwp_records,
        parse_timestamp,
    )
    from scripts.import_hill_of_towie_to_postgres import EXPECTED_BYTES, build_month_rows


YEAR = 2025


def hourly_observation_quality_audit(
    observation_rows: list[tuple[Any, ...]],
) -> tuple[int, int]:
    """Return complete hourly candidates and candidates containing bad labels."""
    grouped: dict[datetime, list[tuple[datetime, float | None]]] = {}
    for row in observation_rows:
        observed_at = parse_timestamp(row[1])
        grouped.setdefault(hour_end(observed_at), []).append((observed_at, row[2]))

    complete = 0
    invalid_power = 0
    for values in grouped.values():
        ordered = sorted(values, key=lambda item: item[0])
        timestamps = [item[0] for item in ordered]
        if len(timestamps) != 6 or len(set(timestamps)) != 6:
            continue
        if timestamps[-1] - timestamps[0] != timedelta(minutes=50):
            continue
        complete += 1
        if any(power is None or not math.isfinite(float(power)) or float(power) < 0 for _timestamp, power in ordered):
            invalid_power += 1
    return complete, invalid_power


def build_hourly_availability(
    signal_rows: list[tuple[Any, ...]],
    rated_power_by_turbine: dict[str, float],
    slice_states: dict[tuple[datetime, datetime], list[Any]] | None = None,
) -> dict[datetime, tuple[float, bool]]:
    """Aggregate turbine fault evidence into the same hourly rule as the DB importer."""
    states = slice_states if slice_states is not None else {}
    for row in signal_rows:
        observed_at = parse_timestamp(row[1])
        turbine_id = str(row[2])
        if turbine_id not in rated_power_by_turbine:
            raise ValueError(f"unknown turbine in signal rows: {turbine_id}")
        key = (hour_end(observed_at), observed_at)
        state = states.setdefault(key, [0.0, False])
        fault_outage = bool(row[8]) if row[8] is not None else False
        if not fault_outage:
            state[0] += rated_power_by_turbine[turbine_id]
        state[1] = bool(state[1]) or fault_outage

    grouped: dict[datetime, list[list[Any]]] = {}
    for (end, _observed_at), state in states.items():
        grouped.setdefault(end, []).append(state)
    return {
        end: (sum(float(state[0]) for state in values) / len(values), any(bool(state[1]) for state in values))
        for end, values in grouped.items()
        if len(values) >= 6
    }


def clean_window_profile(
    timestamps: list[datetime],
    year: int = YEAR,
    window_days: int = 90,
    minimum_completeness: float = 0.95,
) -> dict[str, Any]:
    """Profile continuity and the best rolling coverage window without filling gaps."""
    range_start = datetime(year, 1, 1, tzinfo=timezone.utc)
    range_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    unique = sorted({parse_timestamp(value) for value in timestamps if range_start <= parse_timestamp(value) < range_end})
    hour = timedelta(hours=1)
    runs: list[dict[str, Any]] = []
    run_start: datetime | None = None
    previous: datetime | None = None
    for timestamp in unique:
        if run_start is None or timestamp - (previous or timestamp) != hour:
            if run_start is not None and previous is not None:
                runs.append({"start": iso_timestamp(run_start), "end": iso_timestamp(previous), "hours": int((previous - run_start).total_seconds() // 3600) + 1})
            run_start = timestamp
        previous = timestamp
    if run_start is not None and previous is not None:
        runs.append({"start": iso_timestamp(run_start), "end": iso_timestamp(previous), "hours": int((previous - run_start).total_seconds() // 3600) + 1})
    runs.sort(key=lambda item: (-item["hours"], item["start"]))

    window_hours = window_days * 24
    window_delta = timedelta(hours=window_hours)
    best: dict[str, Any] | None = None
    left = 0
    right = 0
    window_start = range_start
    while window_start + window_delta <= range_end:
        window_end = window_start + window_delta
        while left < len(unique) and unique[left] < window_start:
            left += 1
        while right < len(unique) and unique[right] < window_end:
            right += 1
        valid_hours = max(0, right - left)
        candidate = {
            "start": iso_timestamp(window_start),
            "end": iso_timestamp(window_end - hour),
            "validHours": valid_hours,
            "expectedHours": window_hours,
            "completeness": round(valid_hours / window_hours, 4),
        }
        if best is None or candidate["validHours"] > best["validHours"]:
            best = candidate
        window_start += hour

    return {
        "windowDays": window_days,
        "minimumCompleteness": minimum_completeness,
        "contiguousRunCount": len(runs),
        "longestContiguousHours": runs[0]["hours"] if runs else None,
        "best90DayWindow": best,
        "best90DayCompleteness": best["completeness"] if best else None,
        "eligible": bool(best and best["completeness"] >= minimum_completeness),
    }


def load_profile(path: Path) -> dict[str, Any]:
    profile = json.loads(path.read_text(encoding="utf-8"))
    if profile.get("entity", {}).get("technology") != "wind":
        raise ValueError("Hill of Towie profile must describe a wind entity")
    return profile


def build_pairs(repo_root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    archive_path = repo_root / ".forecast-data" / "hill-of-towie" / "2025.zip"
    metadata_path = repo_root / ".forecast-data" / "hill-of-towie" / "Hill_of_Towie_turbine_metadata.csv"
    profile_path = repo_root / ".forecast-data" / "hill-of-towie" / "site-profile.json"
    nwp_path = repo_root / ".forecast-data" / "noaa-gfs" / "hill-of-towie-2025" / "hill-of-towie-2025-gfs-100m.ndjson"

    for path in (archive_path, metadata_path, profile_path, nwp_path):
        if not path.exists():
            raise FileNotFoundError(f"required local source is missing: {path}")
    if archive_path.stat().st_size != EXPECTED_BYTES:
        raise ValueError("verified Hill of Towie archive byte size does not match the pinned manifest")

    profile = load_profile(profile_path)
    entity = profile["entity"]
    rated_power_by_turbine = {
        str(turbine["turbineId"]): float(turbine["ratedPowerKw"]) / 1000.0
        for turbine in entity["turbines"]
    }
    station_to_turbine = {
        str(turbine["stationId"]): str(turbine["turbineId"])
        for turbine in entity["turbines"]
    }

    observation_by_timestamp: dict[datetime, tuple[Any, ...]] = {}
    raw_observation_row_count = 0
    slice_states: dict[tuple[datetime, datetime], list[Any]] = {}
    previous_month_last_signal_timestamp: datetime | None = None
    monthly_stats: list[dict[str, int]] = []
    with zipfile.ZipFile(archive_path) as archive:
        for month in range(1, 13):
            signal_rows, month_observations = build_month_rows(archive, YEAR, month, station_to_turbine)
            raw_observation_row_count += len(month_observations)
            for row in month_observations:
                # Each monthly CSV includes the following month's 00:00
                # boundary, so the archive presents 11 duplicate observation
                # timestamps.  PostgreSQL's primary key collapses them during
                # the SCADA import; mirror that behavior before aggregation.
                observation_by_timestamp[parse_timestamp(row[1])] = row

            boundary_rows = signal_rows
            if previous_month_last_signal_timestamp is not None:
                boundary_rows = [
                    row for row in signal_rows
                    if parse_timestamp(row[1]) != previous_month_last_signal_timestamp
                ]
            build_hourly_availability(boundary_rows, rated_power_by_turbine, slice_states)
            if signal_rows:
                previous_month_last_signal_timestamp = parse_timestamp(signal_rows[-1][1])
            monthly_stats.append({
                "month": month,
                "turbineSignalRows": len(signal_rows),
                "observationRows": len(month_observations),
            })

    observation_rows = [observation_by_timestamp[key] for key in sorted(observation_by_timestamp)]
    complete_hourly_candidates, invalid_power_hours = hourly_observation_quality_audit(observation_rows)
    hourly_observations = aggregate_hourly_observations(
        (parse_timestamp(row[1]), row[2]) for row in observation_rows
    )
    availability = build_hourly_availability([], rated_power_by_turbine, slice_states)
    nwp_records = load_nwp_records(nwp_path)

    training_rows: list[dict[str, Any]] = []
    missing_nwp_targets: list[str] = []
    methods: Counter[str] = Counter()
    for target, observed_power in hourly_observations.items():
        nwp = interpolate_nwp(nwp_records, target)
        if nwp is None:
            missing_nwp_targets.append(target.isoformat())
            continue
        available_capacity, outage_flag = availability.get(
            target,
            (float(entity["installedCapacityMw"]), False),
        )
        row = build_training_row(target, observed_power, nwp, available_capacity, outage_flag, profile)
        training_rows.append(row)
        methods[row["nwp_interpolation_method"]] += 1

    audit = {
        "schemaVersion": 1,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "status": (
            "blocked-observation-quality"
            if invalid_power_hours
            else "verified-research-only"
            if training_rows and not missing_nwp_targets
            else "blocked-incomplete-pairing"
        ),
        "source": {
            "scadaSourceId": SCADA_SOURCE_ID,
            "nwpSourceId": NWP_SOURCE_ID,
            "archive": str(archive_path),
            "archiveBytes": archive_path.stat().st_size,
            "archiveVerifiedAgainstPinnedSize": archive_path.stat().st_size == EXPECTED_BYTES,
            "nwpPointFile": str(nwp_path),
        },
        "counts": {
            "nwpPointRows": len(nwp_records),
            "rawObservationRows": len(observation_rows),
            "rawObservationRowsBeforeBoundaryDedup": raw_observation_row_count,
            "hourlyObservationRows": len(hourly_observations),
            "completeHourlyCandidates": complete_hourly_candidates,
            "excludedInvalidPowerHours": invalid_power_hours,
            "hourlyAvailabilityRows": len(availability),
            "trainingPairRows": len(training_rows),
            "missingNwpTargets": len(missing_nwp_targets),
        },
        "timeRange": {
            "firstPair": training_rows[0]["observed_at"] if training_rows else None,
            "lastPair": training_rows[-1]["observed_at"] if training_rows else None,
        },
        "interpolationMethods": dict(methods),
        "curtailment": {
            "known": False,
            "status": "unknown-no-authoritative-grid-label",
            "promotionBlocked": True,
        },
        "cleanWindow": clean_window_profile([parse_timestamp(row["observed_at"]) for row in training_rows]),
        "monthlyStats": monthly_stats,
        "missingNwpTargetTimes": missing_nwp_targets,
    }
    return training_rows, audit


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    output_dir = repo_root / ".forecast-data" / "noaa-gfs" / "hill-of-towie-2025"
    output_path = output_dir / "hill-of-towie-2025-training-pairs.ndjson"
    audit_path = output_dir / "pairing-audit.json"
    output_dir.mkdir(parents=True, exist_ok=True)
    rows, audit = build_pairs(repo_root)
    with output_path.open("w", encoding="utf-8", newline="\n") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "audit": str(audit_path),
        "status": audit["status"],
        "counts": audit["counts"],
        "interpolationMethods": audit["interpolationMethods"],
        "curtailment": audit["curtailment"],
    }, ensure_ascii=False, indent=2))
    return 0 if audit["status"] in {"verified-research-only", "blocked-observation-quality"} else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
