#!/usr/bin/env python3
"""Download and convert one GRACED monthly archive into database-ready daily frames."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import re
import shutil
import tarfile
import time
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
        "--scratch-output",
        action="store_true",
        help=(
            "Reuse fixed per-sector output paths for bulk database backfills. "
            "This keeps only one archive, one NetCDF, and up to 31 frame files per sector."
        ),
    )
    parser.add_argument(
        "--single-scratch-slot",
        action="store_true",
        help=(
            "When used with --scratch-output, reuse one global scratch slot across all sectors. "
            "This minimizes local disk usage during long database backfills."
        ),
    )
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="Fetch and print archive metadata without downloading it.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress progress output for background database backfills.",
    )
    parser.add_argument(
        "--target-resolution",
        type=float,
        default=0.1,
        help=(
            "Output grid resolution in degrees. Keep 0.1 for source visualization; "
            "aggregate separately when building prediction features."
        ),
    )
    return parser.parse_args()


def request_json(url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, 5):
        data = None
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            url,
            data=data,
            headers=headers,
            method="POST" if data else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except Exception as error:
            last_error = error
            if attempt < 4:
                time.sleep(attempt * 3)
    raise RuntimeError(f"GRACED API request failed after 4 attempts: {last_error}")


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


def download_file(url: str, target: Path, force: bool, quiet: bool = False) -> None:
    if target.exists() and not force:
        if not quiet:
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
            if expected and not quiet:
                print(f"\rDownloaded {copied / 1024 / 1024:.1f}/{expected / 1024 / 1024:.1f} MiB", end="")
    if not quiet:
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


def extract_netcdf(
    archive_path: Path,
    work_dir: Path,
    target_name: str | None = None,
    reuse_existing: bool = True,
    quiet: bool = False,
) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "r:gz") as archive:
        member = safe_netcdf_member(archive)
        target = work_dir / (target_name or Path(member.name).name)
        if reuse_existing and target.exists() and target.stat().st_size == member.size:
            if not quiet:
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
    scratch_output: bool = False,
    target_resolution: float = 0.1,
    quiet: bool = False,
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

        source_dx = float(longitudes[1] - longitudes[0])
        source_dy = float(abs(latitudes[1] - latitudes[0]))
        aggregation_factor = int(round(target_resolution / source_dx))
        if (
            not math.isclose(source_dx, source_dy, rel_tol=0, abs_tol=1e-8)
            or aggregation_factor < 1
            or not math.isclose(
                source_dx * aggregation_factor,
                target_resolution,
                rel_tol=0,
                abs_tol=1e-8,
            )
            or longitudes.size % aggregation_factor != 0
            or latitudes.size % aggregation_factor != 0
        ):
            raise RuntimeError(
                f"Cannot aggregate {source_dx}° source grid to {target_resolution}°.",
            )

        grid = {
            "width": int(longitudes.size // aggregation_factor),
            "height": int(latitudes.size // aggregation_factor),
            "longitudeMin": json_number(longitudes[0]),
            "latitudeMax": json_number(latitudes[0]),
            "dx": json_number(target_resolution),
            "dy": json_number(target_resolution),
            "sourceResolutionDeg": json_number(source_dx),
            "aggregationFactor": aggregation_factor,
            "aggregationMethod": "sum",
        }

        for index, timestamp in enumerate(timestamps):
            frame_date = np.datetime_as_string(timestamp, unit="D")
            values = np.asarray(emission.isel(nday=index).values, dtype="<f4")
            values = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)
            values[values < 0] = 0
            if aggregation_factor > 1:
                values = values.reshape(
                    grid["height"],
                    aggregation_factor,
                    grid["width"],
                    aggregation_factor,
                ).sum(axis=(1, 3), dtype=np.float64)
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
            frame_file_name = (
                f"{int(frame_date[-2:]):02d}.f32.gz"
                if scratch_output
                else f"{frame_date}.f32.gz"
            )
            frame_path = output_dir / frame_file_name
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
            if not quiet:
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
    if not args.quiet:
        print(json.dumps(public_metadata, ensure_ascii=False, indent=2))
    if args.metadata_only:
        return

    if args.scratch_output:
        scratch_key = "_current" if args.single_scratch_slot else args.sector
        archive_path = output_root / "scratch" / scratch_key / "archive.nc.tar.gz"
        work_dir = output_root / "scratch" / scratch_key / "work"
        processed_dir = output_root / "scratch" / scratch_key / "processed"
    else:
        archive_path = output_root / "raw" / args.sector / metadata["fileName"]
        work_dir = output_root / "work" / args.sector / metadata["dataTime"]
        processed_dir = output_root / "processed" / args.sector / metadata["dataTime"]

    download_file(
        metadata["ossAddress"],
        archive_path,
        args.force_download or args.scratch_output,
        quiet=args.quiet,
    )
    netcdf_path = extract_netcdf(
        archive_path,
        work_dir,
        "emission.nc" if args.scratch_output else None,
        reuse_existing=not args.scratch_output,
        quiet=args.quiet,
    )
    metadata["archiveSha256"] = sha256_file(archive_path)
    metadata["localArchivePath"] = archive_path.relative_to(workspace_root).as_posix()
    metadata["localNetcdfPath"] = netcdf_path.relative_to(workspace_root).as_posix()

    manifest = convert_frames(
        netcdf_path,
        processed_dir,
        metadata,
        workspace_root,
        scratch_output=args.scratch_output,
        target_resolution=args.target_resolution,
        quiet=args.quiet,
    )
    manifest_path = processed_dir / "manifest.json"
    partial = manifest_path.with_name(f"{manifest_path.name}.part")
    partial.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(partial, manifest_path)
    if not args.quiet:
        print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
