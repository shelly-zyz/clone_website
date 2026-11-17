"""Archive the NOAA GFS-Wave 2022-03-22 00Z run on the classic earth display grid."""
import base64
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

import numpy as np
import pygrib

RUN = datetime(2022, 3, 22)
HOURS = (6, 9, 12, 15, 18)
SOURCE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20220322/00/wave/gridded/gfswave.t00z.global.0p25.f"
OUTPUT = Path(__file__).resolve().parent.parent / "public/earth/data/waves"
VARIABLES = {"HTSGW": ("height", 100), "PERPW": ("period", 10), "DIRPW": ("direction", 10)}


def encode(values, scale):
    valid = np.isfinite(values)
    result = np.full(values.shape, -32768, dtype="<i2")
    result[valid] = np.rint(values[valid] * scale).astype("<i2")
    return base64.b64encode(result.tobytes()).decode()


def build(hour):
    url = f"{SOURCE}{hour:03}.grib2"
    with urlopen(url + ".idx", timeout=20) as response:
        inventory = [line.split(":") for line in response.read().decode().splitlines()]
    selected = [i for i, row in enumerate(inventory) if row[3] in VARIABLES and row[4] == "surface"]
    first, last = selected[0], selected[-1]
    if last - first != 2 or len(selected) != len(VARIABLES):
        raise ValueError("Unexpected wave message list")
    start, end = int(inventory[first][1]), int(inventory[last + 1][1]) - 1
    request = Request(url, headers={"Range": f"bytes={start}-{end}"})
    when = RUN + timedelta(hours=hour)
    fields = {}
    with TemporaryDirectory() as directory, urlopen(request, timeout=30) as response:
        if response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start}-{end}/"):
            raise ValueError("Unexpected GRIB byte range")
        path = Path(directory) / "waves.grib2"
        path.write_bytes(response.read())
        with pygrib.open(str(path)) as grib:
            for index, message in zip(selected, grib, strict=True):
                if message.analDate != RUN or message.validDate != when:
                    raise ValueError("Unexpected GFS-Wave valid time")
                lat, lon = message.latlons()
                step = 4
                # Fields in the archive start at 90 N and 0 E, one sample per degree.
                rows = np.argsort(lat[:, 0])[::-1][::step]
                cols = np.argsort(lon[0] % 360)[::step]
                if not np.allclose(lat[rows, 0], np.arange(90, -91, -1)) or not np.allclose(lon[0, cols] % 360, np.arange(360)):
                    raise ValueError("Unexpected GFS-Wave coordinate scan")
                grid = np.ma.asarray(message.values)[np.ix_(rows, cols)].filled(np.nan)
                name, scale = VARIABLES[inventory[index][3]]
                fields[name] = encode(grid, scale)
    header = {
        "lo1": 0, "la1": 90, "dx": 1, "dy": 1, "nx": 360, "ny": 181,
        "refTime": RUN.replace(tzinfo=timezone.utc).isoformat(),
        "forecastTime": hour, "centerName": "NOAA / NCEP GFS-Wave · 历史档案",
    }
    record = {"header": header, "source": url, **fields}
    (OUTPUT / f"20220322-{hour:02}.json").write_text(json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n")
    return hour


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(3) as pool:
        for hour in pool.map(build, HOURS):
            print(f"Archived GFS-Wave +{hour:02} h")
