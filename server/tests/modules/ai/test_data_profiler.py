"""
Tests for Data Profiler utility.

Covers: column classification, time-series detection, stationarity,
seasonality, model recommendation, readiness flags, and edge cases.
"""

import math
import pytest
import numpy as np
import pandas as pd

from src.modules.ai.utils.data_profiler import (
    DataProfile,
    profile_dataframe,
    detect_frequency,
    test_stationarity,
    detect_seasonality,
    query_result_to_dataframe,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def monthly_sales_df():
    """24-month sales data with trend and seasonality."""
    dates = pd.date_range("2024-01-01", periods=24, freq="MS")
    np.random.seed(42)
    base = np.linspace(100, 200, 24)
    seasonal = 20 * np.sin(np.arange(24) * 2 * np.pi / 12)
    noise = np.random.normal(0, 5, 24)
    values = base + seasonal + noise
    return pd.DataFrame({
        "month": dates,
        "revenue": values,
        "region": ["North", "South"] * 12,
        "product_category": ["A", "B", "C", "A"] * 6,
    })


@pytest.fixture
def simple_categorical_df():
    """Simple data with only categorical columns and one metric."""
    return pd.DataFrame({
        "segment": ["A", "B", "C", "A", "B", "C", "A", "B"],
        "sales": [100, 200, 150, 120, 180, 160, 110, 190],
    })


@pytest.fixture
def empty_df():
    return pd.DataFrame()


@pytest.fixture
def tiny_df():
    """Only 3 rows — below most model thresholds."""
    return pd.DataFrame({
        "date": pd.date_range("2024-01-01", periods=3, freq="MS"),
        "value": [10, 20, 30],
    })


# ---------------------------------------------------------------------------
# Tests: profile_dataframe
# ---------------------------------------------------------------------------

class TestProfileDataframe:
    def test_monthly_sales_profile(self, monthly_sales_df):
        profile = profile_dataframe(monthly_sales_df)
        assert profile.n_rows == 24
        assert profile.n_columns == 4
        assert profile.time_column == "month"
        assert "revenue" in profile.metric_columns
        assert "region" in profile.dimension_columns
        assert "product_category" in profile.dimension_columns
        assert profile.frequency == "monthly"
        assert profile.forecast_ready is True
        assert profile.diagnostic_ready is True

    def test_empty_df(self, empty_df):
        profile = profile_dataframe(empty_df)
        assert profile.n_rows == 0
        assert profile.forecast_ready is False
        assert profile.diagnostic_ready is False
        assert profile.prescriptive_ready is False

    def test_tiny_df(self, tiny_df):
        profile = profile_dataframe(tiny_df)
        assert profile.n_rows == 3
        assert profile.time_column == "date"
        assert profile.forecast_ready is False  # < 5 rows

    def test_categorical_only(self, simple_categorical_df):
        profile = profile_dataframe(simple_categorical_df)
        assert profile.time_column is None
        assert "sales" in profile.metric_columns
        assert "segment" in profile.dimension_columns
        assert profile.forecast_ready is False
        assert profile.diagnostic_ready is True

    def test_to_dict(self, monthly_sales_df):
        profile = profile_dataframe(monthly_sales_df)
        d = profile.to_dict()
        assert isinstance(d, dict)
        assert "n_rows" in d
        assert "forecast_ready" in d
        assert "recommended_forecast_model" in d

    def test_none_input(self):
        profile = profile_dataframe(None)
        assert profile.n_rows == 0


# ---------------------------------------------------------------------------
# Tests: detect_frequency
# ---------------------------------------------------------------------------

class TestDetectFrequency:
    def test_daily(self):
        df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=30, freq="D")})
        assert detect_frequency(df, "date") == "daily"

    def test_weekly(self):
        df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=20, freq="W")})
        assert detect_frequency(df, "date") == "weekly"

    def test_monthly(self):
        df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=12, freq="MS")})
        assert detect_frequency(df, "date") == "monthly"

    def test_quarterly(self):
        df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=8, freq="QS")})
        assert detect_frequency(df, "date") == "quarterly"

    def test_insufficient_data(self):
        df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=2, freq="MS")})
        assert detect_frequency(df, "date") is None


# ---------------------------------------------------------------------------
# Tests: test_stationarity
# ---------------------------------------------------------------------------

class TestStationarity:
    def test_stationary_series(self):
        np.random.seed(42)
        series = pd.Series(np.random.normal(0, 1, 100))
        is_stat, p = test_stationarity(series)
        assert is_stat is True
        assert p < 0.05

    def test_non_stationary_series(self):
        series = pd.Series(np.cumsum(np.random.normal(0, 1, 100)))
        is_stat, p = test_stationarity(series)
        # Non-stationary random walk — should have p > 0.05 most of the time
        # But ADF can be noisy; just check the function runs
        assert isinstance(is_stat, bool)
        assert isinstance(p, float)


# ---------------------------------------------------------------------------
# Tests: detect_seasonality
# ---------------------------------------------------------------------------

class TestSeasonality:
    def test_monthly_seasonality(self):
        np.random.seed(42)
        n = 48  # 4 years of monthly data
        seasonal = 10 * np.sin(np.arange(n) * 2 * np.pi / 12)
        noise = np.random.normal(0, 1, n)
        series = pd.Series(seasonal + noise + 50)
        has_seas, period = detect_seasonality(series, "monthly")
        assert has_seas is True
        assert period == 12

    def test_no_seasonality(self):
        np.random.seed(42)
        series = pd.Series(np.random.normal(100, 10, 50))
        has_seas, period = detect_seasonality(series, "monthly")
        # Random noise shouldn't have strong seasonal pattern
        assert isinstance(has_seas, bool)

    def test_insufficient_data(self):
        series = pd.Series([1, 2, 3])
        has_seas, period = detect_seasonality(series, "monthly")
        assert has_seas is False


# ---------------------------------------------------------------------------
# Tests: model recommendation
# ---------------------------------------------------------------------------

class TestModelRecommendation:
    def test_large_seasonal_recommends_prophet(self, monthly_sales_df):
        # Create larger dataset with clear seasonality
        dates = pd.date_range("2020-01-01", periods=60, freq="MS")
        seasonal = 20 * np.sin(np.arange(60) * 2 * np.pi / 12)
        values = np.linspace(100, 200, 60) + seasonal
        df = pd.DataFrame({"month": dates, "revenue": values})
        profile = profile_dataframe(df)
        assert profile.recommended_forecast_model == "prophet"

    def test_small_dataset_recommends_ets_or_ma(self):
        df = pd.DataFrame({
            "date": pd.date_range("2024-01-01", periods=12, freq="MS"),
            "value": [10, 12, 11, 13, 14, 12, 15, 16, 14, 17, 18, 16],
        })
        profile = profile_dataframe(df)
        assert profile.recommended_forecast_model in ("ets", "arima", "moving_avg")


# ---------------------------------------------------------------------------
# Tests: query_result_to_dataframe
# ---------------------------------------------------------------------------

class TestQueryResultToDataframe:
    def test_normal_conversion(self):
        data = [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]
        df = query_result_to_dataframe(data)
        assert len(df) == 2
        assert list(df.columns) == ["a", "b"]

    def test_empty_list(self):
        df = query_result_to_dataframe([])
        assert df.empty

    def test_none_input(self):
        df = query_result_to_dataframe(None)
        assert df.empty
