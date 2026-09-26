#!/usr/bin/env python3
"""Convert user-provided GRACED NetCDF archives and import their daily frames.

The existing GRACED importer already defines the on-disk manifest and database
format.  This wrapper reuses its conversion routine but takes archives that are
already present locally, so it does not depend on the GRACED API certificate.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tarfile
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = REPO_ROOT.parent
ARCHIVE_RE = re.compile(r"^GRACED_(?P<sector>[A-Za-z]+)_y(?P<year>\d{4})_m(?P<month>\d{2})\.nc\.tar\.gz$")


def path_label(path: Path) -> str:
    """Keep workspace-relative paths when possible, otherwise retain an absolute path.

    User-provided archives may live on a separate server volume (for example
    ``D:\\zyz graced``).  The path is metadata only; frame files still have to
    be generated under the workspace so the importer can read them safely.
    """
    resolved = path.resolve()
    try:
        return resolved.relative_to(WORKSPACE_ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


def load_converter():
    path = SCRIPT_DIR / "sync-carbon-graced.py"
    spec = importlib.util.spec_from_file_location("sync_carbon_graced", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load converter: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def archive_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_size_label(size: int) -> str:
    value = float(size)
    for unit in ("B", "K", "M", "G"):
        if value < 1024 or unit == "G":
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{size}B"


def extract_netcdf(converter, archive: Path, work_dir: Path) -> Path:
    return converter.extract_netcdf(
        archive,
        work_dir,
        target_name="emission.nc",
        reuse_existing=False,
        quiet=True,
    )


def build_source(archive: Path, sector: str, month: str, archive_hash: str, official_id: int) -> dict:
    label = path_label(archive)
    return {
        "id": official_id,
        "department": sector,
        "dataTime": month,
        "fileName": archive.name,
        "fileSize": file_size_label(archive.stat().st_size),
        "ossAddress": "https://www.carbonmonitor-graced.com/",
        "apiUpdateTime": None,
        "archiveSha256": archive_hash,
        "localArchivePath": label,
        "localNetcdfPath": label,
    }


def write_manifest(converter, archive: Path, work_dir: Path, processed_dir: Path, source: dict, month: str) -> Path:
    netcdf = extract_netcdf(converter, archive, work_dir)
    manifest = converter.convert_frames(
        netcdf,
        processed_dir,
        source,
        WORKSPACE_ROOT,
        scratch_output=False,
        target_resolution=0.1,
        quiet=True,
    )
    # Keep the archive as the durable local source.  The NetCDF is an extracted
    # intermediate and is removed after the import to avoid ~0.8 GB per month.
    manifest["source"]["localNetcdfPath"] = path_label(archive)
    manifest_path = processed_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    netcdf.unlink(missing_ok=True)
    return manifest_path


def run_import(manifest_path: Path, skip_schema: bool) -> None:
    command = [sys.executable, str(SCRIPT_DIR / "import-carbon-graced.py"), "--manifest", str(manifest_path)]
    if skip_schema:
        command.append("--skip-schema")
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-dir", type=Path, default=WORKSPACE_ROOT / "graced data")
    parser.add_argument("--processed-root", type=Path, default=WORKSPACE_ROOT / "data" / "carbon-graced" / "processed")
    parser.add_argument("--work-root", type=Path, default=WORKSPACE_ROOT / "data" / "carbon-graced" / "work")
    parser.add_argument("--limit", type=int, default=0, help="Process at most this many archives (0 means all).")
    parser.add_argument("--skip-month", action="append", default=[], help="Skip a YYYY-MM archive already imported (repeatable).")
    parser.add_argument("--convert-only", action="store_true", help="Prepare manifests and frames without connecting to PostgreSQL.")
    parser.add_argument("--import-only", action="store_true", help="Import existing manifests without extracting or converting archives.")
    parser.add_argument("--keep-netcdf", action="store_true", help="Keep extracted NetCDF intermediates.")
    args = parser.parse_args()
    if args.convert_only and args.import_only:
        raise SystemExit("--convert-only and --import-only cannot be combined.")

    converter = load_converter()
    archives = []
    for path in sorted(args.archive_dir.glob("GRACED_*.nc.tar.gz")):
        match = ARCHIVE_RE.match(path.name)
        if not match:
            print(f"Skipping unrecognized filename: {path.name}", flush=True)
            continue
        sector = match.group("sector")
        if sector != "total":
            print(f"Skipping unsupported sector in local batch: {path.name}", flush=True)
            continue
        month = f"{match.group('year')}-{match.group('month')}"
        archives.append((path, sector, month))
    if args.limit > 0:
        archives = archives[: args.limit]
    if not archives:
        raise SystemExit("No matching local GRACED archives found.")

    skip_months = set(args.skip_month)
    archives = [item for item in archives if item[2] not in skip_months]
    for index, (archive, sector, month) in enumerate(archives, 1):
        # IDs are deterministic and outside the official IDs already present in
        # the database.  source_attributes records that these are user-provided
        # local archives, rather than an invented official API identifier.
        official_id = 900_000_000 + int(month.replace("-", ""))
        processed_dir = (args.processed_root / sector / month).resolve()
        work_dir = (args.work_root / sector / month).resolve()
        manifest_path = processed_dir / "manifest.json"
        if args.import_only:
            manifest_path = processed_dir / "manifest.json"
            if not manifest_path.exists():
                raise FileNotFoundError(f"Existing manifest missing: {manifest_path}")
            print(f"[{index}/{len(archives)}] Importing existing {sector}/{month}", flush=True)
        else:
            print(f"[{index}/{len(archives)}] Preparing {sector}/{month}: {archive.name}", flush=True)
            source_hash = archive_sha256(archive)
            source = build_source(archive, sector, month, source_hash, official_id)
            manifest_path = write_manifest(converter, archive, work_dir, processed_dir, source, month)
        if not args.convert_only:
            run_import(manifest_path, skip_schema=index > 1)
        if not args.keep_netcdf:
            # write_manifest removes the extracted file; this is a guard for a
            # failed conversion that left a completed intermediate behind.
            for candidate in work_dir.glob("*.nc"):
                candidate.unlink(missing_ok=True)
        action = "Prepared" if args.convert_only else "Imported"
        print(f"[{index}/{len(archives)}] {action} {sector}/{month}", flush=True)


if __name__ == "__main__":
    main()
