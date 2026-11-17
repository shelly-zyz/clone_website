"""Extract regional 10 m wind from an operator-supplied GRIB or NetCDF file."""

import argparse
from datetime import datetime, timezone
from hashlib import file_digest
from functools import partial
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

CF_NAMES = (
    ("10m_u_component_of_wind", "u10", "10u"),
    ("10m_v_component_of_wind", "v10", "10v"),
)
GRIB_NAMES = (("10u", "u10"), ("10v", "v10"))


def instant(value):
    if not isinstance(value, datetime):
        value = datetime.fromisoformat(str(value).strip().replace("_", "T"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def iso(value):
    return instant(value).isoformat().replace("+00:00", "Z")


def digest(path):
    with path.open("rb") as source:
        return file_digest(source, "sha256").hexdigest()


def as_grid(values):
    return np.ma.asarray(values, dtype=np.float64).filled(np.nan)


def meters_per_second(unit):
    if str(unit).strip() not in ("m s-1", "m/s", "m s**-1", "m s^-1", "m s^(-1)", "meter / second"):
        raise ValueError(f"Expected horizontal wind in m/s, found {unit!r}")


def wind_point(time, eastward, northward, latitudes, longitudes, bounds):
    u, v = as_grid(eastward), as_grid(northward)
    lat, lon = as_grid(latitudes), as_grid(longitudes)
    if u.ndim == 2 and lat.ndim == lon.ndim == 1:
        lon, lat = np.meshgrid(lon, lat)
    if not u.shape == v.shape == lat.shape == lon.shape or u.ndim not in (1, 2):
        raise ValueError("Wind components and coordinates must describe the same grid")
    west, south, east, north = bounds
    wrapped = (lon + 180) % 360 - 180
    normalized = np.where((wrapped == -180) & (west > -180), 180, wrapped)
    selected = np.isfinite(lat) & np.isfinite(lon) & (lat >= south) & (lat <= north) & (
        normalized >= west) & (normalized <= east)
    total = int(np.count_nonzero(selected))
    if not total:
        raise ValueError("The source grid has no cell centers in the requested region")
    valid = selected & np.isfinite(u) & np.isfinite(v)
    count = int(np.count_nonzero(valid))
    return {"valid_time": iso(time), "value": round(float(np.hypot(u[valid], v[valid]).mean()), 8) if count else None,
            "valid_cells": count, "total_cells": total}


def wrf_frames(path, issue):
    from netCDF4 import Dataset, chartostring

    with Dataset(path) as source:
        if "WRF" not in getattr(source, "TITLE", ""):
            raise ValueError("Native WRF NetCDF must identify WRF in TITLE")
        if "START_DATE" not in source.ncattrs() or instant(source.START_DATE) != issue:
            raise ValueError("WRF START_DATE must match the declared UTC issue time")
        times = chartostring(source.variables["Times"][:])
        u, v = [source.variables[name] for name in ("U10", "V10")]
        lat, lon = [source.variables[name] for name in ("XLAT", "XLONG")]
        for component in (u, v):
            meters_per_second(component.units)
            if component.dimensions != ("Time", "south_north", "west_east") or len(times) != component.shape[0]:
                raise ValueError("Expected native WRF U10/V10 Time × south_north × west_east arrays")
        if len(times) > 120:
            raise ValueError("An import may contain up to 120 valid times")
        for index, time in enumerate(times):
            yield time, u[index], v[index], lat[index] if lat.ndim == 3 else lat[:], lon[index] if lon.ndim == 3 else lon[:]


def cf_times(cube, issue, require_reference):
    time = cube.coord("time")
    references = cube.coords("forecast_reference_time")
    if len(references) > 1 or (require_reference and not references) or (
            references and any(instant(value) != issue for value in references[0].units.num2date(references[0].points))):
        raise ValueError("CF forecast_reference_time must match the declared UTC issue time")
    return time


def cf_component(cube, issue, require_reference):
    cube.convert_units("m/s")
    time = cf_times(cube, issue, require_reference)
    lat, lon = cube.coord("latitude"), cube.coord("longitude")
    lat.convert_units("degrees")
    lon.convert_units("degrees")
    time_dimensions = cube.coord_dims(time)
    lat_dims, lon_dims = cube.coord_dims(lat), cube.coord_dims(lon)
    if len(time_dimensions) > 1 or len(time.points) > 120:
        raise ValueError("Unsupported CF forecast time axis")
    spatial = [dim for dim in range(cube.ndim) if dim not in time_dimensions]
    if lat.ndim == lon.ndim == 1:
        if len(spatial) != 2 or lat_dims == lon_dims or set(lat_dims + lon_dims) != set(spatial):
            raise ValueError("Expected independent CF latitude and longitude axes")
        axes = [spatial.index(lat_dims[0]), spatial.index(lon_dims[0])]
    elif lat.ndim == lon.ndim == 2 and tuple(spatial) == lat_dims == lon_dims:
        axes = [0, 1]
    else:
        raise ValueError("Expected matching CF latitude and longitude coordinates")
    for index, date in enumerate(time.units.num2date(time.points)):
        selector = [slice(None)] * cube.ndim
        if time_dimensions:
            selector[time_dimensions[0]] = index
        subset = cube[tuple(selector)]
        yield instant(date), np.transpose(subset.data, axes), lat.points, lon.points


def load_wind_cubes(path):
    import iris

    cubes = iris.load(str(path))
    selected = [[cube for cube in cubes if cube.var_name in aliases] for aliases in CF_NAMES]
    if any(len(matches) != 1 for matches in selected):
        raise ValueError("CF NetCDF must contain exactly one named 10 m U and V wind variable")
    return [matches[0] for matches in selected]


def iris_frames(path, issue, require_reference):
    u, v = load_wind_cubes(path)
    components = (cf_component(cube, issue, require_reference) for cube in (u, v))
    for left, right in zip(*components, strict=True):
        time, values, lat, lon = left
        if time != right[0] or not np.array_equal(lat, right[2]) or not np.array_equal(lon, right[3]):
            raise ValueError("CF wind components have different valid times or grids")
        yield time, values, right[1], lat, lon


def pygrib_values(field):
    return field.values, field.latlons()


def pygrib_messages(path):
    import pygrib

    with pygrib.open(str(path)) as source:
        for field in source:
            if field.shortName in GRIB_NAMES[0] + GRIB_NAMES[1] and field.typeOfLevel == "heightAboveGround" and field.level == 10:
                yield field.shortName, field.analDate, field.validDate, field.units, partial(pygrib_values, field)


def earthkit_values(field):
    geography = field.geography
    coords = geography.latitudes().ravel(), geography.longitudes().ravel()
    return field.to_numpy(flatten=True), coords


def earthkit_messages(path):
    import earthkit.data

    for field in earthkit.data.from_source("file", str(path)).to_fieldlist():
        name = field.get("parameter.variable", default=None)
        if name not in GRIB_NAMES[0] + GRIB_NAMES[1]:
            continue
        if field.get("metadata.typeOfLevel", default=None) != "heightAboveGround" or field.get("metadata.level", default=None) != 10:
            continue
        times = field.get(collections="time")
        yield name, times["base_datetime"], times["valid_datetime"], field.get("parameter.units"), partial(earthkit_values, field)


def grib_frames(path, issue, reader):
    messages = pygrib_messages(path) if reader == "pygrib" else earthkit_messages(path)
    fields = {}
    for name, base, valid, unit, load in messages:
        if instant(base) != issue:
            continue
        meters_per_second(unit)
        date = instant(valid)
        component = 0 if name in GRIB_NAMES[0] else 1
        pair = fields.setdefault(date, {})
        if component in pair:
            raise ValueError("GRIB has duplicate 10 m wind components for the same valid time")
        pair[component] = load
        if len(fields) > 120:
            raise ValueError("An import may contain up to 120 valid times")
    for date, pair in sorted(fields.items()):
        if pair.keys() != {0, 1}:
            raise ValueError("GRIB must contain matching 10 m U and V messages")
        u, (lat, lon) = pair[0]()
        v, (vlat, vlon) = pair[1]()
        if not np.array_equal(lat, vlat) or not np.array_equal(lon, vlon):
            raise ValueError("GRIB wind components have different grids")
        yield date, u, v, lat, lon


def extract(path, args, issue, require_reference=True):
    if args.reader == "netcdf4":
        frames, variables = wrf_frames(path, issue), ["U10", "V10"]
    elif args.reader == "iris":
        frames, variables = iris_frames(path, issue, require_reference), ["10m_u_component_of_wind", "10m_v_component_of_wind"]
    else:
        frames, variables = grib_frames(path, issue, args.reader), ["10u", "10v"]
    points = sorted((wind_point(*frame, args.bounds) for frame in frames), key=lambda point: instant(point["valid_time"]))
    if not points or len(points) > 120 or not any(point["value"] is not None for point in points):
        raise ValueError("Expected 1–120 frames with at least one usable wind value")
    if len({point["valid_time"] for point in points}) != len(points) or instant(points[0]["valid_time"]) < issue:
        raise ValueError("Valid times must be unique and on or after the forecast issue")
    return points, variables


def preprocess(source, args, temporary):
    if not args.cdo_crop and args.grid_step is None:
        return source
    if args.reader == "netcdf4":
        raise ValueError("Use native WRF extraction for curvilinear wrfout files")
    west, south, east, north = args.bounds
    operators = []
    if args.grid_step is not None:
        step = args.grid_step
        if not np.isfinite(step) or step <= 0:
            raise ValueError("Expected a positive finite grid step")
        cols, rows = int((east - west) / step), int((north - south) / step)
        if min(cols, rows) < 1 or cols * rows > 1_000_000:
            raise ValueError("Expected a positive grid step and up to one million target cells")
        grid = temporary / "target-grid.txt"
        grid.write_text(f"gridtype = lonlat\nxsize = {cols}\nysize = {rows}\nxfirst = {west + step / 2}\n"
                        f"yfirst = {south + step / 2}\nxinc = {step}\nyinc = {step}\n", encoding="ascii")
        operators.append(f"remapbil,{grid}")
    if args.cdo_crop and args.grid_step is None:
        operators.append(f"sellonlatbox,{west},{east},{south},{north}")
    output = temporary / ("subset.nc" if args.reader == "iris" else "subset.grib")
    subprocess.run(["cdo", "-O", *[f"-{op}" for op in operators], str(source), str(output)], check=True, timeout=240)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--reader", required=True, choices=["netcdf4", "iris", "pygrib", "earthkit-data"])
    parser.add_argument("--bounds", required=True, type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--issue", required=True)
    cdo = parser.add_mutually_exclusive_group()
    cdo.add_argument("--cdo-crop", action="store_true")
    cdo.add_argument("--grid-step", type=float)
    args = parser.parse_args()
    source = args.file.resolve(strict=True)
    west, south, east, north = args.bounds
    if not source.is_file() or not -180 <= west < east <= 180 or not -90 <= south < north <= 90:
        raise ValueError("A local file and valid west/south/east/north bounds are required")
    issue = instant(args.issue)
    checksum = digest(source)
    original_times = None
    if args.reader == "iris" and (args.cdo_crop or args.grid_step is not None):
        # CDO may drop scalar CF auxiliary coordinates. Verify each original variable
        # before running CDO and require the processed valid times to remain identical.
        time_axes = [cf_times(cube, issue, True) for cube in load_wind_cubes(source)]
        original_times = sorted(iso(value) for value in time_axes[0].units.num2date(time_axes[0].points))
        if original_times != sorted(iso(value) for value in time_axes[1].units.num2date(time_axes[1].points)):
            raise ValueError("CF wind components have different valid times")
    with tempfile.TemporaryDirectory(prefix="ogw-weather-") as temporary:
        prepared = preprocess(source, args, Path(temporary))
        points, variables = extract(prepared, args, issue, require_reference=original_times is None)
    if original_times is not None and [point["valid_time"] for point in points] != original_times:
        raise ValueError("CDO changed the source valid times")
    if digest(source) != checksum:
        raise ValueError("The source file changed during extraction")
    print(json.dumps({"file_sha256": checksum, "file_metadata": {
        "reader": args.reader, "variables": variables, "unit": "m/s",
        "selected_cells": max(point["total_cells"] for point in points), "frame_count": len(points),
        "first_valid_time": points[0]["valid_time"], "last_valid_time": points[-1]["valid_time"],
        "cdo_crop": args.cdo_crop, "grid_step": args.grid_step,
    }, "points": points}, allow_nan=False))


if __name__ == "__main__":
    main()
