"""Execute one bounded analysis task against the immutable data snapshot on stdin."""

import contextlib
from datetime import datetime, timedelta
from importlib import import_module
from importlib.metadata import version
from importlib.util import find_spec
import json
import math
import os
from pathlib import Path
import statistics
import sys


CHECKPOINTS = {
    "timesfm": ("google/timesfm-2.5-200m-pytorch", "1d952420fba87f3c6dee4f240de0f1a0fbc790e3"),
    "chronos2": ("amazon/chronos-2", "29ec3766d36d6f73f0696f85560a422f50e8498c"),
}


class InputError(Exception):
    """An unsupported or insufficient series that the caller can correct."""


def next_date(date, grain):
    if grain == "day":
        return date + timedelta(days=1)
    return date.replace(year=date.year + (date.month == 12), month=date.month % 12 + 1, day=1)


def contiguous_tail(observations, grain):
    if grain not in ("day", "month"):
        raise InputError("预测仅支持日度或月度历史观测。")
    tail = []
    for point in observations:
        date = datetime.fromisoformat(point["date"].replace("Z", "+00:00"))
        if point["value"] is None:
            tail = []
            continue
        if tail and next_date(tail[-1][0], grain) != date:
            tail = []
        tail.append((date, point["value"]))
    if len(tail) < 8:
        raise InputError("最后一段连续观测不足 8 期，或数据末尾有缺测。请查询另一段历史。")
    return tail


def predict(model, history, horizon, grain, statistical_method=None):
    import numpy as np

    values = np.asarray(history, dtype=np.float64)
    if model == "statsforecast":
        from statsforecast.models import AutoARIMA, AutoETS, Naive, SeasonalNaive

        period = 12 if grain == "month" else 7
        seasonal = len(values) >= 2 * period
        estimators = {"AutoETS": AutoETS, "AutoARIMA": AutoARIMA}
        if statistical_method in estimators:
            estimator = estimators[statistical_method](season_length=period)
        else:
            estimator = SeasonalNaive(season_length=period) if seasonal else Naive()
        forecast = estimator.forecast(y=values, h=horizon)
        return forecast["mean"], None, {
            "name": model, "version": version("statsforecast"),
            "method": type(estimator).__name__, "device": "cpu",
        }

    import torch

    device = os.environ.get("OGW_ANALYSIS_DEVICE", "cpu")
    if device not in ("cpu", "cuda") or (device == "cuda" and not torch.cuda.is_available()):
        raise InputError("此 Worker 未具备所选模型的 GPU 执行条件。")
    if device == "cpu" and torch.cuda.is_available():
        raise InputError("CPU Worker 请在启动时设置 CUDA_VISIBLE_DEVICES 为空。")
    checkpoint, revision = CHECKPOINTS[model]
    if model == "timesfm":
        import timesfm

        estimator = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
            checkpoint, revision=revision, local_files_only=True, torch_compile=False,
        )
        estimator.compile(timesfm.ForecastConfig(max_context=128, max_horizon=horizon,
                                               normalize_inputs=True, fix_quantile_crossing=True))
        point, quantiles = estimator.forecast(horizon=horizon, inputs=[values.astype(np.float32)])
        return point[0], quantiles[0][:, [1, 5, 9]], {
            "name": model, "version": version("timesfm"), "checkpoint": checkpoint, "revision": revision, "device": device,
        }

    from chronos import Chronos2Pipeline

    estimator = Chronos2Pipeline.from_pretrained(
        checkpoint, revision=revision, local_files_only=True, device_map=device,
    )
    quantiles, _ = estimator.predict_quantiles(
        [torch.as_tensor(values, dtype=torch.float32)], prediction_length=horizon, quantile_levels=[0.1, 0.5, 0.9],
    )
    bands = quantiles[0][0].detach().cpu().numpy()
    return bands[:, 1], bands, {
        "name": model, "version": version("chronos-forecasting"), "checkpoint": checkpoint, "revision": revision, "device": device,
    }


