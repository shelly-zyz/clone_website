#!/usr/bin/env python3
"""Profile Hill of Towie 2025 power labels before any training transformation."""

from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

try:
    from import_hill_of_towie_nwp_to_postgres import hour_end, parse_timestamp
    from import_hill_of_towie_to_postgres import EXPECTED_BYTES, build_month_rows
except ModuleNotFoundError:
    from scripts.import_hill_of_towie_nwp_to_postgres import hour_end, parse_timestamp
    from scripts.import_hill_of_towie_to_postgres import EXPECTED_BYTES, build_month_rows


YEAR = 2025
HEADER_PATTERNS = {
    "curtailment": re.compile(r"curtail|curt", re.IGNORECASE),
    "derating": re.compile(r"derat|powerred|powerref|powerlim|limit|setpoint|set.?point", re.IGNORECASE),
    "outage": re.compile(r"stop|fault|error|oper|ready|alarm|shutdown", re.IGNORECASE),
}


def numeric(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def value_label(value: Any) -> str:
    if value is None or value == "":
        return "null"
    return str(value)


def is_complete_hour(values: list[tuple[datetime, float | None]]) -> bool:
    ordered = sorted(values, key=lambda item: item[0])
    timestamps = [item[0] for item in ordered]
    return (
        len(timestamps) == 6
        and len(set(timestamps)) == 6
        and timestamps[-1] - timestamps[0] == timedelta(minutes=50)
    )


def summarize_hourly_quality(observation_rows: list[tuple[Any, ...]]) -> dict[str, Any]:
    grouped: dict[datetime, list[tuple[datetime, float | None]]] = defaultdict(list)
    for row in observation_rows:
        observed_at = parse_timestamp(row[1])
        grouped[hour_end(observed_at)].append((observed_at, numeric(row[2])))

    complete = 0
    negative_hours = 0
    invalid_hours = 0
    for values in grouped.values():
        if not is_complete_hour(values):
            continue
        complete += 1
        if any(power is not None and power < 0 for _timestamp, power in values):
            negative_hours += 1
        if any(power is None or power < 0 for _timestamp, power in values):
            invalid_hours += 1
    return {
        "candidateHours": complete,
        "negativePowerHours": negative_hours,
        "invalidPowerHours": invalid_hours,
        "retainedNonNegativeHours": complete - invalid_hours,
    }


def headers_from_archive(archive: zipfile.ZipFile) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    names = sorted(name for name in archive.namelist() if name.endswith(f"_{YEAR}_01.csv"))
    for name in names:
        with archive.open(name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            headers = next(csv.reader(text), [])
            for category, pattern in HEADER_PATTERNS.items():
                for header in headers:
                    if pattern.search(header):
                        results.append({"table": name, "category": category, "field": header})
            text.detach()
    return results


def build_quality_profile(repo_root: Path) -> dict[str, Any]:
    archive_path = repo_root / ".forecast-data" / "hill-of-towie" / "2025.zip"
    metadata_path = repo_root / ".forecast-data" / "hill-of-towie" / "Hill_of_Towie_turbine_metadata.csv"
    if not archive_path.exists() or not metadata_path.exists():
        raise FileNotFoundError("verified Hill of Towie 2025 archive or turbine metadata is missing")
    if archive_path.stat().st_size != EXPECTED_BYTES:
        raise ValueError("Hill of Towie archive size does not match the pinned manifest")

    with metadata_path.open(encoding="utf-8-sig", newline="") as source:
        turbines = list(csv.DictReader(source))
    station_to_turbine = {row["Station ID"]: row["Turbine Name"] for row in turbines}
    rated_power_by_turbine = {row["Turbine Name"]: float(row["Rated power (kW)"]) / 1000.0 for row in turbines}

    observation_by_timestamp: dict[datetime, tuple[Any, ...]] = {}
    signal_metrics: dict[datetime, dict[str, Any]] = {}
    monthly: list[dict[str, Any]] = []
    raw_observation_rows = 0
    raw_signal_rows = 0
    duplicate_observation_rows = 0
    duplicate_signal_rows = 0
    previous_month_last_signal_timestamp: datetime | None = None

    with zipfile.ZipFile(archive_path) as archive:
        header_matches = headers_from_archive(archive)
        for month in range(1, 13):
            signal_rows, observation_rows = build_month_rows(archive, YEAR, month, station_to_turbine)
            raw_signal_rows += len(signal_rows)
            raw_observation_rows += len(observation_rows)
            for row in observation_rows:
                timestamp = parse_timestamp(row[1])
                if timestamp in observation_by_timestamp:
                    duplicate_observation_rows += 1
                observation_by_timestamp[timestamp] = row

            boundary_rows = signal_rows
            if previous_month_last_signal_timestamp is not None:
                boundary_rows = [
                    row for row in signal_rows
                    if parse_timestamp(row[1]) != previous_month_last_signal_timestamp
                ]
                duplicate_signal_rows += len(signal_rows) - len(boundary_rows)
            for row in boundary_rows:
                timestamp = parse_timestamp(row[1])
                metrics = signal_metrics.setdefault(timestamp, {
                    "turbineCount": 0,
                    "powerSumMw": 0.0,
                    "powerValues": 0,
                    "missingPowerValues": 0,
                    "faultTurbines": 0,
                })
                metrics["turbineCount"] += 1
                power_kw = numeric(row[3])
                if power_kw is None:
                    metrics["missingPowerValues"] += 1
                else:
                    metrics["powerSumMw"] += power_kw / 1000.0
                    metrics["powerValues"] += 1
                if bool(row[8]):
                    metrics["faultTurbines"] += 1
            if signal_rows:
                previous_month_last_signal_timestamp = parse_timestamp(signal_rows[-1][1])
            monthly.append({
                "month": month,
                "rawSignalRows": len(signal_rows),
                "rawObservationRows": len(observation_rows),
            })

    observations = [observation_by_timestamp[key] for key in sorted(observation_by_timestamp)]
    negative_rows: list[tuple[datetime, float]] = []
    power_values: list[float] = []
    negative_by_month: Counter[str] = Counter()
    negative_by_hour: Counter[str] = Counter()
    negative_by_data_ok: Counter[str] = Counter()
    negative_by_wps_status: Counter[str] = Counter()
    negative_with_turbine_power: Counter[str] = Counter()
    negative_with_fault: Counter[str] = Counter()
    for row in observations:
        observed_at = parse_timestamp(row[1])
        power_mw = numeric(row[2])
        if power_mw is None:
            continue
        power_values.append(power_mw)
        if power_mw >= 0:
            continue
        negative_rows.append((observed_at, power_mw))
        metrics = signal_metrics.get(observed_at, {})
        negative_by_month[observed_at.strftime("%Y-%m")] += 1
        negative_by_hour[f"{observed_at.hour:02d}"] += 1
        negative_by_data_ok[value_label(row[5])] += 1
        negative_by_wps_status[value_label(row[4])] += 1
        negative_with_turbine_power["positive"] += int(metrics.get("powerSumMw", 0.0) > 0)
        negative_with_turbine_power["zero-or-missing"] += int(metrics.get("powerSumMw", 0.0) <= 0)
        negative_with_fault["yes"] += int(metrics.get("faultTurbines", 0) > 0)
        negative_with_fault["no"] += int(metrics.get("faultTurbines", 0) == 0)

    hourly = summarize_hourly_quality(observations)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "source": {
            "sourceId": "hill-of-towie-v2-2025",
            "archive": str(archive_path),
            "archiveBytes": archive_path.stat().st_size,
            "turbineCount": len(turbines),
            "installedCapacityMw": sum(rated_power_by_turbine.values()),
            "powerField": "ActivePowerMean",
            "powerUnit": "MW",
        },
        "counts": {
            "rawMonthlyObservationRows": raw_observation_rows,
            "uniqueObservationRows": len(observations),
            "duplicateObservationRows": duplicate_observation_rows,
            "rawMonthlySignalRows": raw_signal_rows,
            "duplicateSignalBoundaryRows": duplicate_signal_rows,
            "negativeObservationRows": len(negative_rows),
            "finiteObservationRows": len(power_values),
        },
        "powerRangeMw": {
            "minimum": min(power_values) if power_values else None,
            "maximum": max(power_values) if power_values else None,
        },
        "hourlyQuality": hourly,
        "negativePower": {
            "percentageOfFiniteRows": round(len(negative_rows) / len(power_values) * 100, 3) if power_values else 0,
            "byMonth": dict(sorted(negative_by_month.items())),
            "byUtcHour": dict(sorted(negative_by_hour.items())),
            "bySourceDataOk": dict(negative_by_data_ok),
            "byWpsStatus": dict(negative_by_wps_status),
            "turbinePowerAtSameTimestamp": dict(negative_with_turbine_power),
            "anyTurbineFaultAtSameTimestamp": dict(negative_with_fault),
            "examples": [
                {"observedAt": timestamp.isoformat(), "activePowerMw": power}
                for timestamp, power in negative_rows[:10]
            ],
        },
        "headerMatches": header_matches,
        "monthly": monthly,
        "interpretation": {
            "negativePowerTreatment": "retain-source-value-and-exclude-from-training-until-provider-defines-net-power-offset",
            "curtailmentTreatment": "unknown-unless-explicit-source-field-or-authoritative-label-is-found",
            "rawDataPreserved": True,
        },
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    output_path = repo_root / ".forecast-data" / "hill-of-towie" / "power-quality-audit.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    profile = build_quality_profile(repo_root)
    output_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "counts": profile["counts"],
        "powerRangeMw": profile["powerRangeMw"],
        "hourlyQuality": profile["hourlyQuality"],
        "negativePower": {
            "percentageOfFiniteRows": profile["negativePower"]["percentageOfFiniteRows"],
            "bySourceDataOk": profile["negativePower"]["bySourceDataOk"],
            "byWpsStatus": profile["negativePower"]["byWpsStatus"],
            "turbinePowerAtSameTimestamp": profile["negativePower"]["turbinePowerAtSameTimestamp"],
            "anyTurbineFaultAtSameTimestamp": profile["negativePower"]["anyTurbineFaultAtSameTimestamp"],
        },
        "headerMatches": profile["headerMatches"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
