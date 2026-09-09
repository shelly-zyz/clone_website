#!/usr/bin/env python3
"""Decode the GFS fields used by Weather Earth without requiring wgrib2."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from eccodes import (
    codes_get,
    codes_get_array,
    codes_grib_new_from_file,
    codes_release,
)


TARGETS = {
    ("10u", "heightAboveGround", 10): "UGRD",
    ("10v", "heightAboveGround", 10): "VGRD",
    ("2t", "heightAboveGround", 2): "TMP",
    ("2r", "heightAboveGround", 2): "RH",
    ("cape", "surface", 0): "CAPE",
    ("prmsl", "meanSea", 0): "PRMSL",
    ("pwat", "atmosphereSingleLayer", 0): "PWAT",
    ("u", "heightAboveGround", 100): "UGRD100",
    ("v", "heightAboveGround", 100): "VGRD100",
    ("gust", "surface", 0): "GUST",
    ("tp", "surface", 0): "APCP",
    ("sde", "surface", 0): "SNOD",
    ("sp", "surface", 0): "PRES",
    ("sdswrf", "surface", 0): "DSWRF",
    ("2sh", "heightAboveGround", 2): "SPFH",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def coordinate_key(value: float) -> str:
    return f"{value:.3f}"


def decode(path: Path) -> dict[str, Any]:
    fields: dict[str, dict[tuple[str, str], float]] = {}
    longitude_values: set[str] = set()
    latitude_values: set[str] = set()

    with path.open("rb") as source:
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
                variable = TARGETS.get(identity)
                if variable is None or variable in fields:
                    continue
                latitudes = np.asarray(codes_get_array(message, "latitudes"), dtype=np.float64)
                longitudes = np.asarray(codes_get_array(message, "longitudes"), dtype=np.float64)
                values = np.asarray(codes_get_array(message, "values"), dtype=np.float64)
                if not (latitudes.size == longitudes.size == values.size):
                    raise RuntimeError(f"Coordinate/value mismatch for {variable}.")
                field: dict[tuple[str, str], float] = {}
                for longitude, latitude, value in zip(longitudes, latitudes, values, strict=True):
                    lon_key = coordinate_key(float(longitude) % 360)
                    lat_key = coordinate_key(float(latitude))
                    field[(lon_key, lat_key)] = float(value)
                    longitude_values.add(lon_key)
                    latitude_values.add(lat_key)
                fields[variable] = field
            finally:
                codes_release(message)

    missing = sorted(set(TARGETS.values()) - set(fields))
    if missing:
        raise RuntimeError(f"GRIB2 is missing required fields: {', '.join(missing)}")

    longitudes = sorted(map(float, longitude_values))
    latitudes = sorted(map(float, latitude_values), reverse=True)
    if len(longitudes) < 2 or len(latitudes) < 2:
        raise RuntimeError("Decoded GRIB2 grid is incomplete.")

    ordered: dict[str, list[float | None]] = {}
    for variable, field in fields.items():
        ordered[variable] = [
            field.get((coordinate_key(longitude), coordinate_key(latitude)))
            for latitude in latitudes
            for longitude in longitudes
        ]

    return {
        "header": {
            "lo1": longitudes[0],
            "la1": latitudes[0],
            "dx": round(longitudes[1] - longitudes[0], 6),
            "dy": round(latitudes[0] - latitudes[1], 6),
            "nx": len(longitudes),
            "ny": len(latitudes),
        },
        "lons": longitudes,
        "lats": latitudes,
        "values": ordered,
    }


def main() -> None:
    args = parse_args()
    payload = decode(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
