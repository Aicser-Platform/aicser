"""
Tests for all four analytics engines and the unified analytics node.

Covers: descriptive, predictive, diagnostic, prescriptive engines,
composite chaining, and the fallback degradation matrix.
"""

import pytest
import numpy as np
import pandas as pd
import os

from ee.modules.ai.utils.data_profiler import DataProfile, profile_dataframe
from ee.modules.ai.utils.descriptive_analytics import (
    generate_descriptive_summary,
    DescriptiveSummary,
)
from ee.modules.ai.utils.predictive_models import (
    TimeSeriesForecaster,
    ForecastResult,
)
from ee.modules.ai.utils.diagnostic_engine import (
    run_diagnostic,
    DiagnosticResult,
)
from ee.modules.ai.utils.prescriptive_engine import (
    run_prescriptive,
    PrescriptiveResult,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def monthly_df():
    """24-month data with trend, multiple metrics, dimensions."""
    np.random.seed(42)
    dates = pd.date_range("2024-01-01", periods=24, freq="MS")
    revenue = np.linspace(100, 200, 24) + np.random.normal(0, 10, 24)
    traffic = np.linspace(1000, 2000, 24) + np.random.normal(0, 100, 24)
    conversion = np.random.uniform(0.03, 0.08, 24)
    regions = ["North", "South", "East", "West"] * 6
    return pd.DataFrame({
        "month": dates,
        "revenue": revenue,
        "traffic": traffic,
        "conversion_rate": conversion,
        "region": regions,
    })


@pytest.fixture
def monthly_profile(monthly_df):
    return profile_dataframe(monthly_df)


@pytest.fixture
def segment_df():
    """Segment-level data with clear top/bottom performers."""
    return pd.DataFrame({
        "segment": ["A", "B", "C", "D", "E", "F"],
        "retention_rate": [0.92, 0.68, 0.75, 0.85, 0.60, 0.78],
        "avg_touchpoints": [12, 4, 6, 10, 3, 7],
        "avg_response_time": [2.5, 8.0, 5.5, 3.0, 10.0, 6.0],
        "satisfaction_score": [4.5, 3.0, 3.5, 4.2, 2.8, 3.6],
    })


@pytest.fixture
def segment_profile(segment_df):
    return profile_dataframe(segment_df)


@pytest.fixture
def no_time_df():
    """Data without a time column."""
    return pd.DataFrame({
        "category": ["A", "B", "C", "D"],
        "value": [100, 200, 150, 300],
    })


# ---------------------------------------------------------------------------
# Descriptive Analytics Tests
# ---------------------------------------------------------------------------

class TestDescriptiveAnalytics:
    def test_basic_summary(self, monthly_df, monthly_profile):
        summary = generate_descriptive_summary(monthly_df, monthly_profile)
        assert isinstance(summary, DescriptiveSummary)
        assert summary.row_count == 24
        assert "revenue" in summary.metric_summaries
        ms = summary.metric_summaries["revenue"]
        assert ms.mean > 0
        assert ms.std > 0
        assert ms.count == 24

    def test_trend_detection(self, monthly_df, monthly_profile):
        summary = generate_descriptive_summary(monthly_df, monthly_profile)
        assert summary.trend is not None
        assert summary.trend.direction in ("increasing", "decreasing", "stable")
        assert summary.trend.r_squared >= 0

    def test_segment_ranking(self, monthly_df, monthly_profile):
        summary = generate_descriptive_summary(monthly_df, monthly_profile)
        assert len(summary.top_segments) > 0
        assert len(summary.bottom_segments) > 0
        assert summary.top_segments[0].segment

    def test_additive_metric_ranks_by_sum_not_mean(self):
        """Monthly grain must not rank branches by average month; share % uses totals."""
        df = pd.DataFrame({
            "branch": (
                ["Branch 5"] * 4
                + ["Branch 2"] * 5
                + ["Branch 3"] * 4
                + ["Branch 1"] * 4
                + ["Branch 4"] * 4
            ),
            "collateral_amount": [
                210084.52, 196250.91, 60111.73, 240016.72,
                98748.02, 124671.21, 178814.14, 127076.96, 79720.80,
                181264.55, 155687.26, 157266.05, 93059.53,
                142678.87, 26952.41, 237186.85, 141222.83,
                187563.39, 70810.35, 227116.76, 43379.76,
            ],
        })
        profile = profile_dataframe(df)
        summary = generate_descriptive_summary(df, profile)
        assert summary.top_segments[0].segment == "Branch 5"
        assert summary.top_segments[0].basis == "sum"
        assert summary.top_segments[0].value == pytest.approx(706463.88, rel=1e-4)
        assert summary.top_segments[0].pct_of_total == pytest.approx(23.71, abs=0.05)

    def test_period_over_period(self, monthly_df, monthly_profile):
        summary = generate_descriptive_summary(monthly_df, monthly_profile)
        assert summary.period_over_period is not None
        assert "pct_change" in summary.period_over_period

    def test_data_quality(self, monthly_df, monthly_profile):
        summary = generate_descriptive_summary(monthly_df, monthly_profile)
        assert summary.data_quality.row_count == 24

    def test_to_dict(self, monthly_df, monthly_profile):
        summary = generate_descriptive_summary(monthly_df, monthly_profile)
        d = summary.to_dict()
        assert d["analytics_type"] == "descriptive"
        assert "metric_summaries" in d

    def test_empty_df(self):
        profile = DataProfile()
        summary = generate_descriptive_summary(pd.DataFrame(), profile)
        assert summary.row_count == 0

    def test_distribution_classification(self, monthly_df, monthly_profile):
        summary = generate_descriptive_summary(monthly_df, monthly_profile)
        assert summary.distribution_type in (
            "normal", "skewed_right", "skewed_left",
            "slightly_skewed_right", "slightly_skewed_left", "unknown",
        )


# ---------------------------------------------------------------------------
# Predictive Analytics Tests
# ---------------------------------------------------------------------------

class TestPredictiveModels:
    @pytest.mark.skipif(
        os.getenv("RUN_HEAVY_AI_TESTS") != "1",
        reason="Predictive model tests are heavy/slow in local environments; set RUN_HEAVY_AI_TESTS=1 to run.",
    )
    def test_moving_average_fallback(self, monthly_df, monthly_profile):
        """Test forecast with data that triggers moving average fallback."""
        # Small dataset
        small_df = monthly_df.head(8)
        small_profile = profile_dataframe(small_df)
        
        if small_profile.forecast_ready:
            forecaster = TimeSeriesForecaster(small_profile)
            result = forecaster.forecast(small_df, "month", "revenue", periods=3)
            assert isinstance(result, ForecastResult)
            assert result.data_points_used > 0
            assert len(result.forecast) > 0

    @pytest.mark.skipif(
        os.getenv("RUN_HEAVY_AI_TESTS") != "1",
        reason="Predictive model tests are heavy/slow in local environments; set RUN_HEAVY_AI_TESTS=1 to run.",
    )
    def test_forecast_output_structure(self, monthly_df, monthly_profile):
        forecaster = TimeSeriesForecaster(monthly_profile)
        result = forecaster.forecast(monthly_df, "month", "revenue", periods=6)
        assert isinstance(result, ForecastResult)
        assert result.forecast_periods == 6
        assert result.data_points_used == 24
        assert result.trend_direction in ("increasing", "decreasing", "stable")

        # Check forecast output
        if result.forecast:
            for entry in result.forecast:
                assert "date" in entry
                assert "forecast" in entry
                assert "lower" in entry
                assert "upper" in entry
                assert entry["lower"] <= entry["forecast"] <= entry["upper"]

    @pytest.mark.skipif(
        os.getenv("RUN_HEAVY_AI_TESTS") != "1",
        reason="Predictive model tests are heavy/slow in local environments; set RUN_HEAVY_AI_TESTS=1 to run.",
    )
    def test_to_dict(self, monthly_df, monthly_profile):
        forecaster = TimeSeriesForecaster(monthly_profile)
        result = forecaster.forecast(monthly_df, "month", "revenue", periods=3)
        d = result.to_dict()
        assert d["analytics_type"] == "predictive"
        assert "model_used" in d

    @pytest.mark.skipif(
        os.getenv("RUN_HEAVY_AI_TESTS") != "1",
        reason="Predictive model tests are heavy/slow in local environments; set RUN_HEAVY_AI_TESTS=1 to run.",
    )
    def test_insufficient_data(self):
        df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=3), "value": [1, 2, 3]})
        profile = profile_dataframe(df)
        if not profile.forecast_ready:
            # Expected: not enough data
            assert True
            return
        forecaster = TimeSeriesForecaster(profile)
        result = forecaster.forecast(df, "date", "value", periods=3)
        assert isinstance(result, ForecastResult)


