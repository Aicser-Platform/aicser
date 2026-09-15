"""Forecast model ranking must follow regime card + MASE/WMAPE primary loss."""

import numpy as np
import pandas as pd

from ee.modules.ai.utils.data_profiler import DataProfile
from ee.modules.ai.utils.predictive_models import TimeSeriesForecaster


def _forecaster() -> TimeSeriesForecaster:
    return TimeSeriesForecaster(DataProfile())


def test_single_zero_in_holdout_is_not_intermittent():
    ts = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=30, freq="D"),
        "y": [10.0] * 29 + [0.0],
    })
    pattern = _forecaster()._demand_pattern(ts)
    assert pattern["intermittent"] is False
    assert pattern["selection_metric"] == "mase"
    assert pattern["regime"] in ("regular", "near_constant", "trending")


def test_many_zeros_rank_by_wmape():
    y = [0.0, 0.0, 120.0, 0.0] * 20
    ts = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=len(y), freq="D"),
        "y": y,
    })
    pattern = _forecaster()._demand_pattern(ts)
    assert pattern["intermittent"] is True
    assert pattern["regime"] == "intermittent"
    assert pattern["selection_metric"] == "wmape"
    assert "croston" in pattern["candidates"]
    assert "prophet" not in pattern["candidates"]


def test_rank_error_uses_mase_when_regular():
    fc = _forecaster()
    assert fc._rank_error(mape=85.6, wmape=40.0, smape=30.0, selection_metric="mase", mase=0.8) == 0.8
    assert fc._rank_error(mape=85.6, wmape=40.0, smape=30.0, selection_metric="wmape", mase=0.8) == 40.0
    assert fc._rank_error(mape=85.6, wmape=40.0, smape=30.0, selection_metric="mape", mase=0.8) == 85.6


def test_near_constant_pattern_excludes_prophet():
    ts = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=12, freq="MS"),
        "y": [4400.0 + (i % 3) for i in range(12)],
    })
    pattern = _forecaster()._demand_pattern(ts)
    assert pattern["near_constant"] is True
    assert pattern["regime"] == "near_constant"
    assert pattern["selection_metric"] == "mase"
    assert "prophet" not in pattern["candidates"]
    assert pattern["candidates"][0] in ("ets", "moving_avg", "arima")


def test_mase_beats_naive_scale():
    fc = _forecaster()
    y_train = np.array([10.0, 12.0, 11.0, 13.0, 12.0, 14.0], dtype=float)
    actual = np.array([13.0, 15.0], dtype=float)
    # Perfect lag-1 style continuation vs bad forecast
    good = np.array([13.0, 15.0], dtype=float)
    bad = np.array([30.0, 40.0], dtype=float)
    assert fc._mase(actual, good, y_train, seasonality_period=1) < fc._mase(actual, bad, y_train, 1)


def test_clamp_explosive_forecast_falls_back_to_level_model():
    fc = _forecaster()
    ts = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=12, freq="MS"),
        "y": [4400.0] * 12,
    })
    explosive = pd.DataFrame({
        "ds": pd.date_range("2025-01-01", periods=6, freq="MS"),
        "yhat": [4400.0, 8000.0, 16000.0, 34000.0, 20000.0, 5000.0],
        "yhat_lower": [4000.0] * 6,
        "yhat_upper": [36000.0] * 6,
    })
    out, name = fc._clamp_explosive_forecast(ts, explosive, "prophet")
    assert out is not None
    assert float(np.max(np.abs(out["yhat"].values - 4400.0))) < 5000.0
    assert name != "prophet" or "_clamped" in name


def test_select_best_model_short_near_constant_returns_level_model():
    fc = _forecaster()
    ts = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=16, freq="MS"),
        "y": [100.0 + (i % 2) * 0.5 for i in range(16)],
    })
    name = fc._select_best_model(ts, periods=6, confidence=0.95)
    assert name in ("ets", "moving_avg", "arima")
    assert name != "prophet"


def test_croston_runs_on_intermittent_series():
    y = [0.0, 0.0, 80.0, 0.0, 110.0, 0.0] * 15
    ts = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=len(y), freq="D"),
        "y": y,
    })
    out = _forecaster()._run_croston(ts, periods=7)
    assert out is not None
    assert len(out) == 7
    assert (out["yhat"] >= 0).all()


def test_average_forecast_frames_blends_yhat():
    fc = _forecaster()
    a = pd.DataFrame({
        "ds": pd.date_range("2025-01-01", periods=3, freq="D"),
        "yhat": [10.0, 20.0, 30.0],
        "yhat_lower": [8.0, 18.0, 28.0],
        "yhat_upper": [12.0, 22.0, 32.0],
    })
    b = pd.DataFrame({
        "ds": pd.date_range("2025-01-01", periods=3, freq="D"),
        "yhat": [30.0, 40.0, 50.0],
        "yhat_lower": [28.0, 38.0, 48.0],
        "yhat_upper": [32.0, 42.0, 52.0],
    })
    out = fc._average_forecast_frames([a, b])
    assert out is not None
    assert list(out["yhat"].values) == [20.0, 30.0, 40.0]


def test_maybe_ensemble_when_errors_close():
    fc = _forecaster()
    ts = pd.DataFrame({
        "ds": pd.date_range("2024-01-01", periods=40, freq="D"),
        "y": [100.0 + i * 0.5 + (i % 7) for i in range(40)],
    })
    winner = fc._run_model("ets", ts, 5)
    assert winner is not None
    tried = [
        {"model": "ets", "primary_metric": 0.80, "mape": 8.0},
        {"model": "arima", "primary_metric": 0.85, "mape": 9.0},
        {"model": "prophet", "primary_metric": 1.40, "mape": 20.0},
    ]
    raw, name = fc._maybe_ensemble_top_models(ts, 5, tried, "mase", "ets", winner)
    assert raw is not None
    assert name.startswith("ensemble:") or name == "ets"


def test_humanize_forecast_model_avoids_jargon_brands():
    from ee.modules.ai.utils.display_labels import forecast_accuracy_phrase, humanize_forecast_model

    assert "prophet" not in humanize_forecast_model("prophet").lower()
    assert "arima" not in humanize_forecast_model("arima").lower()
    assert "blended" in humanize_forecast_model("ensemble:ets+arima").lower()
    phrase = forecast_accuracy_phrase("good", 88)
    assert "mape" not in phrase.lower()
    assert "88" in phrase
