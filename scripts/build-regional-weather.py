"""Extract regional replay grids from archived NOAA GFS GRIB2 messages."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen
import json
import numpy as np
import pygrib

OUT = Path(__file__).resolve().parents[1] / "public/data/weather-replay"
REGIONS = {
    "china": ("中国东南沿海 · 台风格美", (111, 128, 18, 33)),
    "north-america": ("北美 · 美国中东部", (-104, -78, 28, 47)),
    "south-america": ("南美 · 亚马孙流域", (-76, -47, -17, 5)),
    "europe": ("欧洲 · 西欧", (-13, 16, 41, 59)),
    "asia": ("亚洲 · 孟加拉湾", (79, 101, 8, 28)),
    "africa": ("非洲 · 刚果盆地", (10, 36, -14, 9)),
    "oceania": ("大洋洲 · 澳大利亚东岸", (140, 157, -38, -19)),
}


def frame(run, hour):
    date = run.strftime("%Y%m%d")
    url = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{date}/00/atmos/gfs.t00z.pgrb2.0p25.f{hour:03d}"
    with urlopen(url + ".idx", timeout=30) as response:
        inventory = [line.split(":") for line in response.read().decode().splitlines()]
    selected = [("PRATE", "surface"), ("TCDC", "entire atmosphere")]
    result = []
    when = run + timedelta(hours=hour)
    for variable, level in selected:
        index = next(i for i, row in enumerate(inventory) if row[3:6] == [variable, level, f"{hour} hour fcst"])
        start, end = int(inventory[index][1]), int(inventory[index + 1][1]) - 1
        with urlopen(Request(url, headers={"Range": f"bytes={start}-{end}"}), timeout=40) as response, TemporaryDirectory() as folder:
            if response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start}-{end}/"):
                raise ValueError("Incorrect source byte range")
            path = Path(folder) / "message.grib2"
            path.write_bytes(response.read())
            with pygrib.open(str(path)) as messages:
                message = messages.read(1)[0]
                if message.analDate != run or message.validDate != when or (message.Ni, message.Nj) != (1440, 721):
                    raise ValueError("Incorrect source grid or time")
                result.append(np.ma.asarray(message.values).filled(np.nan))
    return when.isoformat() + "Z", url + ".idx", *result


def build(run, regions):
    with ThreadPoolExecutor(max_workers=5) as pool:
        frames = list(pool.map(lambda hour: frame(run, hour), (6, 9, 12, 15, 18)))
    for key in regions:
        label, (west, east, south, north) = REGIONS[key]
        step = .25 if key == "china" else .5
        lons = np.arange(west, east + step / 2, step)
        lats = np.arange(south, north + step / 2, step)
        selection = np.ix_(((90 - lats) * 4).astype(int), (lons * 4).astype(int) % 1440)
        def values(grid, factor, precision):
            return [round(float(value * factor), precision) if np.isfinite(value) and value >= 0 else None
                    for value in grid[selection].flat]
        rain = [dict(time=time, url=url, values=values(rate, 3600, 2)) for time, url, rate, _ in frames]
        clouds = [dict(time=time, url=url, values=values(cloud, 1, 0)) for time, url, _, cloud in frames]
        if any(not any(value is not None for value in rec["values"]) for rec in rain + clouds):
            raise ValueError("Empty coverage")
        record = dict(id="gfs-" + key, region=label, bounds=dict(west=west, east=east, south=south, north=north),
                      cols=len(lons), rows=len(lats), coastline=[], rain=rain, satellite=clouds,
                      metadata=dict(product="NOAA GFS", kind="forecast", run=run.isoformat() + "Z",
                                    resolution=step, sourceResolution=.25, stepMinutes=180,
                                    cloudVariable="cover", rainUnit="mm/h", cloudUnit="%"))
        (OUT / ("gfs-" + key + ".json")).write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        print(key, max(max(v or 0 for v in item["values"]) for item in rain), flush=True)


if __name__ == "__main__":
    build(datetime(2024, 7, 25), ["china"])
    build(datetime(2022, 3, 22), [key for key in REGIONS if key != "china"])
    catalog = [{"value": key, "label": label, "archive": f"gfs-{key}"}
               for key, (label, _) in REGIONS.items()]
    (OUT / "regional-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
