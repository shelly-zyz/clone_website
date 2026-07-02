#!/usr/bin/env python3
"""Download and convert one GRACED monthly archive into database-ready daily frames."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import tarfile
import urllib.request
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
import xarray as xr


API_ROOT = "https://carbonmonitor-graced.com"
MONTH_ENDPOINT = f"{API_ROOT}/api/data/month"
SECTORS = (
    "total",
    "Power",
    "Industry",
    "Residential",
    "GroundTransportation",
    "InternationalAviation",
    "InternationalShipping",
    "DomesticAviation",
)
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
USER_AGENT = "OpenGridWorks-GRACED-Sync/1.0"


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    workspace_root = script_dir.parent.parent
    parser = argparse.ArgumentParser(
        description="Download a GRACED month and convert it to gzip-compressed Float32 daily frames.",
    )
    parser.add_argument("--sector", choices=SECTORS, default="total")
    parser.add_argument(
        "--month",
        help="Month in YYYY-MM form. Defaults to the latest available month.",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=workspace_root / "data" / "carbon-graced",
    )
    parser.add_argument("--force-download", action="store_true")
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="Fetch and print archive metadata without downloading it.",
    )
    return parser.parse_args()


def request_json(url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def archive_metadata(sector: str, month: str | None) -> dict[str, Any]:
    payload = request_json(MONTH_ENDPOINT, {"department": sector, "dataType": 0})
    if not payload.get("success") or not isinstance(payload.get("data"), list):
        raise RuntimeError(payload.get("message") or "GRACED metadata request failed.")

    candidates = [
        item
        for item in payload["data"]
        if isinstance(item, dict)
        and str(item.get("fileName", "")).startswith("GRACED")
        and str(item.get("fileName", "")).endswith(".nc.tar.gz")
        and (month is None or item.get("dataTime") == month)
    ]
    if not candidates:
        label = month or "latest"
        raise RuntimeError(f"No GRACED archive found for {sector} / {label}.")
    candidates.sort(key=lambda item: (str(item.get("dataTime", "")), int(item.get("id", 0))))
    return candidates[-1]


def download_file(url: str, target: Path, force: bool) -> None:
    if target.exists() and not force:
        print(f"Using cached archive: {target}")
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f"{target.name}.part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as output:
        expected = int(response.headers.get("Content-Length", "0"))
        copied = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            copied += len(chunk)
            if expected:
                print(f"\rDownloaded {copied / 1024 / 1024:.1f}/{expected / 1024 / 1024:.1f} MiB", end="")
    print()
    if expected and partial.stat().st_size != expected:
        raise RuntimeError(f"Incomplete download: expected {expected} bytes, got {partial.stat().st_size}.")
    os.replace(partial, target)


def safe_netcdf_member(archive: tarfile.TarFile) -> tarfile.TarInfo:
    members = [member for member in archive.getmembers() if member.isfile() and member.name.endswith(".nc")]
    if len(members) != 1:
        raise RuntimeError(f"Expected one NetCDF file, found {len(members)}.")
    member = members[0]
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeError(f"Unsafe archive member path: {member.name}")
    return member


def extract_netcdf(archive_path: Path, work_dir: Path) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "r:gz") as archive:
        member = safe_netcdf_member(archive)
        target = work_dir / Path(member.name).name
        if target.exists() and target.stat().st_size == member.size:
            print(f"Using extracted NetCDF: {target}")
            return target
        source = archive.extractfile(member)
        if source is None:
            raise RuntimeError(f"Could not read {member.name} from archive.")
        partial = target.with_name(f"{target.name}.part")
        with source, partial.open("wb") as output:
            shutil.copyfileobj(source, output, length=1024 * 1024)
        os.replace(partial, target)
        return target


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_number(value: float) -> float:
    return round(float(value), 8)


def convert_frames(
    netcdf_path: Path,
    output_dir: Path,
    source: dict[str, Any],
    workspace_root: Path,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    frames: list[dict[str, Any]] = []

    with xr.open_dataset(netcdf_path) as dataset:
        if "emission" not in dataset:
            raise RuntimeError("NetCDF does not contain an emission variable.")
        emission = dataset["emission"]
        expected_dims = ("nday", "latitude", "longitude")
        if emission.dims != expected_dims:
            raise RuntimeError(f"Unexpected emission dimensions: {emission.dims}")

        latitudes = np.asarray(dataset["latitude"].values)
        longitudes = np.asarray(dataset["longitude"].values)
        timestamps = np.asarray(dataset["nday"].values)
        if latitudes.size < 2 or longitudes.size < 2:
            raise RuntimeError("GRACED coordinate arrays are incomplete.")

        grid = {
            "width": int(longitudes.size),
            "height": int(latitudes.size),
            "longitudeMin": json_number(longitudes[0]),
            "latitudeMax": json_number(latitudes[0]),
            "dx": json_number(longitudes[1] - longitudes[0]),
            "dy": json_number(abs(latitudes[1] - latitudes[0])),
        }

        for index, timestamp in enumerate(timestamps):
            frame_date = np.datetime_as_string(timestamp, unit="D")
            values = np.asarray(emission.isel(nday=index).values, dtype="<f4")
            values = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)
            values[values < 0] = 0
            values = np.ascontiguousarray(values, dtype="<f4")
            positive = values[values > 0]
            quantiles = (
                np.quantile(positive, (0.5, 0.9, 0.95, 0.99, 0.999))
                if positive.size
                else np.zeros(5, dtype=np.float64)
            )
            stats = {
                "min": json_number(positive.min()) if positive.size else 0,
                "max": json_number(values.max()),
                "mean": json_number(values.mean(dtype=np.float64)),
                "sumKgCPerHour": json_number(values.sum(dtype=np.float64)),
                "nonzeroCount": int(positive.size),
                "nonzeroPercent": json_number(positive.size / values.size * 100),
                "p50": json_number(quantiles[0]),
                "p90": json_number(quantiles[1]),
                "p95": json_number(quantiles[2]),
                "p99": json_number(quantiles[3]),
                "p999": json_number(quantiles[4]),
            }
            compressed = gzip.compress(values.tobytes(order="C"), compresslevel=6, mtime=0)
            frame_path = output_dir / f"{frame_date}.f32.gz"
            partial = frame_path.with_name(f"{frame_path.name}.part")
            partial.write_bytes(compressed)
            os.replace(partial, frame_path)
            frame_sha256 = hashlib.sha256(compressed).hexdigest()
            frames.append(
                {
                    "date": frame_date,
                    "path": frame_path.relative_to(workspace_root).as_posix(),
                    "sizeBytes": len(compressed),
                    "sha256": frame_sha256,
                    "stats": stats,
                }
            )
            print(
                f"Prepared {frame_date}: {len(compressed) / 1024:.1f} KiB, "
                f"{positive.size:,} non-zero cells",
            )

        attributes = {
            key: str(value)
            for key, value in dataset.attrs.items()
            if key.startswith("citation_") or key in {"unit", "website"}
        }

    return {
        "formatVersion": 1,
        "generatedAt": date.today().isoformat(),
        "sector": source["department"],
        "month": source["dataTime"],
        "unit": attributes.get("unit", "kgC/h"),
        "encoding": {
            "dtype": "float32",
            "byteOrder": "little-endian",
            "compression": "gzip",
            "missingValue": 0,
        },
        "grid": grid,
        "source": {
            "officialId": int(source["id"]),
            "fileName": source["fileName"],
            "fileSizeLabel": source.get("fileSize"),
            "url": source["ossAddress"],
            "apiUpdatedAt": source.get("apiUpdateTime"),
            "archiveSha256": source["archiveSha256"],
            "localArchivePath": source["localArchivePath"],
            "localNetcdfPath": source["localNetcdfPath"],
            "attributes": attributes,
        },
        "frames": frames,
    }


def main() -> None:
    args = parse_args()
    if args.month and not MONTH_PATTERN.match(args.month):
        raise SystemExit("--month must use YYYY-MM format.")

    output_root = args.output_root.resolve()
    workspace_root = Path(__file__).resolve().parent.parent.parent
    metadata = archive_metadata(args.sector, args.month)
    public_metadata = {
        key: metadata.get(key)
        for key in ("id", "dataTime", "department", "fileName", "fileSize", "apiUpdateTime")
    }
    print(json.dumps(public_metadata, ensure_ascii=False, indent=2))
    if args.metadata_only:
        return

    archive_path = output_root / "raw" / args.sector / metadata["fileName"]
    download_file(metadata["ossAddress"], archive_path, args.force_download)
    netcdf_path = extract_netcdf(
        archive_path,
        output_root / "work" / args.sector / metadata["dataTime"],
    )
    metadata["archiveSha256"] = sha256_file(archive_path)
    metadata["localArchivePath"] = archive_path.relative_to(workspace_root).as_posix()
    metadata["localNetcdfPath"] = netcdf_path.relative_to(workspace_root).as_posix()

    processed_dir = output_root / "processed" / args.sector / metadata["dataTime"]
    manifest = convert_frames(netcdf_path, processed_dir, metadata, workspace_root)
    manifest_path = processed_dir / "manifest.json"
    partial = manifest_path.with_name(f"{manifest_path.name}.part")
    partial.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(partial, manifest_path)
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
