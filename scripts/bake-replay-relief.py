#!/usr/bin/env python3
"""Bake terrain and bathymetry rasters for the regional weather replay scenes.

Source: AWS Terrain Tiles (Mapzen terrarium encoding; SRTM, GMTED2010, ETOPO1 and others).
Each output is an equirectangular PNG covering the replay map bounds with a margin.
Elevation is stored as a 16-bit value split across red (high byte) and green (low byte):
metres = R * 256 + G - 11000.
"""

import io
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/weather-replay/relief"
TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
MAX_SIDE = 720


def regions():
    catalog = json.loads((ROOT / "public/data/weather-replay/regional-catalog.json").read_text())
    items = [(item["archive"], item["bounds"]) for item in catalog]
    # Northwest Atlantic satellite archive (PARDIG / SatWeave).
    items.append(("us-southeast-2026-09-26", {"west": -80, "east": -64, "south": 23, "north": 35}))
    return items


def padded(bounds):
    lon = bounds["east"] - bounds["west"]
    lat = bounds["north"] - bounds["south"]
    return {
        "west": max(-180, bounds["west"] - lon * 0.4),
        "east": min(180, bounds["east"] + lon * 0.12),
        "south": max(-84, bounds["south"] - lat * 0.22),
        "north": min(84, bounds["north"] + lat * 0.22),
    }


tiles = {}


def tile(z, x, y):
    key = (z, x % (1 << z), y)
    if key not in tiles:
        with urllib.request.urlopen(TILE.format(z=z, x=key[1], y=y), timeout=30) as response:
            rgb = np.asarray(Image.open(io.BytesIO(response.read())).convert("RGB"), dtype=np.float64)
        tiles[key] = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
    return tiles[key]


def bake(name, bounds):
    box = padded(bounds)
    lon_span = box["east"] - box["west"]
    lat_span = box["north"] - box["south"]
    mid = math.cos(math.radians((box["north"] + box["south"]) / 2))
    aspect = lon_span * mid / lat_span
    width = MAX_SIDE if aspect >= 1 else round(MAX_SIDE * aspect)
    height = round(width / aspect) if aspect >= 1 else MAX_SIDE
    degrees_per_pixel = lon_span / width
    z = max(3, min(8, math.ceil(math.log2(360 / (256 * degrees_per_pixel)))))
    n = 1 << z
    lons = box["west"] + (np.arange(width) + 0.5) / width * lon_span
    lats = box["north"] - (np.arange(height) + 0.5) / height * lat_span
    gx = (lons + 180) / 360 * n * 256
    rad = np.radians(lats)
    gy = (1 - np.log(np.tan(rad) + 1 / np.cos(rad)) / math.pi) / 2 * n * 256
    out = np.zeros((height, width))
    # Bilinear sampling across tile seams.
    x0 = np.floor(gx - 0.5).astype(int)
    y0 = np.floor(gy - 0.5).astype(int)
    fx = gx - 0.5 - x0
    fy = gy - 0.5 - y0

    def sample(px, py):
        values = np.zeros((py.size, px.size))
        for j, yy in enumerate(py):
            ty, oy = divmod(int(yy), 256)
            ty = min(max(ty, 0), n - 1)
            for i, xx in enumerate(px):
                tx, ox = divmod(int(xx), 256)
                values[j, i] = tile(z, tx, ty)[oy, ox]
        return values

    a = sample(x0, y0)
    b = sample(x0 + 1, y0)
    c = sample(x0, y0 + 1)
    d = sample(x0 + 1, y0 + 1)
    fx = fx[None, :]
    fy = fy[:, None]
    out = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    encoded = np.clip(np.round(out + 11000), 0, 65535).astype(np.uint32)
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[..., 0] = encoded >> 8
    rgb[..., 1] = encoded & 255
    Image.fromarray(rgb, "RGB").save(OUT / f"{name}.png", optimize=True)
    print(name, width, height, "z", z, "range", round(out.min()), round(out.max()), file=sys.stderr)
    return {"file": f"{name}.png", "bounds": {k: round(v, 4) for k, v in box.items()}, "width": width, "height": height}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = [{"id": name, **bake(name, bounds)} for name, bounds in regions()]
    (OUT / "manifest.json").write_text(json.dumps({
        "source": "AWS Terrain Tiles (Mapzen terrarium: SRTM, GMTED2010, ETOPO1)",
        "encoding": "metres = R * 256 + G - 11000",
        "items": manifest,
    }, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
