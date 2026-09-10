#!/usr/bin/env python3
"""Profile candidate Hill of Towie curtailment fields without changing raw data."""

from __future__ import annotations

import csv
import io
import json
import math
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

try:
    from import_hill_of_towie_to_postgres import EXPECTED_BYTES, read_rows
except ModuleNotFoundError:
    from scripts.import_hill_of_towie_to_postgres import EXPECTED_BYTES, read_rows


YEAR = 2025
SOURCE_ID = "hill-of-towie-v2-2025"
DAILY_FIELDS = (
    "CurtailmentEnergy",
    "CurtailmentHours",
    "CurtailmentEnergyTot",
    "CurtailmentExternalEnergy",
    "CurtailmentExternalHours",
    "CurtailmentOverFreqEnergy",
    "CurtailmentOverFreqHours",
    "CurtailmentOverWindEnergy",
    "CurtailmentOverWindHours",
    "CurtailmentTurbineEnergy",
    "CurtailmentTurbineHours",
    "EnergyLossExternalLimit",
    "EnergyLossPUpperReferenceLimiter",
    "EnergyLossManualControl",
    "EnergyLossParkStop",
    "ForgoneEnergy",
)
TURBINE_FIELDS = ("wtc_CurTime_endvalue", "wtc_PowerRef_endvalue")
DIGITAL_FIELDS = (
    "wtc_PowerRed_counts",
    "wtc_PowerRed_endvalue",
    "wtc_PowerRed_timeon",
)
VALUE_COUNT_FIELDS = {
    "CurtailmentEnergy",
    "CurtailmentHours",
    "CurtailmentEnergyTot",
    "CurtailmentExternalEnergy",
    "CurtailmentExternalHours",
    "CurtailmentOverFreqEnergy",
    "CurtailmentOverFreqHours",
    "CurtailmentOverWindEnergy",
    "CurtailmentOverWindHours",
    "CurtailmentTurbineEnergy",
    "CurtailmentTurbineHours",
    "EnergyLossExternalLimit",
    "EnergyLossPUpperReferenceLimiter",
    "EnergyLossManualControl",
    "EnergyLossParkStop",
    "ForgoneEnergy",
    "wtc_PowerRed_counts",
    "wtc_PowerRed_endvalue",
    "wtc_PowerRed_timeon",
}


def numeric(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def new_field_stats(track_values: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "rows": 0,
        "nonEmptyRows": 0,
        "numericRows": 0,
        "nonZeroRows": 0,
        "minimum": None,
        "maximum": None,
        "sum": 0.0,
        "sampleValues": [],
    }
    if track_values:
        result["valueCounts"] = Counter()
    return result


def update_field_stats(stats: dict[str, Any], raw_value: Any) -> None:
    stats["rows"] += 1
    if raw_value is None or str(raw_value).strip() == "":
        return
    stats["nonEmptyRows"] += 1
    if len(stats["sampleValues"]) < 5:
        stats["sampleValues"].append(str(raw_value))
    if "valueCounts" in stats:
        stats["valueCounts"][str(raw_value)] += 1
    parsed = numeric(raw_value)
    if parsed is None:
        return
    stats["numericRows"] += 1
    if parsed != 0:
        stats["nonZeroRows"] += 1
    stats["minimum"] = parsed if stats["minimum"] is None else min(stats["minimum"], parsed)
    stats["maximum"] = parsed if stats["maximum"] is None else max(stats["maximum"], parsed)
    stats["sum"] += parsed


def finalize_field_stats(stats: dict[str, Any]) -> dict[str, Any]:
    result = dict(stats)
    if "valueCounts" in result:
        counts = result.pop("valueCounts")
        result["valueCounts"] = dict(sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:20])
    result["sum"] = round(result["sum"], 9)
    return result


def new_table_stats(fields: Iterable[str]) -> dict[str, Any]:
    return {
        "rows": 0,
        "months": {},
        "stationCounts": Counter(),
        "fields": {field: new_field_stats(field in VALUE_COUNT_FIELDS) for field in fields},
    }


def update_table_row(
    table_stats: dict[str, Any],
    row: dict[str, str],
    fields: Iterable[str],
    month: int,
) -> None:
    table_stats["rows"] += 1
    table_stats["stationCounts"][row.get("StationId", "")] += 1
    month_stats = table_stats["months"].setdefault(str(month), {"rows": 0, "nonEmptyByField": Counter()})
    month_stats["rows"] += 1
    for field in fields:
        value = row.get(field)
        update_field_stats(table_stats["fields"][field], value)
        if value is not None and str(value).strip() != "":
            month_stats["nonEmptyByField"][field] += 1


