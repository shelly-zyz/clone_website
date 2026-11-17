"""Pack Ember's public generation CSVs without filling absent values."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

FIELDS = ("Total generation", "Coal", "Gas", "Other fossil", "Bioenergy",
          "Hydro", "Nuclear", "Wind", "Solar", "Clean", "Wind and solar")
PROVINCES = set("AH BJ CN CQ FJ GS GD GX GZ HI HE HL HA HB HN NM JS JX JL LN NX QH SN SD SH SX SC TJ XZ XJ YN ZJ".split())

def pack(path, column, release):
    result = {}
    seen = set()
    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            fuel = row["Electricity source"]
            if fuel not in FIELDS:
                continue
            period = row[column][:7]
            code = row["Province code"]
            key = (period, code, fuel)
            if key in seen or code not in PROVINCES:
                raise ValueError(f"Unexpected observation: {key}")
            seen.add(key)
            raw = row["Generation (TWh)"]
            value = float(raw) if raw else None
            if value is not None and (not math.isfinite(value) or value < 0):
                raise ValueError(f"Invalid generation at {key}: {raw}")
            if value is not None and value.is_integer():
                value = int(value)
            result.setdefault(period, {}).setdefault(code, [None] * len(FIELDS))[FIELDS.index(fuel)] = value
    if not result or set().union(*(set(frame) for frame in result.values())) != PROVINCES:
        raise ValueError(f"Input {path} does not include all expected regions")
    return {
        "release": release,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "fields": FIELDS,
        "periods": dict(sorted(result.items())),
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("yearly", type=Path)
    parser.add_argument("monthly", type=Path)
    parser.add_argument("--release", required=True, help="Publication date shown on Ember's dataset page")
    parser.add_argument("--output", type=Path, default=Path("public/data/china-power"))
    args = parser.parse_args()
    results = [("annual", pack(args.yearly, "Year", args.release)), ("monthly", pack(args.monthly, "Date", args.release))]
    for label, result in results:
        path = args.output / f"ember-{label}.json"
        with path.open("w", encoding="utf-8") as output:
            metadata = {key: value for key, value in result.items() if key != "periods"}
            output.write(json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))[:-1] + ',"periods":{\n')
            output.write(",\n".join(json.dumps(period) + ":" + json.dumps(rows, separators=(",", ":"))
                                    for period, rows in result["periods"].items()))
            output.write("\n}}\n")
        print(path, len(result["periods"]), "periods")