# ---------------------------------------------------------------------------
# Diagnostic Analytics Tests
# ---------------------------------------------------------------------------

class TestDiagnosticEngine:
    def test_basic_diagnostic(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue")
        assert isinstance(result, DiagnosticResult)
        assert isinstance(result.anomaly_confirmed, bool)
        assert isinstance(result.anomaly_zscore, float)

    def test_dimension_slicing(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue")
        assert len(result.dimension_slicing) > 0
        for s in result.dimension_slicing:
            assert s.dimension
            assert s.anomalous_segment

    def test_correlations(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue")
        assert isinstance(result.correlations, dict)

    def test_contributors(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue")
        assert isinstance(result.top_contributors, list)

    def test_focus_dimension(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue", focus_dimension="region")
        # Should only slice on region
        dims = {s.dimension for s in result.dimension_slicing}
        assert "region" in dims

    def test_metric_decomposition(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue")
        # May or may not have decomposition depending on data
        if result.metric_decomposition:
            assert result.metric_decomposition.root_metric == "revenue"

    def test_to_dict(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue")
        d = result.to_dict()
        assert d["analytics_type"] == "diagnostic"
        assert d["anomaly_scope"] in ("time", "concentration")

    def test_ranking_snapshot_diagnoses_concentration(self, no_time_df):
        """Go Deeper on a ranking must slice segments, not treat last SQL row as time."""
        profile = profile_dataframe(no_time_df)
        result = run_diagnostic(no_time_df, profile, "value")
        assert result.error is None
        assert result.anomaly_scope == "concentration"
        assert len(result.dimension_slicing) >= 2
        assert len(result.top_contributors) >= 1
        peak = max(result.dimension_slicing, key=lambda s: s.segment_value)
        assert peak.anomalous_segment == "D"

    def test_one_row_per_segment_ranking_not_dropped(self):
        df = pd.DataFrame({
            "branch": ["Branch 1", "Branch 2", "Branch 3", "Branch 4", "Branch 5"],
            "collateral_amount": [548041.0, 609031.0, 587278.0, 528870.0, 706464.0],
        })
        profile = profile_dataframe(df)
        result = run_diagnostic(df, profile, "collateral_amount")
        assert result.error is None
        assert result.anomaly_scope == "concentration"
        assert len(result.dimension_slicing) == 5
        assert any("Branch 5" in c.factor for c in result.top_contributors)
        d = result.to_dict()
        assert d["dimension_slicing"]
        assert d["top_contributors"]

    def test_time_series_keeps_time_scope(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "revenue")
        assert result.anomaly_scope == "time"

    def test_ranking_diagnostic_chart_is_not_a_blind_replot(self):
        from ee.modules.ai.nodes.chart_builder_node import _try_analytics_mode_chart

        rows = [
            {"category": "A", "value": 100},
            {"category": "B", "value": 200},
            {"category": "C", "value": 150},
            {"category": "D", "value": 300},
        ]
        meta = run_diagnostic(
            pd.DataFrame(rows), profile_dataframe(pd.DataFrame(rows)), "value"
        ).to_dict()
        chart = _try_analytics_mode_chart("diagnostic", meta, "why this ranking", rows)
        assert chart is not None
        series0 = chart["series"][0]
        assert series0["type"] == "bar"
        assert "markLine" in series0
        assert "average" in (chart.get("title") or {}).get("subtext", "").lower() or \
            "share" in (chart.get("title") or {}).get("subtext", "").lower() or \
            "concentration" in (chart.get("title") or {}).get("subtext", "").lower()

    def test_missing_metric(self, monthly_df, monthly_profile):
        result = run_diagnostic(monthly_df, monthly_profile, "nonexistent_metric")
        # Should fall back to first metric column
        assert result.error is None or "revenue" in str(result.correlations)

    def test_empty_df(self):
        profile = DataProfile()
        result = run_diagnostic(pd.DataFrame(), profile, "value")
        assert result.error is not None


# ---------------------------------------------------------------------------
# Prescriptive Analytics Tests
# ---------------------------------------------------------------------------

class TestPrescriptiveEngine:
    def test_basic_prescriptive(self, segment_df, segment_profile):
        result = run_prescriptive(segment_df, segment_profile, "retention_rate")
        assert isinstance(result, PrescriptiveResult)
        assert result.baseline
        assert result.baseline["metric"] == "retention_rate"

    def test_sensitivity_analysis(self, segment_df, segment_profile):
        result = run_prescriptive(segment_df, segment_profile, "retention_rate")
        assert len(result.sensitivity) > 0
        for s in result.sensitivity:
            assert s.variable
            assert isinstance(s.elasticity, float)

    def test_scenarios(self, segment_df, segment_profile):
        result = run_prescriptive(segment_df, segment_profile, "retention_rate")
        assert len(result.scenarios) > 0
        for sc in result.scenarios:
            assert sc.name
            assert isinstance(sc.expected_value, float)
            assert sc.confidence > 0

    def test_recommendations(self, segment_df, segment_profile):
        result = run_prescriptive(segment_df, segment_profile, "retention_rate")
        assert len(result.recommendations) > 0
        for r in result.recommendations:
            assert r.action
            assert r.priority_score >= 0

    def test_gap_analysis(self, segment_df, segment_profile):
        result = run_prescriptive(segment_df, segment_profile, "retention_rate")
        if result.gap_analysis:
            assert result.gap_analysis.current > 0
            assert result.gap_analysis.target >= result.gap_analysis.current

    def test_to_dict(self, segment_df, segment_profile):
        result = run_prescriptive(segment_df, segment_profile, "retention_rate")
        d = result.to_dict()
        assert d["analytics_type"] == "prescriptive"

    def test_empty_df(self):
        profile = DataProfile()
        result = run_prescriptive(pd.DataFrame(), profile, "value")
        assert result.error is not None


# ---------------------------------------------------------------------------
# Composite Chaining Tests
# ---------------------------------------------------------------------------

class TestCompositeChaining:
    def test_diagnostic_to_prescriptive(self, monthly_df, monthly_profile):
        """Chain: diagnostic first, then prescriptive on same data."""
        diag = run_diagnostic(monthly_df, monthly_profile, "revenue")
        presc = run_prescriptive(monthly_df, monthly_profile, "revenue")

        assert isinstance(diag, DiagnosticResult)
        assert isinstance(presc, PrescriptiveResult)
        # Both should succeed
        assert diag.error is None
        assert presc.error is None


# ---------------------------------------------------------------------------
# Fallback / Degradation Matrix Tests
# ---------------------------------------------------------------------------

class TestFallbackMatrix:
    def test_predictive_no_time_column(self, no_time_df):
        """Predictive on non-time-series → should indicate not forecast-ready."""
        profile = profile_dataframe(no_time_df)
        assert profile.forecast_ready is False

    def test_diagnostic_single_dimension(self):
        """Diagnostic with only 1 dimension should still work."""
        df = pd.DataFrame({
            "region": ["A", "B", "C", "A", "B", "C"],
            "sales": [100, 200, 50, 120, 180, 40],
        })
        profile = profile_dataframe(df)
        result = run_diagnostic(df, profile, "sales")
        assert result.error is None

    def test_prescriptive_single_row(self):
        """Prescriptive with single row → should fail gracefully."""
        df = pd.DataFrame({"metric": [100]})
        profile = profile_dataframe(df)
        assert profile.prescriptive_ready is False

    def test_descriptive_always_works(self):
        """Descriptive should never fail, even on minimal data."""
        df = pd.DataFrame({"x": [1, 2, 3]})
        profile = profile_dataframe(df)
        summary = generate_descriptive_summary(df, profile)
        assert summary.row_count == 3