def finalize_table_stats(table_stats: dict[str, Any]) -> dict[str, Any]:
    result = {
        "rows": table_stats["rows"],
        "stationCounts": dict(sorted(table_stats["stationCounts"].items())),
        "fields": {field: finalize_field_stats(stats) for field, stats in table_stats["fields"].items()},
        "months": {},
    }
    for month, month_stats in table_stats["months"].items():
        result["months"][month] = {
            "rows": month_stats["rows"],
            "nonEmptyByField": dict(month_stats["nonEmptyByField"]),
        }
    return result


def scan_grid_power(archive: zipfile.ZipFile, month: int) -> dict[tuple[str, str], float | None]:
    suffix = f"{YEAR}_{month:02d}.csv"
    result: dict[tuple[str, str], float | None] = {}
    for row in read_rows(archive, f"tblSCTurGrid_{suffix}"):
        result[(row["TimeStamp"], row["StationId"])] = numeric(row.get("wtc_ActPower_mean"))
    return result


def profile_archive(repo_root: Path) -> dict[str, Any]:
    archive_path = repo_root / ".forecast-data" / "hill-of-towie" / "2025.zip"
    metadata_path = repo_root / ".forecast-data" / "hill-of-towie" / "Hill_of_Towie_turbine_metadata.csv"
    if not archive_path.exists() or not metadata_path.exists():
        raise FileNotFoundError("verified Hill of Towie 2025 archive or turbine metadata is missing")
    if archive_path.stat().st_size != EXPECTED_BYTES:
        raise ValueError("Hill of Towie archive size does not match the pinned manifest")

    with metadata_path.open(encoding="utf-8-sig", newline="") as source:
        turbine_metadata = list(csv.DictReader(source))
    rated_power_by_station = {
        row["Station ID"]: float(row["Rated power (kW)"]) for row in turbine_metadata
    }

    daily_stats = new_table_stats(DAILY_FIELDS)
    turbine_stats = new_table_stats(TURBINE_FIELDS)
    digital_stats = new_table_stats(DIGITAL_FIELDS)
    power_red = {
        "rows": 0,
        "nonZeroEndValueRows": 0,
        "timeOnPositiveRows": 0,
        "endValueOrTimeOnPositiveRows": 0,
        "endValueAndTimeOnPositiveRows": 0,
        "sameTimestampActivePower": {"positive": 0, "zero-or-missing": 0},
        "sameTimestampPowerReference": {"belowRated": 0, "atRated": 0, "missing": 0},
        "perStation": {},
    }
    power_ref = {
        "rows": 0,
        "nonEmptyRows": 0,
        "belowRatedPowerRows": 0,
        "atRatedPowerRows": 0,
        "aboveRatedPowerRows": 0,
        "perStation": {},
    }
    daily_station_fields: dict[str, dict[str, dict[str, Any]]] = {}

    with zipfile.ZipFile(archive_path) as archive:
        for month in range(1, 13):
            suffix = f"{YEAR}_{month:02d}.csv"
            grid_power = scan_grid_power(archive, month)
            power_reference_by_key: dict[tuple[str, str], float | None] = {}

            for row in read_rows(archive, f"tblDailySummary_{suffix}"):
                update_table_row(daily_stats, row, DAILY_FIELDS, month)
                station_id = row.get("StationId", "")
                station = daily_station_fields.setdefault(station_id, {})
                for field in DAILY_FIELDS:
                    value = numeric(row.get(field))
                    if value is None:
                        continue
                    field_stats = station.setdefault(field, {"rows": 0, "nonZeroRows": 0, "sum": 0.0})
                    field_stats["rows"] += 1
                    field_stats["nonZeroRows"] += int(value != 0)
                    field_stats["sum"] += value

            for row in read_rows(archive, f"tblSCTurbine_{suffix}"):
                update_table_row(turbine_stats, row, TURBINE_FIELDS, month)
                station_id = row.get("StationId", "")
                ref_value = numeric(row.get("wtc_PowerRef_endvalue"))
                power_reference_by_key[(row["TimeStamp"], station_id)] = ref_value
                power_ref["rows"] += 1
                station_ref = power_ref["perStation"].setdefault(station_id, {
                    "rows": 0,
                    "nonEmptyRows": 0,
                    "minimumKw": None,
                    "maximumKw": None,
                    "belowRatedPowerRows": 0,
                    "atRatedPowerRows": 0,
                    "aboveRatedPowerRows": 0,
                })
                station_ref["rows"] += 1
                if ref_value is None:
                    continue
                power_ref["nonEmptyRows"] += 1
                station_ref["nonEmptyRows"] += 1
                station_ref["minimumKw"] = ref_value if station_ref["minimumKw"] is None else min(station_ref["minimumKw"], ref_value)
                station_ref["maximumKw"] = ref_value if station_ref["maximumKw"] is None else max(station_ref["maximumKw"], ref_value)
                rated_kw = rated_power_by_station.get(station_id)
                if rated_kw is None:
                    continue
                if ref_value < rated_kw:
                    power_ref["belowRatedPowerRows"] += 1
                    station_ref["belowRatedPowerRows"] += 1
                elif ref_value > rated_kw:
                    power_ref["aboveRatedPowerRows"] += 1
                    station_ref["aboveRatedPowerRows"] += 1
                else:
                    power_ref["atRatedPowerRows"] += 1
                    station_ref["atRatedPowerRows"] += 1

            for row in read_rows(archive, f"tblSCTurDigiIn_{suffix}"):
                update_table_row(digital_stats, row, DIGITAL_FIELDS, month)
                station_id = row.get("StationId", "")
                end_value = numeric(row.get("wtc_PowerRed_endvalue"))
                time_on = numeric(row.get("wtc_PowerRed_timeon"))
                power_red["rows"] += 1
                station_red = power_red["perStation"].setdefault(station_id, {
                    "rows": 0,
                    "nonZeroEndValueRows": 0,
                    "timeOnPositiveRows": 0,
                    "endValueOrTimeOnPositiveRows": 0,
                    "endValueAndTimeOnPositiveRows": 0,
                    "sameTimestampActivePower": {"positive": 0, "zero-or-missing": 0},
                    "sameTimestampPowerReference": {"belowRated": 0, "atRated": 0, "missing": 0},
                })
                station_red["rows"] += 1
                is_reduced = end_value is not None and end_value != 0
                has_reduction_time = time_on is not None and time_on > 0
                if is_reduced:
                    power_red["nonZeroEndValueRows"] += 1
                    station_red["nonZeroEndValueRows"] += 1
                if has_reduction_time:
                    power_red["timeOnPositiveRows"] += 1
                    station_red["timeOnPositiveRows"] += 1
                if is_reduced or has_reduction_time:
                    power_red["endValueOrTimeOnPositiveRows"] += 1
                    station_red["endValueOrTimeOnPositiveRows"] += 1
                if is_reduced and has_reduction_time:
                    power_red["endValueAndTimeOnPositiveRows"] += 1
                    station_red["endValueAndTimeOnPositiveRows"] += 1
                if is_reduced or has_reduction_time:
                    active_power = grid_power.get((row["TimeStamp"], station_id))
                    bucket = "positive" if active_power is not None and active_power > 0 else "zero-or-missing"
                    power_red["sameTimestampActivePower"][bucket] += 1
                    station_red["sameTimestampActivePower"][bucket] += 1
                    reference = power_reference_by_key.get((row["TimeStamp"], station_id))
                    rated_power = rated_power_by_station.get(station_id)
                    if reference is None or rated_power is None:
                        reference_bucket = "missing"
                    elif reference < rated_power:
                        reference_bucket = "belowRated"
                    else:
                        reference_bucket = "atRated"
                    power_red["sameTimestampPowerReference"][reference_bucket] += 1
                    station_red["sameTimestampPowerReference"][reference_bucket] += 1

    for station_id, fields in daily_station_fields.items():
        for field_stats in fields.values():
            field_stats["sum"] = round(field_stats["sum"], 9)

    return {
        "schemaVersion": 1,
        "source": {
            "sourceId": SOURCE_ID,
            "archive": str(archive_path),
            "archiveBytes": archive_path.stat().st_size,
            "turbineCount": len(turbine_metadata),
        },
        "dailySummary": finalize_table_stats(daily_stats),
        "turbineSignals": finalize_table_stats(turbine_stats),
        "digitalInputs": finalize_table_stats(digital_stats),
        "powerRed": power_red,
        "powerReference": power_ref,
        "dailyNumericByStation": daily_station_fields,
        "interpretation": {
            "decision": "candidate-only-not-promoted",
            "reason": "candidate fields are profiled from the raw archive, but the pinned v2.0 data pack does not define a complete 10-minute curtailment label contract",
            "rawDataPreserved": True,
            "trainingLabelsChanged": False,
        },
    }


def json_ready(value: Any) -> Any:
    if isinstance(value, Counter):
        return dict(value)
    if isinstance(value, dict):
        return {str(key): json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    return value


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    output_path = repo_root / ".forecast-data" / "hill-of-towie" / "curtailment-audit.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    profile = json_ready(profile_archive(repo_root))
    output_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "dailyRows": profile["dailySummary"]["rows"],
        "powerRed": profile["powerRed"],
        "powerReference": profile["powerReference"],
        "dailyCurtailmentFields": {
            field: profile["dailySummary"]["fields"][field]
            for field in DAILY_FIELDS
            if field in profile["dailySummary"]["fields"]
        },
        "interpretation": profile["interpretation"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
