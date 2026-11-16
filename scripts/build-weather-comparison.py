"""Build the archived global comparison from WeatherBench 2 ERA5 and NOAA GFS."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen
import base64
import json
import sys
import time

import numpy as np
from numcodecs import Blosc
import pygrib

ERA = "https://storage.googleapis.com/weatherbench2/datasets/era5/1959-2023_01_10-6h-240x121_equiangular_with_poles_conservative.zarr"
GFS = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20220322/00/atmos/gfs.t00z.pgrb2.0p25.f"
RUN = datetime(2022, 3, 22)
HOURS = (6, 12, 18, 24)
FIELDS = {
    "t2m": ("2m_temperature", None, "TMP:2 m above ground", .1, 273.15, "°C"),
    "u10": ("10m_u_component_of_wind", None, "UGRD:10 m above ground", .1, 0, "m/s"),
    "z500": ("geopotential", 500, "HGT:500 mb", 1, 0, "m"),
    "t850": ("temperature", 850, "TMP:850 mb", .1, 273.15, "°C"),
    "v10": ("10m_v_component_of_wind", None, "VGRD:10 m above ground", .1, 0, "m/s"),
}
META = {}


def get(url, bounds=None):
    request = Request(url, headers={"Range": f"bytes={bounds[0]}-{bounds[1]}"}) if bounds else Request(url)
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                if bounds and (response.status != 206 or
                        not response.headers.get("Content-Range", "").startswith(f"bytes {bounds[0]}-{bounds[1]}/")):
                    raise ValueError("GFS response did not return the requested GRIB byte range")
                return response.read()
        except OSError:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def decode(name, chunk):
    spec = META[name + "/.zarray"]
    raw = Blosc().decode(get(f"{ERA}/{name}/{chunk}"))
    return np.frombuffer(raw, dtype=spec["dtype"]).reshape(spec["chunks"])


def checks():
    levels = decode("level", "0")
    lon, lat = decode("longitude", "0"), decode("latitude", "0")
    clock = decode("time", "0")
    lon = np.mod(lon + 1e-7, 360)
    order = np.argsort(lon)
    if not np.allclose(lon[order][::2], np.arange(0, 360, 3), atol=2e-6):
        raise ValueError("Unexpected ERA5 longitude grid")
    if not np.allclose(np.sort(lat)[::2], np.arange(-90, 91, 3)):
        raise ValueError("Unexpected ERA5 latitude grid")
    if not np.array_equal(clock[:12], np.arange(0, 72, 6)):
        raise ValueError("Unexpected WeatherBench 2 time axis")
    coordinate_size = META["time/.zarray"]["chunks"][0]
    for hour in HOURS:
        since_epoch = (RUN + timedelta(hours=hour) - datetime(1959, 1, 1)).total_seconds() / 3600
        chunk, index = divmod(int(since_epoch / 6), coordinate_size)
        if decode("time", str(chunk))[index] != since_epoch:
            raise ValueError("ERA5 valid time does not match GFS")
    return levels, lat, order


def era_field(name, level, when, levels, lat, order):
    offset = int((when - datetime(1959, 1, 1)).total_seconds() // (6 * 3600))
    time_chunk, index = divmod(offset, 8)
    if level is None:
        grid = decode(name, f"{time_chunk}.0.0")[index].T
    else:
        lev = np.flatnonzero(levels == level)[0]
        grid = decode(name, f"{time_chunk}.0.0.0")[index, lev].T
    if lat[0] < lat[-1]:
        grid = grid[::-1]
    return grid[::2, order[::2]]


def messages(hour):
    url = GFS + f"{hour:03d}"
    index = [line.split(":") for line in get(url + ".idx").decode().splitlines()]
    matches = ["".join([row[3], ":", row[4]]) for row in index]
    ranges = []
    for _, _, name, *_ in FIELDS.values():
        i = matches.index(name)
        ranges.append((int(index[i][1]), int(index[i + 1][1]) - 1))
    with ThreadPoolExecutor(4) as pool:
        data = b"".join(pool.map(lambda bounds: get(url, bounds), ranges))
    with TemporaryDirectory() as directory:
        file = Path(directory) / "frame.grib2"
        file.write_bytes(data)
        with pygrib.open(str(file)) as source:
            output = []
            when = RUN + timedelta(hours=hour)
            for message in source:
                if message.analDate != RUN or message.validDate != when or message.Ni != 1440 or message.Nj != 721:
                    raise ValueError("GFS coordinates or forecast times differ from the paired archive")
                lats, lons = message.latlons()
                if not np.allclose(lats[::12, 0], np.arange(90, -91, -3)) or not np.allclose(lons[0, ::12], np.arange(0, 360, 3)):
                    raise ValueError("Unexpected GFS scan alignment")
                output.append(np.asarray(message.values)[::12, ::12])
    if len(output) != len(FIELDS):
        raise ValueError("Missing GFS field")
    return output, url


def encode(values, quantum):
    finite = np.isfinite(values)
    grid = np.full(values.shape, -32768, dtype="<i2")
    scaled = np.rint(values[finite] / quantum)
    if not scaled.size or np.any((scaled <= -32768) | (scaled > 32767)):
        raise ValueError("Field does not fit the assigned precision")
    grid[finite] = scaled
    return base64.b64encode(grid.tobytes()).decode()


def build_frame(hour, levels, lat, order):
    forecast, source = messages(hour)
    when = RUN + timedelta(hours=hour)
    records = {}
    with ThreadPoolExecutor(4) as pool:
        observations = pool.map(lambda field: era_field(field[0], field[1], when, levels, lat, order), FIELDS.values())
        for ((key, (_, _, _, quantum, offset, unit)), obs, fcst) in zip(FIELDS.items(), observations, forecast, strict=True):
            # GFS HGT is already in geopotential metres. ERA5 publishes geopotential.
            if key == "z500":
                obs = obs / 9.80665
            records[key] = {"analysis": encode(obs - offset, quantum), "forecast": encode(fcst - offset, quantum),
                            "quantum": quantum, "unit": unit}
    return {"time": when.isoformat() + "Z", "forecastSource": source, "fields": records}


def main():
    global META
    META = json.loads(get(ERA + "/.zmetadata"))["metadata"]
    levels, lat, order = checks()
    with ThreadPoolExecutor(2) as pool:
        frames = list(pool.map(lambda hour: build_frame(hour, levels, lat, order), HOURS))
    data = {"schema": 1, "run": RUN.isoformat() + "Z", "cols": 120, "rows": 61,
            "step": 3, "analysisSource": ERA, "frames": frames}
    Path(sys.argv[1]).write_text(json.dumps(data, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
