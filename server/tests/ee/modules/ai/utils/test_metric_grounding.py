"""Shared unit / grain / period contract for KPIs, charts, and narratives."""

from ee.modules.ai.utils.metric_grounding import (
    format_grounded_number,
    has_depth_evidence,
    rate_period_qualifier,
)


def test_fraction_interest_rate_displays_as_percent_not_point_one_one():
    formatted = format_grounded_number(0.11, "interest_rate")
    assert "0.11" not in formatted
    assert formatted.replace(" ", "").endswith("%")
    assert "11" in formatted
    assert rate_period_qualifier("interest_rate") == ""
    assert "month" not in rate_period_qualifier("interest_rate").lower()
    assert "year" not in rate_period_qualifier("interest_rate").lower()


def test_apr_column_names_annual_period_only():
    assert rate_period_qualifier("annual_interest_rate") == " (annual)"
    assert rate_period_qualifier("monthly_churn_rate") == " (monthly)"
    assert rate_period_qualifier("conversion_rate") == ""


def test_currency_and_count_formatting():
    assert format_grounded_number(1_250_000, "revenue") == "$1.25M"
    assert format_grounded_number(42, "loan_count") == "42"
    assert format_grounded_number(40, "total_customers") == "40"
    assert format_grounded_number(1_250_000, "customer_revenue") == "$1.25M"


def test_has_depth_evidence_requires_an_engine():
    assert has_depth_evidence({}) is False
    assert has_depth_evidence({"diagnostic": {"top_contributors": []}}) is True
    assert has_depth_evidence({"forecast": [{"date": "2026-01"}]}) is True
    assert has_depth_evidence({"recommendations": [{"action": "cut spend"}]}) is True
