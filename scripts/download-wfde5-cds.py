#!/usr/bin/env python3
"""Download WFDE5 hourly files from the Copernicus CDS in resumable chunks.

The CDS request shown on the dataset page is a real network request, but the
full 1979-2024 selection is too large for one job.  This helper submits one
request per year by default and records completed years in a state JSON file.
The CDS API key is read from the normal ``.cdsapirc`` file; it is never
written to the state file or printed by this script.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


DATASET = "derived-near-surface-meteorological-variables"
VARIABLES = [
    "near_surface_air_temperature",
    "near_surface_specific_humidity",
    "near_surface_wind_speed",
    "surface_air_pressure",
    "surface_downwelling_shortwave_radiation",
]
MONTHS = [f"{month:02d}" for month in range(1, 13)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download WFDE5 hourly NetCDF files from CDS.")
    parser.add_argument("--output-root", type=Path, required=True, help="Directory for downloaded NetCDF files")
    parser.add_argument("--start-year", type=int, default=1979)
    parser.add_argument("--end-year", type=int, default=2024)
    parser.add_argument("--years-per-request", type=int, default=1, choices=(1, 2, 3, 4, 5, 6))
    parser.add_argument("--state", type=Path, default=None, help="State JSON (defaults to output-root/wfde5-download-state.json)")
    parser.add_argument("--pause-seconds", type=float, default=2.0)
    parser.add_argument("--dry-run", action="store_true", help="Print requests without contacting CDS")
    return parser.parse_args()


def load_state(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"dataset": DATASET, "status": "pending", "completed": [], "failed": []}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def request_for(years: list[int]) -> dict[str, Any]:
    return {
        "product": "wfde5",
        "variable": VARIABLES,
        "reference_dataset": "cru",
        "year": [str(year) for year in years],
        "month": MONTHS,
        "version": "3_0",
    }


def main() -> int:
    args = parse_args()
    if args.start_year > args.end_year:
        raise SystemExit("start-year must be <= end-year")
    if args.years_per_request < 1:
        raise SystemExit("years-per-request must be positive")

    args.output_root.mkdir(parents=True, exist_ok=True)
    state_path = args.state or (args.output_root / "wfde5-download-state.json")
    state = load_state(state_path)
    state.update({"dataset": DATASET, "startYear": args.start_year, "endYear": args.end_year})
    completed = set(str(item) for item in state.get("completed", []))
    failed = state.setdefault("failed", [])

    batches: list[list[int]] = []
    year = args.start_year
    while year <= args.end_year:
        batches.append(list(range(year, min(year + args.years_per_request, args.end_year + 1))))
        year += args.years_per_request

    client = None
    if not args.dry_run:
        try:
            import cdsapi  # type: ignore
        except ImportError as error:
            raise SystemExit("cdsapi is not installed; run: python -m pip install 'cdsapi>=0.7.7'") from error
        client = cdsapi.Client()

    state["status"] = "running"
    save_state(state_path, state)
    for years in batches:
        label = f"{years[0]}-{years[-1]}"
        if label in completed:
            continue
        target = args.output_root / f"wfde5_v3.0_{years[0]}_{years[-1]}.nc"
        request = request_for(years)
        print(json.dumps({"batch": label, "target": str(target), "request": request}, ensure_ascii=False), flush=True)
        if args.dry_run:
            continue
        state["current"] = {"batch": label, "target": str(target), "status": "requesting"}
        save_state(state_path, state)
        try:
            # Passing a target path lets cdsapi resume at the request level and
            # avoids the deprecated ``.download()`` shorthand.
            client.retrieve(DATASET, request, str(target))
            completed.add(label)
            state["completed"] = sorted(completed)
            state["current"] = None
            save_state(state_path, state)
        except Exception as error:  # noqa: BLE001 - preserve failure for resume
            failure = {"batch": label, "target": str(target), "error": str(error), "time": time.time()}
            failed[:] = [item for item in failed if item.get("batch") != label]
            failed.append(failure)
            state["current"] = {"batch": label, "target": str(target), "status": "failed", "error": str(error)}
            state["status"] = "failed"
            save_state(state_path, state)
            print(json.dumps(failure, ensure_ascii=False), file=sys.stderr, flush=True)
            return 1
        if args.pause_seconds > 0:
            time.sleep(args.pause_seconds)

    state["status"] = "completed"
    state["current"] = None
    state["completed"] = sorted(completed)
    save_state(state_path, state)
    print(json.dumps({"status": "completed", "completed": sorted(completed), "state": str(state_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