def available_models(requested):
    """Probe the installed runtime and exact offline snapshot, without loading weights."""
    ready = ["describe"]
    for capability, module in (("cluster", "sklearn.cluster"), ("statsforecast", "statsforecast.models")):
        if capability != "cluster" and capability not in requested:
            continue
        try:
            import_module(module)
            ready.append(capability)
        except Exception:
            continue
    for model in ("timesfm", "chronos2"):
        module = "timesfm" if model == "timesfm" else "chronos"
        if model not in requested or not all(find_spec(name) for name in (module, "torch", "huggingface_hub")):
            continue
        try:
            import torch
            from huggingface_hub import snapshot_download

            import_module(module)

            if os.environ.get("OGW_ANALYSIS_DEVICE") == "cuda" and not torch.cuda.is_available():
                continue
            checkpoint, revision = CHECKPOINTS[model]
            folder = Path(snapshot_download(checkpoint, revision=revision, local_files_only=True))
            if (folder / "config.json").is_file() and any(
                path.is_file() for pattern in ("*.safetensors", "pytorch_model*.bin") for path in folder.glob(pattern)
            ):
                ready.append(model)
        except Exception:
            continue
    return ready


def choose_model(series, horizon, grain):
    """Compare cheap candidates on three identical non-overlapping validation windows."""
    from statsforecast.models import AutoARIMA, AutoETS

    period = 12 if grain == "month" else 7
    candidates = [("baseline", None), ("AutoETS", AutoETS), ("AutoARIMA", AutoARIMA)]
    start = len(series) - 3 * horizon
    if start < max(24, 2 * period):
        raise InputError("自动选模需要至少 24 期训练数据和 3 个完整的验证窗口。")
    outcomes = []
    for name, estimator in candidates:
        actual, predictions = [], []
        try:
            for cutoff in range(start, len(series), horizon):
                history = [value for _, value in series[:cutoff]]
                if estimator is None:
                    forecast, _, _ = predict("statsforecast", history, horizon, grain)
                else:
                    import numpy as np

                    forecast = estimator(season_length=period).forecast(y=np.asarray(history, dtype=np.float64), h=horizon)["mean"]
                if len(forecast) != horizon or not all(math.isfinite(value) for value in forecast):
                    raise ValueError("Invalid forecast")
                actual.extend(value for _, value in series[cutoff:cutoff + horizon])
                predictions.extend(forecast)
            outcomes.append({"method": name, "status": "ok", **error_metrics(actual, predictions)})
        except Exception:
            if estimator is None:
                raise
            outcomes.append({"method": name, "status": "unavailable"})
    baseline = outcomes[0]
    # Keep the baseline for ties and improvements under 5%.
    improved = [entry for entry in outcomes[1:] if entry["status"] == "ok" and entry["mae"] < baseline["mae"] * 0.95]
    winner = min(improved, key=lambda entry: (entry["mae"], entry["rmse"], entry["method"])) if improved else baseline
    return {
        "method": "rolling_origin", "selected_method": winner["method"], "selection_metric": "mae",
        "horizon": horizon, "folds": 3, "min_relative_improvement": 0.05, "version": version("statsforecast"),
        "baseline_method": "SeasonalNaive", "candidates": outcomes,
        "cutoffs": [series[cutoff - 1][0].isoformat() for cutoff in range(start, len(series), horizon)],
    }


def error_metrics(actual, predicted):
    errors = [observed - float(estimate) for observed, estimate in zip(actual, predicted, strict=True)]
    return {
        "mae": statistics.mean(abs(error) for error in errors),
        "rmse": math.sqrt(statistics.mean(error ** 2 for error in errors)),
    }


