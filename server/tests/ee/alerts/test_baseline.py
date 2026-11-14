"""Metric baselines: profile what is normal, and measure the latest value against it."""

from datetime import datetime, timedelta

from ee.modules.alerts.baseline import observe, profile, robust_score, series

DAY0 = datetime(2026, 9, 1)


def _rows(values):
    return [{"day": (DAY0 + timedelta(days=i)).date().isoformat(), "orders": v} for i, v in enumerate(values)]


def test_series_finds_time_and_value_columns_from_the_data():
    pts = series(list(reversed(_rows([10, 12, 11]))))
    assert [v for _, v in pts] == [10, 12, 11]  # put back in time order


def test_profile_describes_normal():
    values = [50 + (i % 7) for i in range(28)]
    p = profile(series(_rows(values)))
    assert p["points"] == 28 and p["min"] == 50 and p["max"] == 56
    assert 0 < p["typical_change_pct"] < 15
    assert set(p["by_weekday_mean"]) == set(range(7))


def test_change_against_the_rolling_mean():
    value, snap = observe(series(_rows([100] * 10 + [70])), "change", window=10)
    assert value == -30.0 and snap["baseline_mean"] == 100


def test_unusual_value_scores_high_and_normal_low():
    normal = [100, 102, 98, 101, 99, 100, 103, 97]
    assert abs(robust_score(101, normal)) < 1
    assert robust_score(140, normal) > 5
    value, _ = observe(series(_rows(normal + [140])), "unusual", window=8)
    assert value > 5


def test_too_little_history_is_said_not_guessed():
    value, snap = observe(series(_rows([5])), "change")
    assert value is None and snap["reason"] == "not enough history"
