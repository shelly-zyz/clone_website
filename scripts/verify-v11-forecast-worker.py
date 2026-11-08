"""Exercise the real StatsForecast package and optionally backtest the project's GRACED file."""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import runpy
import subprocess
import sys
import time


def check(operation, source, horizon=3, **options):
    plan = {"operation": operation, "model": "statsforecast", "horizon": horizon,
            "horizonUnit": source["grain"], **options}
    started = time.monotonic()
    proc = subprocess.run([sys.executable, str(Path(__file__).with_name("analysis-models.py"))],
                          input=json.dumps({"plan": plan, "input": source}), capture_output=True,
                          text=True, check=True, timeout=170)
    output = json.loads(proc.stdout)
    if "result" not in output:
        raise AssertionError((output, proc.stderr[-600:]))
    return output["result"], round(time.monotonic() - started, 2)


def monthly_fixture():
    return {
        "grain": "month", "unit": "GWh", "metric": "Synthetic monthly generation",
        "observations": [{"date": datetime(2021 + i // 12, 1 + i % 12, 1, tzinfo=timezone.utc).isoformat(),
                          "value": 500 + 5 * i + [0, 3, 7, 5, 2, -2, 9, 18, 25, 8, 12, 16][i % 12]}
                         for i in range(48)],
    }


def graced_file(path):
    from netCDF4 import Dataset, num2date
    import numpy as np

    with Dataset(path) as dataset:
        assert dataset.unit == "kgC/h"
        field = dataset["emission"]
        assert field.dimensions == ("nday", "latitude", "longitude")
        day = dataset["nday"]
        dates = num2date(day[:], day.units, only_use_cftime_datetimes=False)
        observations = []
        for index, date in enumerate(dates):
            values = np.asarray(np.ma.filled(field[index], 0), dtype="<f4")
            np.nan_to_num(values, copy=False, nan=0.0, posinf=0.0, neginf=0.0)
            values[values < 0] = 0
            observations.append({"date": datetime(date.year, date.month, date.day, tzinfo=timezone.utc).isoformat(),
                                 "value": float(values.sum(dtype=np.float64))})
    return {"grain": "day", "unit": "kgC/h", "metric": "GRACED Power 全球日帧格点速率合计", "observations": observations}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--graced", help="Optional local GRACED NetCDF; used read-only")
    args = parser.parse_args()

    source = monthly_fixture()
    selection, elapsed = check("select_model", source)
    result = selection["model_selection"]
    assert result["folds"] == 3 and len(result["cutoffs"]) == 3
    assert all(candidate["status"] == "ok" for candidate in result["candidates"]), result
    assert result["selected_method"] in ("AutoARIMA", "AutoETS"), result
    print(json.dumps({"fixture": "synthetic_monthly", "operation": "select_model", "seconds": elapsed, **result}))
    forecast, elapsed = check("forecast", source, strategy="auto")
    assert forecast["training_rows"] == 48 and len(forecast["points"]) == 3
    assert forecast["model"]["method"] == result["selected_method"]
    print(json.dumps({"fixture": "synthetic_monthly", "operation": "forecast", "seconds": elapsed, "model": forecast["model"]}))

    if args.graced:
        source = graced_file(args.graced)
        baseline, elapsed = check("backtest", source, horizon=2)
        assert baseline["training_rows"] == len(source["observations"]) - 2 and len(baseline["points"]) == 2
        assert datetime.fromisoformat(baseline["training_end"]) + timedelta(days=1) == datetime.fromisoformat(baseline["points"][0]["date"])
        selection, selection_elapsed = check("select_model", source, horizon=2)
        independent = {**source, "observations": source["observations"][:-1]}
        independent_selection, _ = check("select_model", independent, horizon=2)
        winner = independent_selection["model_selection"]["selected_method"]
        predict = runpy.run_path(str(Path(__file__).with_name("analysis-models.py")))["predict"]
        history = [point["value"] for point in independent["observations"]]
        fitted, _, _ = predict("statsforecast", history, 1, "day", winner)
        naive, _, _ = predict("statsforecast", history, 1, "day")
        actual = source["observations"][-1]["value"]
        print(json.dumps({"fixture": "local_graced_daily", "observations": len(source["observations"]), "unit": source["unit"],
                          "start": source["observations"][0]["date"], "end": source["observations"][-1]["date"],
                          "holdout": baseline["evaluation"], "baseline_seconds": elapsed, "selection_seconds": selection_elapsed,
                          "independent_final_day": {"selected_method": winner, "absolute_error": abs(float(fitted[0]) - actual),
                                                    "seasonal_naive_absolute_error": abs(float(naive[0]) - actual)},
                          **selection["model_selection"]}))


if __name__ == "__main__":
    main()
