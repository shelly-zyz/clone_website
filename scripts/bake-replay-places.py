#!/usr/bin/env python3
"""Trim Natural Earth populated places to the regional weather replay map extents.

Usage: python3 scripts/bake-replay-places.py /path/to/ne_10m_populated_places.geojson
Source (public domain): https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_populated_places.geojson
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "public/data/weather-replay/relief/manifest.json").read_text())
boxes = [item["bounds"] for item in manifest["items"]]
places = []
for feature in json.loads(Path(sys.argv[1]).read_text())["features"]:
    p = feature["properties"]
    lon, lat = p["LONGITUDE"], p["LATITUDE"]
    if p["SCALERANK"] > 6 or not any(b["west"] <= lon <= b["east"] and b["south"] <= lat <= b["north"] for b in boxes):
        continue
    capital = p["FEATURECLA"].startswith("Admin-0 capital")
    places.append([round(lon, 3), round(lat, 3), p.get("NAME_ZH") or p["NAME"], p["SCALERANK"], int(p["POP_MAX"]), 1 if capital else 0])
places.sort(key=lambda item: (item[3], -item[4]))
(ROOT / "public/data/weather-replay/places.json").write_text(json.dumps({
    "source": "Natural Earth 10m populated places (public domain)",
    "fields": ["lon", "lat", "name", "scalerank", "pop_max", "national_capital"],
    "places": places,
}, ensure_ascii=False, separators=(",", ":")) + "\n")
print(len(places), "places")
