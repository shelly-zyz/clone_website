#!/usr/bin/env python3
"""Decode the selected GFS 100 m wind messages at the nearest grid point."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from eccodes import codes_get, codes_get_array, codes_grib_new_from_file, codes_release


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--latitude", type=float, required=True)
    parser.add_argument("--longitude", type=float, required=True)
    parser.add_argument("--issue-time", required=True)
    parser.add_argument("--valid-time", required=True)
    parser.add_argument("--forecast-hour", type=int, required=True)
    return parser.parse_args()


def longitude_distance(left: np.ndarray, right: float) -> np.ndarray:
    difference = np.abs(left - right)
    return np.minimum(difference, 360.0 - difference)


def nearest_point(message: Any, target_latitude: float, target_longitude: float) -> dict[str, float]:
    latitudes = np.asarray(codes_get_array(message, "latitudes"), dtype=np.float64)
    longitudes = np.asarray(codes_get_array(message, "longitudes"), dtype=np.float64) % 360.0
    values = np.asarray(codes_get_array(message, "values"), dtype=np.float64)
    if not (latitudes.size == longitudes.size == values.size):
        raise RuntimeError("GFS coordinate/value arrays have different lengths")
    target_longitude_360 = target_longitude % 360.0
    distance = (latitudes - target_latitude) ** 2 + longitude_distance(longitudes, target_longitude_360) ** 2
    index = int(np.nanargmin(distance))
    value = float(values[index])
    if not math.isfinite(value):
        raise RuntimeError("GFS nearest-point value is not finite")
    return {
        "value": value,
        "grid_latitude": float(latitudes[index]),
        "grid_longitude": float(longitudes[index]),
    }


def decode(args: argparse.Namespace) -> dict[str, Any]:
    target_fields = {
        # ecCodes exposes the GRIB2 discipline/category as shortName ``u``/``v``;
        # the accompanying NCEP index calls these same fields UGRD/VGRD.
        ("u", "heightAboveGround", 100): "u100_mps",
        ("v", "heightAboveGround", 100): "v100_mps",
    }
    decoded: dict[str, dict[str, float]] = {}
    with args.input.open("rb") as source:
        while True:
            message = codes_grib_new_from_file(source)
            if message is None:
                break
            try:
                identity = (
                    str(codes_get(message, "shortName")),
                    str(codes_get(message, "typeOfLevel")),
                    int(codes_get(message, "level")),
                )
                variable = target_fields.get(identity)
                if variable is None or variable in decoded:
                    continue
                decoded[variable] = nearest_point(message, args.latitude, args.longitude)
            finally:
                codes_release(message)

    missing = sorted(set(target_fields.values()) - set(decoded))
    if missing:
        raise RuntimeError(f"Selected GFS payload is missing: {', '.join(missing)}")

    u100 = decoded["u100_mps"]["value"]
    v100 = decoded["v100_mps"]["value"]
    issue_time = datetime.fromisoformat(args.issue_time.replace("Z", "+00:00")).astimezone(timezone.utc)
    valid_time = datetime.fromisoformat(args.valid_time.replace("Z", "+00:00")).astimezone(timezone.utc)
    if issue_time >= valid_time:
        raise ValueError("GFS issue time must precede valid time")

    grid_latitudes = {round(decoded[name]["grid_latitude"], 3) for name in decoded}
    grid_longitudes = {round(decoded[name]["grid_longitude"], 3) for name in decoded}
    if len(grid_latitudes) != 1 or len(grid_longitudes) != 1:
        raise RuntimeError("GFS U/V fields selected different nearest grid points")

    return {
        "schemaVersion": 1,
        "issue_time": issue_time.isoformat().replace("+00:00", "Z"),
        "valid_time": valid_time.isoformat().replace("+00:00", "Z"),
        "forecast_hour": args.forecast_hour,
        "target_latitude": args.latitude,
        "target_longitude": args.longitude,
        "grid_latitude": next(iter(grid_latitudes)),
        "grid_longitude": next(iter(grid_longitudes)),
        "u100_mps": u100,
        "v100_mps": v100,
        "wind_speed_mps": math.hypot(u100, v100),
        "units": {"u100_mps": "m s-1", "v100_mps": "m s-1", "wind_speed_mps": "m s-1"},
    }


def main() -> None:
    args = parse_args()
    print(json.dumps(decode(args), separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    main()
