"""Real-world forecasting behaviour: each test pins a data shape that used to produce a
wrong or misleading forecast (calendar drift, partial periods, fake zeros, phantom
seasonality, flat-width bands, diagnostics describing a different model)."""

import numpy as np
import pandas as pd
import pytest

from ee.modules.ai.utils.data_profiler import DataProfile, detect_seasonality, profile_dataframe
from ee.modules.ai.utils.predictive_models import TimeSeriesForecaster


def _run(df, periods, **kw):
    fc = TimeSeriesForecaster(profile_dataframe(df))
    fc._budget_s = 1e-6  # skip Prophet/ARIMA: fast + deterministic with or without them installed
    return fc, fc.forecast(df, "period", "value", periods=periods, **kw)


def _monthly(n=48, start="2020-01-01", seed=0, month_end=False):
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n, freq="MS")
    if month_end:
        idx = idx + pd.offsets.MonthEnd(0)
    t = np.arange(n)
    y = 1000 + 10 * t + 150 * np.sin(2 * np.pi * t / 12) + rng.normal(0, 25, n)
    return pd.DataFrame({"period": idx, "value": y})


def test_month_end_dates_continue_month_end_without_skipping():
    df = _monthly(month_end=True)
    _, r = _run(df, 6)
    assert r.error is None
    assert r.historical[-1]["date"] == "2023-12-31"
    assert [p["date"] for p in r.forecast[:3]] == ["2024-01-31", "2024-02-29", "2024-03-31"]
    assert len(r.forecast) == 6


def test_weekly_series_keeps_its_weekday():
    rng = np.random.default_rng(1)
    idx = pd.date_range("2023-01-02", periods=80, freq="W-MON")
    df = pd.DataFrame({"period": idx, "value": 300 + np.arange(80) + rng.normal(0, 10, 80)})
    _, r = _run(df, 4)
    days = {pd.Timestamp(p["date"]).day_name() for p in r.forecast}
    assert days == {"Monday"}
    assert r.forecast[0]["date"] == (idx[-1] + pd.Timedelta(days=7)).strftime("%Y-%m-%d")


def test_in_progress_month_is_excluded_and_reported():
    idx = pd.date_range("2023-01-01", "2025-06-09", freq="D")
    rng = np.random.default_rng(2)
    df = pd.DataFrame({"period": idx, "value": 100 + rng.normal(0, 5, len(idx))})
    _, r = _run(df, 3, resample_to="MS")
    assert r.historical[-1]["date"] == "2025-05-01"
    assert r.partial_period and r.partial_period["date"] == "2025-06-01"
    assert r.partial_period["coverage_pct"] < 50
    assert r.forecast[0]["date"] == "2025-06-01"
    # A complete month is ~3,000; the partial ~900 must not drag the forecast down.
    assert r.forecast[0]["forecast"] > 2500
    assert any("complete" in n for n in r.data_notes)


def test_missing_months_interpolated_not_zero_filled():
    df = _monthly(40)
    df = df.drop(index=[5, 6, 15, 16, 25]).reset_index(drop=True)
    _, r = _run(df, 3, resample_to="MS")
    assert r.model_diagnostics["regime"] != "intermittent"
    assert all(h["value"] > 0 for h in r.historical)
    assert len(r.historical) == 35  # interpolated months are not shown as actuals
    assert any("missing period" in n for n in r.data_notes)


def test_gaps_in_sparse_series_are_zero_activity():
    idx = pd.date_range("2024-01-01", periods=120, freq="D")
    y = np.where(np.arange(120) % 3 == 0, 0.0, 50.0)
    df = pd.DataFrame({"period": idx, "value": y}).iloc[::2]  # drop every other day
    fc = TimeSeriesForecaster(DataProfile())
    ts = fc._prepare_data(df, "period", "value", resample_to="D", agg_func="sum")
    assert ts is not None and len(ts) == 119
    assert fc._prep_meta["gaps"]["mode"] == "zero"


