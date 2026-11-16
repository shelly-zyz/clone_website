"""Grid the NOAA KHGX Level-II archive and derive display isosurfaces."""
from pathlib import Path
import argparse
import base64
import hashlib
import json

import numpy as np
import pyart
from skimage.measure import marching_cubes

SOURCE = "https://unidata-nexrad-level2.s3.amazonaws.com/2022/03/22/KHGX/KHGX20220322_120125_V06"


def encode(data, kind):
    return base64.b64encode(data.astype(kind).tobytes()).decode()


def build(raw):
    radar = pyart.io.read_nexrad_archive(str(raw))
    gate = pyart.filters.GateFilter(radar)
    gate.exclude_invalid("reflectivity")
    gate.exclude_masked("reflectivity")
    gate.exclude_outside("reflectivity", -15, 85)
    grid = pyart.map.grid_from_radars(
        [radar], grid_shape=(19, 91, 91),
        grid_limits=((0, 18000), (-90000, 90000), (-90000, 90000)),
        fields=["reflectivity"], gatefilters=[gate], grid_origin_alt=0,
        weighting_function="Barnes2", min_radius=700, roi_func="dist_beam",
    )
    reflectivity = grid.fields["reflectivity"]["data"]
    missing = np.ma.getmaskarray(reflectivity)
    valid = ~missing
    values = reflectivity.filled(-128)
    if not valid.sum() or np.count_nonzero(values >= 50) < 20:
        raise ValueError("The archive grid has insufficient reflectivity volume")
    alt = grid.z["data"] / 1000
    north = grid.y["data"] / 1000
    east = grid.x["data"] / 1000
    meshes = []
    for dbz in [20, 35, 50]:
        vertices, faces, _, _ = marching_cubes(values, level=dbz, spacing=(1, 2, 2),
                                                step_size=1, allow_degenerate=False, mask=valid)
        points = np.stack((vertices[:, 2] + east[0], vertices[:, 0] + alt[0], -(vertices[:, 1] + north[0])), axis=1)
        meshes.append({"dbz": dbz, "vertices": encode(np.round(points * 100), "<i2"), "faces": encode(faces, "<u4")})
    return {
        "schema": 1, "site": "KHGX", "time": "2022-03-22T12:01:25Z",
        "source": SOURCE, "sha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
        "longitude": float(grid.origin_longitude["data"][0]), "latitude": float(grid.origin_latitude["data"][0]),
        "elevations": radar.fixed_angle["data"].tolist(), "x": east.tolist(), "y": north.tolist(), "z": alt.tolist(),
        "values": encode(np.round(values), "i1"), "meshes": meshes,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("level2", type=Path)
    parser.add_argument("output", type=Path)
    options = parser.parse_args()
    options.output.write_text(json.dumps(build(options.level2), separators=(",", ":")) + "\n")
