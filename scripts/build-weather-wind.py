"""Sample native WRF 3D U/V/W and mass-level heights for the wind viewer."""
import argparse
import base64
import hashlib
import json
from pathlib import Path

from netCDF4 import Dataset, chartostring
import numpy as np

SOURCE = "https://github.com/xarray-contrib/xwrf-data/blob/7a6100a48ee1b39a3fce3465e4da9e2c2a53cf6c/data/mercator_sample.nc"
G = 9.80665


def destagger(field, dimension):
    left, right = [slice(None)] * field.ndim, [slice(None)] * field.ndim
    left[dimension], right[dimension] = slice(None, -1), slice(1, None)
    return (field[tuple(left)] + field[tuple(right)]) * .5


def packed(values):
    data = np.ma.asarray(values).filled(np.nan)
    valid = np.isfinite(data)
    scaled = np.full(data.shape, -32768, dtype="<i2")
    if np.max(np.abs(data[valid]), initial=0) >= 327:
        raise ValueError("WRF display sample exceeds packing precision limit")
    scaled[valid] = np.round(data[valid] * 100).astype("<i2")
    return base64.b64encode(scaled.tobytes()).decode()


def build(path):
    with Dataset(path) as data:
        if "WRF" not in data.TITLE or data.MAP_PROJ != 3:
            raise ValueError("The sample adapter requires aligned Mercator WRF output")
        stride = 4
        levels = list(range(0, len(data.dimensions["bottom_top"]), 2))
        _, rows, cols = data["U10"].shape
        x, y = np.meshgrid((np.arange(cols) - (cols - 1) / 2) * float(data.DX) / 1000,
                           (np.arange(rows) - (rows - 1) / 2) * float(data.DY) / 1000)
        index = (levels, slice(2, None, stride), slice(2, None, stride))
        origin = [float(data["XLONG"][0].mean()), float(data["XLAT"][0].mean())]
        when = chartostring(data["Times"][:])
        frames = []
        for i, timestamp in enumerate(when):
            u = destagger(data["U"][i], 2)[index]
            v = destagger(data["V"][i], 1)[index]
            w = destagger(data["W"][i], 0)[index]
            altitude = destagger((data["PH"][i] + data["PHB"][i]) / G, 0)[index] / 1000
            surface = np.hypot(data["U10"][i], data["V10"][i])
            fields = np.stack((u, v, w, altitude), axis=-1)
            frames.append({"time": timestamp.replace("_", "T") + "Z", "vectors": packed(fields),
                           "surfaceMean": round(float(np.mean(surface)), 6)})
        region = [float(data[name][0].min()) for name in ("XLONG", "XLAT")] + [
                  float(data[name][0].max()) for name in ("XLONG", "XLAT")]
        model = data.TITLE.strip()
        issue = data.START_DATE.replace("_", "T") + "Z"
    return {"schema": 1, "source": SOURCE, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "issue": issue, "model": model, "origin": origin, "bounds": region,
            "x": x[2::stride, 2::stride].round(4).flatten().tolist(),
            "y": y[2::stride, 2::stride].round(4).flatten().tolist(), "levels": levels, "frames": frames}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wrfout", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(build(args.wrfout), separators=(",", ":")) + "\n")