def test_spike_damped_for_fitting_but_history_unchanged():
    df = _monthly(48, seed=3)
    df.loc[20, "value"] = df["value"].iloc[20] * 6
    fc, r = _run(df, 6)
    shown = {h["date"]: h["value"] for h in r.historical}
    assert shown[df["period"].iloc[20].strftime("%Y-%m-%d")] == pytest.approx(df["value"].iloc[20])
    assert any("spike" in n for n in r.data_notes)


def test_trend_only_series_is_not_called_seasonal():
    rng = np.random.default_rng(4)
    idx = pd.date_range("2021-01-01", periods=48, freq="MS")
    y = 500 + 25 * np.arange(48) + rng.normal(0, 30, 48)
    df = pd.DataFrame({"period": idx, "value": y})
    fc, r = _run(df, 6)
    assert fc._season_period is None
    assert r.seasonality_detected == "none"
    assert detect_seasonality(pd.Series(y), "monthly") == (False, None)


def test_seasonal_series_detected_with_period_12():
    fc, r = _run(_monthly(60, seed=5), 12)
    assert fc._season_period == 12
    assert r.model_diagnostics["regime"] == "seasonal"


def test_intervals_widen_with_horizon_and_nest():
    rng = np.random.default_rng(6)
    idx = pd.date_range("2019-01-01", periods=72, freq="MS")
    df = pd.DataFrame({"period": idx, "value": 1000 + np.cumsum(rng.normal(0, 50, 72))})
    _, r = _run(df, 12)
    assert r.intervals_calibrated
    first, last = r.forecast[0], r.forecast[-1]
    assert (last["upper"] - last["lower"]) > (first["upper"] - first["lower"])
    for p in r.forecast:
        assert p["lower"] <= p["lower_80"] <= p["forecast"] <= p["upper_80"] <= p["upper"]


def test_diagnostics_describe_the_delivered_model():
    _, r = _run(_monthly(60, seed=7), 12)
    d = r.model_diagnostics
    assert d["model"] == r.model_used
    winners = [row for row in d["model_comparison"] if row["winner"]]
    assert len(winners) == 1 and winners[0]["model"] == r.model_used
    assert d["validation"] == "rolling_origin" and d["cv_folds"] >= 2
    assert 0 <= d["accuracy_pct"] <= 100
    assert d["period_accuracy_pct"] == round(100 - d["wmape"])
    assert d["accuracy_basis"] in ("horizon_total", "per_period")
    if d["accuracy_basis"] == "per_period":
        assert d["accuracy_pct"] == d["period_accuracy_pct"]


def test_calendar_free_cycle_is_found_and_zero_days_are_not_sparse_demand():
    """An order every 3rd day (random amounts): the forecast must repeat the cadence on the
    right days, not flatten it into an average daily rate; the headline accuracy is on
    horizon totals, not on individual (unpredictable) order amounts."""
    rng = np.random.default_rng(3)
    days = pd.date_range("2024-01-04", "2024-12-26", freq="3D")
    df = pd.DataFrame({"period": days, "value": rng.uniform(200, 5000, len(days))})
    fc = TimeSeriesForecaster(profile_dataframe(df))
    r = fc.forecast(df, "period", "value", periods=30, resample_to="D")
    assert r.seasonality_detected == "3"
    assert r.model_diagnostics["regime"] == "seasonal"
    vals = [row["forecast"] for row in r.forecast[:9]]
    mean_order = float(df["value"].mean())
    # Next order is due 3 days after the last one (2024-12-29); the days between are ~0.
    spikes = [i for i, v in enumerate(vals) if v > mean_order * 0.5]
    assert spikes == [2, 5, 8]
    assert max(v for i, v in enumerate(vals) if i not in spikes) < mean_order * 0.1
    assert r.model_diagnostics["accuracy_basis"] == "horizon_total"
    assert r.model_diagnostics["accuracy_pct"] > r.model_diagnostics["period_accuracy_pct"]


