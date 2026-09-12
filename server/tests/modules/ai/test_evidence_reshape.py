"""Forecast / diagnose Evidence reshape — grain without a new warehouse trip."""

import pandas as pd

from ee.modules.ai.services.adaptive_continuation_service import _prompt_to_continuation_action
from ee.modules.ai.utils.evidence import should_reuse_evidence
from ee.modules.ai.utils.evidence_reshape import (
    NEEDS_SQL,
    READY,
    RESHAPEABLE,
    classify_forecast_frame,
    prepare_forecast_frame,
)


def _long_series(n: int = 12):
    return [{"period": f"2024-{m:02d}-01", "value": 100 + m} for m in range(1, n + 1)]


def _ranking():
    return [
        {"customer": f"c{i}", "amount": 1000 * i}
        for i in range(1, 12)
    ]


def _wide_months():
    row = {"region": "APAC"}
    for m in range(1, 13):
        row[f"2024-{m:02d}"] = 50 + m
    return [row, {**row, "region": "EMEA", "2024-01": 80}]


def test_long_series_is_ready():
    assert classify_forecast_frame(_long_series()) == READY


def test_ranking_needs_sql():
    assert classify_forecast_frame(_ranking()) == NEEDS_SQL


def test_wide_months_reshapeable_and_melts():
    assert classify_forecast_frame(_wide_months()) == RESHAPEABLE
    df, meta = prepare_forecast_frame(pd.DataFrame(_wide_months()))
    assert meta["status"] == "reshaped"
    assert meta["operation"] == "melt_wide_periods"
    assert "period" in df.columns and "value" in df.columns
    assert len(df) >= 5


def test_category_time_aggregates():
    rows = []
    for region in ("east", "west"):
        for m in range(1, 10):
            rows.append({"month": f"2024-{m:02d}-01", "region": region, "revenue": 10 * m})
    df, meta = prepare_forecast_frame(pd.DataFrame(rows))
    assert meta["status"] == "reshaped"
    assert meta["operation"] == "aggregate_series"
    assert len(df) == 9


def test_forecast_by_segment_does_not_collapse():
    rows = []
    for region in ("east", "west"):
        for m in range(1, 10):
            rows.append({"month": f"2024-{m:02d}-01", "region": region, "revenue": 10 * m})
    df, meta = prepare_forecast_frame(
        pd.DataFrame(rows),
        query="forecast revenue by region",
    )
    assert meta["status"] == NEEDS_SQL
    assert list(df.columns) == list(pd.DataFrame(rows).columns)


def test_reuse_forecast_on_ranking_forces_new_sql():
    assert not should_reuse_evidence(
        query="forecast that for the next 6 months",
        analysis_mode="predictive",
        analytics_type="predictive",
        client_reuse=True,
        has_rows=True,
        query_result=_ranking(),
    )


def test_reuse_forecast_on_series_skips_sql():
    assert should_reuse_evidence(
        query="forecast that for the next 6 months",
        analysis_mode="predictive",
        analytics_type="predictive",
        client_reuse=True,
        has_rows=True,
        query_result=_long_series(),
    )


def test_reuse_diagnose_on_ranking_ok():
    assert should_reuse_evidence(
        query="why did this happen?",
        analysis_mode="diagnostic",
        analytics_type="diagnostic",
        client_reuse=True,
        has_rows=True,
        query_result=_ranking(),
    )


def test_forecast_chip_skips_reuse_on_ranking():
    action = _prompt_to_continuation_action(
        "Forecast this metric for the next 6 months",
        default_mode="auto",
        query_result=_ranking(),
    )
    assert action.get("reuse_last_result") is not True
    assert action["analysis_mode"] == "predictive"


def test_forecast_chip_reuses_wide_months():
    action = _prompt_to_continuation_action(
        "Forecast this metric for the next 6 months",
        default_mode="auto",
        query_result=_wide_months(),
    )
    assert action.get("reuse_last_result") is True


def test_decide_chip_reuses_ranking():
    action = _prompt_to_continuation_action(
        "What should we decide next?",
        default_mode="auto",
        query_result=_ranking(),
    )
    assert action["analysis_mode"] == "decision_intelligence"
    assert action.get("reuse_last_result") is True


def test_dashboard_chip_does_not_reuse():
    action = _prompt_to_continuation_action(
        "Build a dashboard from this analysis",
        default_mode="auto",
        query_result=_ranking(),
    )
    assert action["analysis_mode"] == "dashboard"
    assert action.get("reuse_last_result") is not True


def test_di_frame_status_allows_ranking():
    from ee.modules.ai.utils.evidence_reshape import READY, frame_status_for_mode

    assert frame_status_for_mode(_ranking(), "decision_intelligence") == READY
    assert frame_status_for_mode(_ranking(), "predictive") == NEEDS_SQL


def test_diagnostic_melt_keeps_region():
    from ee.modules.ai.utils.evidence_reshape import prepare_diagnostic_frame

    df, meta = prepare_diagnostic_frame(pd.DataFrame(_wide_months()))
    assert meta["status"] == "reshaped"
    assert "region" in df.columns
    assert "period" in df.columns