def run(task):
    plan, source = task["plan"], task["input"]
    operation = plan["operation"]
    observations = source["observations"]
    if any(point["value"] is not None and not math.isfinite(point["value"]) for point in observations):
        raise InputError("序列包含非有限数值。")
    valid = [point for point in observations if point["value"] is not None]
    values = [point["value"] for point in valid]
    base = {
        "operation": operation, "unit": source["unit"], "metric": source["metric"],
        "observed_rows": len(valid), "missing_rows": len(observations) - len(valid),
    }
    if operation == "describe":
        return base | {"summary": {
            "mean": statistics.mean(values), "median": statistics.median(values), "min": min(values),
            "max": max(values), "stddev": statistics.pstdev(values),
        }}
    if operation == "cluster":
        from sklearn.cluster import KMeans

        count = plan["clusters"]
        if len(set(values)) < count:
            raise InputError("有效的不同数值少于聚类数量。")
        fitted = KMeans(n_clusters=count, random_state=42, n_init=10).fit([[value] for value in values])
        ordered = sorted(range(count), key=lambda label: fitted.cluster_centers_[label][0])
        group_of = {label: group for group, label in enumerate(ordered, start=1)}
        return base | {
            "method": "scikit-learn KMeans (univariate)",
            "groups": [{"group": group_of[label], "center": float(fitted.cluster_centers_[label][0]),
                        "count": int(sum(fitted.labels_ == label))} for label in ordered],
            "assignments": [{"date": point["date"], "group": group_of[label]}
                            for point, label in zip(valid, fitted.labels_, strict=True)],
        }

    grain, horizon = source["grain"], plan["horizon"]
    series = contiguous_tail(observations, grain)
    if plan.get("horizonUnit", grain) != grain:
        raise InputError("预测期数单位必须与输入序列粒度一致。")
    if operation == "select_model":
        return base | {"grain": grain, "model_selection": choose_model(series, horizon, grain)}
    testing = operation in ("backtest", "compare")
    history = series[:-horizon] if testing else series
    if len(history) < 8:
        raise InputError("留出窗口后不足 8 条训练观测，请缩短预测步数或扩大时间范围。")
    training_values = [value for _, value in history]
    model_selection = choose_model(series, horizon, grain) if operation == "forecast" and plan.get("strategy") == "auto" else None
    try:
        predicted, quantiles, identity = predict(plan["model"], training_values, horizon, grain,
                                                model_selection["selected_method"] if model_selection else None)
        if not all(math.isfinite(value) for value in predicted):
            raise ValueError("Invalid forecast")
    except Exception:
        if not model_selection or model_selection["selected_method"] == "baseline":
            raise
        model_selection["refit_fallback"] = "SeasonalNaive"
        predicted, quantiles, identity = predict("statsforecast", training_values, horizon, grain)
    if len(predicted) != horizon:
        raise RuntimeError("The model returned the wrong horizon")
    date = history[-1][0]
    points = []
    for index, value in enumerate(predicted):
        date = next_date(date, grain)
        point = {"date": date.isoformat(), "value": float(value)}
        if quantiles is not None:
            point.update(zip(("p10", "p50", "p90"), (float(q) for q in quantiles[index]), strict=True))
        if testing:
            point["actual"] = series[len(history) + index][1]
        points.append(point)
    output = base | {
        "model": identity, "horizon": horizon, "grain": grain, "points": points,
        "training_rows": len(history), "training_start": history[0][0].isoformat(),
        "training_end": history[-1][0].isoformat(),
    }
    if model_selection:
        output["model_selection"] = model_selection
    if testing:
        actual = [value for _, value in series[-horizon:]]
        output["evaluation"] = {"method": "chronological_holdout", **error_metrics(actual, predicted)}
        if operation == "compare":
            period = 12 if grain == "month" else 7
            if plan["model"] == "statsforecast" or len(training_values) < 2 * period:
                baseline = [training_values[-1]] * horizon
                baseline_id = {"name": "persistence", "method": "last_observation", "device": "cpu"}
            else:
                baseline = [training_values[-period + i % period] for i in range(horizon)]
                baseline_id = {"name": "seasonal_naive", "method": "SeasonalNaive", "version": "reference-1", "device": "cpu"}
            output["baseline"] = {"model": baseline_id, **error_metrics(actual, baseline)}
    return output


def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "--probe":
            with contextlib.redirect_stdout(sys.stderr):
                models = available_models(sys.argv[2:])
            print(json.dumps(models))
            return
        task = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            result = run(task)
        payload = {"result": result}
        json.dumps(payload, allow_nan=False)
    except InputError as error:
        payload = {"error": str(error)}
    except (ImportError, OSError) as error:
        print(type(error).__name__, str(error)[:300], file=sys.stderr)
        payload = {"error": "Worker 缺少所需的模型权重或 Python 依赖。"}
    except Exception as error:
        print(type(error).__name__, str(error)[:300], file=sys.stderr)
        payload = {"error": "分析 Worker 未能完成计算。"}
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
