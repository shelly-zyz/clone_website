#!/usr/bin/env python3
"""Train and audit LightGBM against persistence on the local SDWPF holdout."""

from __future__ import annotations

import json
import math
from pathlib import Path
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd
import sklearn
from sklearn.metrics import mean_absolute_error, root_mean_squared_error

LAGS = (1, 3, 6, 12, 36, 144)
HORIZONS = (1, 3, 6)
ROLLING_SPLITS = (
    {"id": "fold-1", "trainStart": 1, "trainEnd": 121, "validationStart": 122, "validationEnd": 152, "holdoutStart": 153, "holdoutEnd": 183},
    {"id": "fold-2", "trainStart": 1, "trainEnd": 152, "validationStart": 153, "validationEnd": 183, "holdoutStart": 184, "holdoutEnd": 214},
    {"id": "fold-3", "trainStart": 1, "trainEnd": 183, "validationStart": 184, "validationEnd": 214, "holdoutStart": 215, "holdoutEnd": 245},
)


def build_supervised(frame: pd.DataFrame, horizon: int) -> pd.DataFrame:
    data = frame.sort_values("serial_minute").reset_index(drop=True).copy()
    minute = data["serial_minute"] % 1440
    data["tod_sin"] = np.sin(2 * math.pi * minute / 1440)
    data["tod_cos"] = np.cos(2 * math.pi * minute / 1440)
    data["power_now"] = data["power_mw"]
    feature_names = ["power_now", "mean_wind_speed_mps", "coverage", "tod_sin", "tod_cos"]
    valid = (data["usable"] == 1)
    for lag in LAGS:
        power_name = f"power_lag_{lag}"
        wind_name = f"wind_lag_{lag}"
        data[power_name] = data["power_mw"].shift(lag)
        data[wind_name] = data["mean_wind_speed_mps"].shift(lag)
        valid &= data["usable"].shift(lag).eq(1)
        valid &= data["serial_minute"].sub(data["serial_minute"].shift(lag)).eq(lag * 10)
        feature_names.extend((power_name, wind_name))
    data["target"] = data["power_mw"].shift(-horizon)
    data["target_day"] = data["day"].shift(-horizon)
    valid &= data["usable"].shift(-horizon).eq(1)
    valid &= data["serial_minute"].shift(-horizon).sub(data["serial_minute"]).eq(horizon * 10)
    selected = data.loc[valid].dropna(subset=feature_names + ["target", "target_day"])
    return selected[[*feature_names, "target", "target_day"]]


def metrics(actual: pd.Series, predicted: np.ndarray) -> dict[str, float | int]:
    return {
        "samples": int(len(actual)),
        "maeMw": round(float(mean_absolute_error(actual, predicted)), 3),
        "rmseMw": round(float(root_mean_squared_error(actual, predicted)), 3),
    }


def split_supervised(data: pd.DataFrame, split: dict) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    train = data[(data["target_day"] >= split["trainStart"]) & (data["target_day"] <= split["trainEnd"])]
    validation = data[(data["target_day"] >= split["validationStart"]) & (data["target_day"] <= split["validationEnd"])]
    holdout = data[(data["target_day"] >= split["holdoutStart"]) & (data["target_day"] <= split["holdoutEnd"])]
    return train, validation, holdout


def summarize_rolling_horizon(folds: list[dict]) -> dict:
    wins = sum(1 for fold in folds if fold["beatsPersistence"])
    mean_improvement = sum(fold["maeImprovementPct"] for fold in folds) / len(folds)
    return {
        "wins": wins,
        "folds": len(folds),
        "meanMaeImprovementPct": round(mean_improvement, 2),
        "minimumMaeImprovementPct": round(min(fold["maeImprovementPct"] for fold in folds), 2),
        "passesRollingGate": len(folds) >= 3 and wins == len(folds) and mean_improvement > 0,
    }


def make_model() -> lgb.LGBMRegressor:
    return lgb.LGBMRegressor(
        objective="regression_l1",
        n_estimators=600,
        learning_rate=0.035,
        num_leaves=31,
        max_depth=-1,
        min_child_samples=30,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        random_state=20260909,
        verbosity=-1,
    )