def test_interval_fan_follows_the_delivered_model():
    """A stable level forecast must not fan out like a random walk."""
    rng = np.random.default_rng(11)
    df = pd.DataFrame({
        "period": pd.date_range("2024-01-01", periods=8, freq="MS"),
        "value": 280_000 + rng.normal(0, 30_000, 8),
    })
    r = TimeSeriesForecaster(profile_dataframe(df)).forecast(df, "period", "value", periods=6)
    first, last = r.forecast[0], r.forecast[-1]
    width = lambda row: row["upper"] - row["lower"]  # noqa: E731
    assert width(last) < 1.6 * width(first)
    assert r.model_diagnostics["validation"] == "one_step_short_history"
    assert any("two full cycles" in n for n in r.data_notes)


def test_ensemble_name_runs_its_members():
    df = _monthly(48, seed=8)
    fc = TimeSeriesForecaster(DataProfile())
    ts = fc._prepare_data(df, "period", "value")
    a = fc._run_model("theta", ts, 4)
    b = fc._run_model("drift", ts, 4)
    blend = fc._run_model("ensemble:theta+drift", ts, 4)
    assert np.allclose(blend["yhat"].values, (a["yhat"].values + b["yhat"].values) / 2)
    assert fc._run_model("definitely_not_a_model", ts, 4) is None


def test_long_horizon_warning_survives():
    _, r = _run(_monthly(12, seed=9), 36)
    assert "horizon_warning" in r.model_diagnostics


def test_business_day_series_skips_weekends():
    idx = pd.bdate_range("2025-01-01", periods=120)
    rng = np.random.default_rng(10)
    df = pd.DataFrame({"period": idx, "value": 100 + rng.normal(0, 3, 120)})
    _, r = _run(df, 10)
    assert all(pd.Timestamp(p["date"]).dayofweek < 5 for p in r.forecast)
    assert r.model_diagnostics["frequency"] == "business-daily"


def test_compounding_growth_is_tracked():
    rng = np.random.default_rng(11)
    idx = pd.date_range("2022-01-01", periods=42, freq="MS")
    y = 50 * np.exp(0.09 * np.arange(42)) * np.exp(rng.normal(0, 0.03, 42))
    df = pd.DataFrame({"period": idx.values[:36], "value": y[:36]})
    _, r = _run(df, 6)
    pred = np.array([p["forecast"] for p in r.forecast])
    assert np.mean(np.abs(pred - y[36:]) / y[36:]) < 0.12


def test_hourly_dates_keep_time():
    idx = pd.date_range("2025-03-01", periods=24 * 10, freq="h")
    t = np.arange(len(idx))
    df = pd.DataFrame({"period": idx, "value": 50 + 10 * np.sin(2 * np.pi * t / 24)})
    _, r = _run(df, 6)
    assert r.forecast[0]["date"] == "2025-03-11 00:00"
    assert len({p["date"] for p in r.forecast}) == 6


def test_forecast_chart_has_fan_bands_and_in_progress_marker():
    from ee.modules.ai.nodes.chart_builder_node import _build_forecast_chart

    idx = pd.date_range("2023-01-01", "2025-06-09", freq="D")
    rng = np.random.default_rng(12)
    df = pd.DataFrame({"period": idx, "value": 100 + rng.normal(0, 5, len(idx))})
    _, r = _run(df, 3, resample_to="MS")
    chart = _build_forecast_chart(r.to_dict(), "forecast value")
    names = [s["name"] for s in chart["series"]]
    assert {"95% interval", "80% interval", "In progress"} <= set(names)
    marker = next(s for s in chart["series"] if s["name"] == "In progress")
    assert sum(1 for p in marker["data"] if p) == 1


