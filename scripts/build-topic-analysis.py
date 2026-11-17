#!/usr/bin/env python3
"""Build compact chart data from the bundled GFS frame and a GRACED Power archive."""

import argparse
from datetime import datetime, timedelta
from hashlib import sha256
import json
from math import atan2, cos, degrees, hypot, isfinite, radians
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GFS_FRAME = ROOT / "public/earth/data/weather/current/current-wind-surface-level-gfs-1.0.json"
OUTPUT = ROOT / "src/lib/topic-analysis"
LATITUDES = [-90, -60, -30, 0, 30, 60, 90]
SPEED_THRESHOLDS = [3, 6, 9, 12, 15]
DIRECTIONS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]


def gfs_summary():
    raw = GFS_FRAME.read_bytes()
    records = {item["header"]["parameterNumber"]: item for item in json.loads(raw)}
    east, north = records[2], records[3]
    header = east["header"]
    expected = ["refTime", "forecastTime", "nx", "ny", "la1", "dy", "scanMode", "surface1Value"]
    if any(header[key] != north["header"][key] for key in expected):
        raise ValueError("GFS U and V grid definitions differ")
    width, height = header["nx"], header["ny"]
    if header["scanMode"] != 0 or header["surface1Value"] != 10 or (
        len(east["data"]) != width * height or len(north["data"]) != width * height
    ):
        raise ValueError("Expected a regular GFS 10 m wind grid")
    issued = datetime.fromisoformat(header["refTime"].replace("Z", "+00:00"))
    valid = issued + timedelta(hours=header["forecastTime"])
    samples = []
    for index, (u, v) in enumerate(zip(east["data"], north["data"])):
        if u is None or v is None or not isfinite(u) or not isfinite(v):
            continue
        latitude = header["la1"] - (index // width) * header["dy"]
        weight = cos(radians(latitude)) if abs(latitude) < 90 else 0.0
        direction = int((degrees(atan2(-u, -v)) + 22.5) % 360 // 45)
        samples.append((latitude, weight, hypot(u, v), direction))

    def summarize(region):
        total_weight = sum(item[1] for item in region)
        speed_weights = [0.0] * (len(SPEED_THRESHOLDS) + 1)
        direction_weights = [0.0] * len(DIRECTIONS)
        latitude_weights = [0.0] * (len(LATITUDES) - 1)
        latitude_speeds = [0.0] * len(latitude_weights)
        for latitude, weight, speed, direction in region:
            speed_weights[sum(speed >= limit for limit in SPEED_THRESHOLDS)] += weight
            if speed >= 0.5:
                direction_weights[direction] += weight
            band = min(int((latitude + 90) // 30), len(latitude_weights) - 1)
            latitude_weights[band] += weight
            latitude_speeds[band] += weight * speed
        moving_weight = sum(direction_weights)
        return {
            "mean": sum(latitude_speeds) / total_weight,
            "max": max(item[2] for item in region),
            "cells": len(region),
            "latitudeMeans": [
                speed / weight if weight else None for speed, weight in zip(latitude_speeds, latitude_weights)
            ],
            "speedShares": [100 * weight / total_weight for weight in speed_weights],
            "directionShares": [100 * weight / moving_weight for weight in direction_weights],
        }

    return {
        "archive": GFS_FRAME.relative_to(ROOT).as_posix(),
        "sha256": sha256(raw).hexdigest(),
        "issued": issued.isoformat(),
        "valid": valid.isoformat(),
        "regions": {
            "global": summarize(samples),
            "north": summarize([item for item in samples if item[0] >= 0]),
            "south": summarize([item for item in samples if item[0] < 0]),
        },
    }


def graced_summary(archive):
    import numpy as np
    from netCDF4 import Dataset, num2date

    rows = []
    with Dataset(archive) as dataset:
        emission = dataset["emission"]
        if dataset.unit != "kgC/h" or emission.dimensions != ("nday", "latitude", "longitude"):
            raise ValueError("Expected GRACED daily power grid in kgC/h")
        latitudes = dataset["latitude"][:]
        bands = [((latitudes >= start) & (latitudes < end)) for start, end in zip(LATITUDES, LATITUDES[1:])]
        time = dataset["nday"]
        dates = num2date(time[:], time.units)
        for index, date in enumerate(dates):
            frame = np.asarray(np.ma.filled(emission[index], 0), dtype="<f4")
            np.nan_to_num(frame, copy=False, nan=0, posinf=0, neginf=0)
            frame[frame < 0] = 0
            rows.append({
                "date": date.strftime("%Y-%m-%d"),
                "rate": float(frame.sum(dtype=np.float64)),
                "activeCells": int(np.count_nonzero(frame)),
                "latitudeRates": [float(frame[band].sum(dtype=np.float64)) for band in bands],
            })

    return {"archive": archive.name, "sha256": sha256(archive.read_bytes()).hexdigest(), "days": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graced", required=True, type=Path, help="Local GRACED Power NetCDF archive")
    args = parser.parse_args()
    summaries = {"weather": gfs_summary(), "carbon": graced_summary(args.graced)}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for topic, data in summaries.items():
        (OUTPUT / f"{topic}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