def train_lightgbm(aggregate_path: Path, models_dir: Path) -> dict:
    frame = pd.read_csv(aggregate_path)
    models_dir.mkdir(parents=True, exist_ok=True)
    supervised = {horizon: build_supervised(frame, horizon) for horizon in HORIZONS}
    fold_results = []
    comparisons = []
    for split in ROLLING_SPLITS:
        fold_comparisons = []
        for horizon in HORIZONS:
            data = supervised[horizon]
            feature_names = [column for column in data.columns if column not in {"target", "target_day"}]
            train, validation, holdout = split_supervised(data, split)
            model = make_model()
            model.fit(
                train[feature_names], train["target"],
                eval_X=validation[feature_names],
                eval_y=validation["target"],
                eval_metric="mae",
                callbacks=[lgb.early_stopping(50, verbose=False)],
            )
            actual = holdout["target"]
            prediction = model.predict(holdout[feature_names], num_iteration=model.best_iteration_)
            model_result = metrics(actual, prediction)
            persistence_prediction = holdout["power_now"].to_numpy()
            persistence_result = metrics(actual, persistence_prediction)
            model_mae = float(mean_absolute_error(actual, prediction))
            persistence_mae = float(mean_absolute_error(actual, persistence_prediction))
            improvement = 100 * (persistence_mae - model_mae) / persistence_mae
            comparison = {
                "horizonMinutes": horizon * 10,
                "bestIteration": int(model.best_iteration_),
                "model": model_result,
                "persistence": persistence_result,
                "maeImprovementPct": round(improvement, 2),
                "beatsPersistence": model_mae < persistence_mae,
            }
            fold_comparisons.append(comparison)
            if split["id"] == "fold-3":
                model.booster_.save_model(str(models_dir / f"lightgbm-h{horizon * 10}.txt"), num_iteration=model.best_iteration_)
        fold_results.append({
            "id": split["id"],
            "split": {
                "trainDays": f'{split["trainStart"]}-{split["trainEnd"]}',
                "validationDays": f'{split["validationStart"]}-{split["validationEnd"]}',
                "holdoutDays": f'{split["holdoutStart"]}-{split["holdoutEnd"]}',
            },
            "comparisons": fold_comparisons,
        })

    for horizon in HORIZONS:
        comparisons.append(next(item for item in fold_results[-1]["comparisons"] if item["horizonMinutes"] == horizon * 10))
    rolling_horizons = []
    for horizon in HORIZONS:
        horizon_folds = [next(item for item in fold["comparisons"] if item["horizonMinutes"] == horizon * 10) for fold in fold_results]
        rolling_horizons.append({"horizonMinutes": horizon * 10, **summarize_rolling_horizon(horizon_folds)})
    return {
        "name": "LightGBM",
        "version": lgb.__version__,
        "sklearnVersion": sklearn.__version__,
        "status": "rolling-candidate" if any(item["passesRollingGate"] for item in rolling_horizons) else "rejected-no-stable-rolling-gain",
        "featurePolicy": "current/past SCADA, current/past measured wind, coverage, and time-of-day; no future meteorology",
        "split": {"trainDays": "1-183", "validationDays": "184-214", "holdoutDays": "215-245"},
        "comparisons": comparisons,
        "rollingValidation": {
            "strategy": "rolling-origin-expanding-window",
            "minimumFolds": 3,
            "completedFolds": len(fold_results),
            "folds": fold_results,
            "horizons": rolling_horizons,
        },
    }


def main() -> None:
    aggregate_path = Path(sys.argv[1] if len(sys.argv) > 1 else ".forecast-data/sdwpf/farm-aggregate.csv")
    summary_path = Path(sys.argv[2] if len(sys.argv) > 2 else ".forecast-data/sdwpf/pilot-summary.json")
    models_dir = Path(sys.argv[3] if len(sys.argv) > 3 else ".forecast-data/sdwpf/models")
    result = train_lightgbm(aggregate_path, models_dir)
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["lightgbmComparison"] = result
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