def test_daily_calendar_effects_are_forecast_not_averaged():
    """Weekday pattern + mid-month payday + month-end close: the calendar regression competes
    in the backtest and its forecast keeps the payday/month-end peaks."""
    rng = np.random.default_rng(21)
    ds = pd.date_range("2023-01-01", periods=420, freq="D")
    dow = np.array([1.0, 1.05, 1.0, 1.1, 1.25, 0.7, 0.5])[ds.dayofweek]
    pay = np.where((ds.day >= 14) & (ds.day <= 16), 1.4, 1.0) * np.where(ds.day > ds.days_in_month - 3, 1.35, 1.0)
    y = 1000 * dow * pay + rng.normal(0, 40, len(ds))
    df = pd.DataFrame({"period": ds, "value": y})
    fc, r = _run(df, 31)
    names = [m["model"] for m in r.model_diagnostics["model_comparison"]]
    assert "calendar_regression" in names
    assert "calendar_regression" in r.model_used
    fc_by_date = {pd.Timestamp(x["date"]): x["forecast"] for x in r.forecast}
    mid = [v for d, v in fc_by_date.items() if 14 <= d.day <= 16 and d.dayofweek < 5]
    plain = [v for d, v in fc_by_date.items() if 5 <= d.day <= 12 and d.dayofweek < 5]
    assert np.mean(mid) > 1.2 * np.mean(plain)


def test_public_holidays_are_learned_when_a_country_is_configured(monkeypatch):
    holidays = pytest.importorskip("holidays")
    monkeypatch.setenv("AISER_FORECAST_HOLIDAY_COUNTRY", "KH")
    cal = holidays.country_holidays("KH", years=range(2023, 2026))
    ds = pd.date_range("2023-01-01", "2025-05-31", freq="D")
    rng = np.random.default_rng(8)
    base = 1000 * np.array([1, 1.05, 1, 1.1, 1.25, 0.7, 0.5])[ds.dayofweek]
    y = np.where([d.date() in cal for d in ds], base * 0.3, base) + rng.normal(0, 30, len(ds))
    cut = ds.get_loc(pd.Timestamp("2025-04-01"))
    fc, r = _run(pd.DataFrame({"period": ds[:cut], "value": y[:cut]}), 30)
    assert "calendar_regression" in r.model_used
    by_date = {pd.Timestamp(x["date"]).date(): x["forecast"] for x in r.forecast}
    khmer_new_year = [d for d in by_date if d in cal]
    ordinary = [d for d in by_date if d not in cal and pd.Timestamp(d).dayofweek < 5]
    assert khmer_new_year, "April should contain Khmer New Year"
    assert np.mean([by_date[d] for d in khmer_new_year]) < 0.6 * np.mean([by_date[d] for d in ordinary])


def test_random_walk_is_not_rated_excellent():
    """A price-like random walk has tiny % error relative to its level but no skill over
    'stays where it is' — the rating must say so instead of 'excellent'."""
    from ee.modules.ai.utils.display_labels import forecast_accuracy_phrase

    rng = np.random.default_rng(3)
    y = 50_000 + np.cumsum(rng.normal(0, 600, 240))
    df = pd.DataFrame({"period": pd.date_range("2024-01-01", periods=240, freq="D"), "value": y})
    r = TimeSeriesForecaster(profile_dataframe(df)).forecast(df, "period", "value", periods=14)
    diag = r.model_diagnostics
    if diag.get("persistence_only"):
        assert diag["accuracy_rating"] not in ("excellent", "good")
        assert "latest value" in forecast_accuracy_phrase(diag["accuracy_rating"], diag.get("accuracy_pct"), diag)


def test_intervals_widen_when_backtest_folds_were_calm():
    fc = TimeSeriesForecaster(DataProfile())
    fc._season_period = None
    noisy = 1000 + np.random.default_rng(1).normal(0, 80, 24)
    calm_scores = np.random.default_rng(2).normal(0, 40, 24)
    assert fc._noise_inflation(noisy, calm_scores, n_eff=10) > 1.2
    assert fc._noise_inflation(noisy, calm_scores * 3, n_eff=10) == 1.0  # never narrows
    scored = {"a": {"errors": np.full(10, 1.0)}, "b": {"errors": np.full(10, 2.0)}, "c": {"errors": np.full(10, 2.0)}}
    assert 1.0 < TimeSeriesForecaster._selection_inflation(scored, "a") <= 1.6
