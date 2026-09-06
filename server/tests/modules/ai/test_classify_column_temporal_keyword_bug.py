"""Regression tests for the "Prior Month Customer Count" chart-plotting bug.

Root cause: classify_column()'s keyword-based temporal check matched any
standalone word in TEMPORAL_COLUMN_KEYWORDS (e.g. "month") anywhere in a
column name, with zero check on the actual values — so a comparison metric
like "Prior Month Customer Count" was misclassified TEMPORAL purely because
its name contains "month". This displaced the real date column
("Month": 2024-01-01, ...) as the chart's x-axis, scattering points across
near-duplicate numeric buckets instead of a real timeline, and silently
excluded the metric from both numeric and categorical fact computation.

Live-reported symptom: a "customers by branch over month" query with a
"Prior Month Customer Count" comparison column rendered with x-axis values
like "(Other), 2, 1, 3" instead of months, and the generic-insights fallback
never showed a stat for the comparison column.
"""

from __future__ import annotations

from ee.modules.ai.utils.guaranteed_chart_builder import (
    ChartTypeSelector,
    ColumnType,
    analyze_columns,
    classify_column,
)


def test_prior_month_metric_column_is_numeric_not_temporal():
    values = [2, 1, 3, "—", 5, 4, 2, "—", 6, 3]
    col_type, meta = classify_column("Prior Month Customer Count", values)
    assert col_type == ColumnType.NUMERIC, meta


def test_real_date_column_named_month_is_still_temporal():
    values = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]
    col_type, meta = classify_column("Month", values)
    assert col_type == ColumnType.TEMPORAL, meta


def test_string_formatted_month_without_day_still_temporal_via_fallback():
    # No day component, so it doesn't match TEMPORAL_PATTERNS directly —
    # covered by the mostly-non-numeric fallback, same as before this fix.
    values = ["January 2024", "February 2024", "March 2024"]
    col_type, meta = classify_column("Report Month", values)
    assert col_type == ColumnType.TEMPORAL, meta


def test_full_branch_month_dataset_classifies_correctly_end_to_end():
    data = [
        {"Month": "2024-01-01", "Branch Name": "Branch 1", "Customer Count": 2, "Prior Month Customer Count": "—"},
        {"Month": "2024-02-01", "Branch Name": "Branch 1", "Customer Count": 5, "Prior Month Customer Count": 2},
        {"Month": "2024-01-01", "Branch Name": "Branch 2", "Customer Count": 3, "Prior Month Customer Count": "—"},
        {"Month": "2024-02-01", "Branch Name": "Branch 2", "Customer Count": 4, "Prior Month Customer Count": 3},
    ]
    analysis = analyze_columns(data)
    assert analysis["Month"]["type"] == ColumnType.TEMPORAL
    assert analysis["Branch Name"]["type"] == ColumnType.CATEGORICAL
    assert analysis["Customer Count"]["type"] == ColumnType.NUMERIC
    assert analysis["Prior Month Customer Count"]["type"] == ColumnType.NUMERIC


def test_numeric_ratio_ignores_placeholder_dashes():
    from ee.modules.ai.utils.guaranteed_chart_builder import _numeric_ratio

    ratio, considered = _numeric_ratio([2, 5, "—", 3, "-", 7])
    assert considered == 4
    assert ratio == 1.0


def test_month_over_month_delta_is_numeric_not_temporal():
    # Live-reproduced (2026-09-03, "how many customers per month by
    # transaction type"): "month_over_month_delta" contains "month" (temporal
    # keyword) but no word from METRIC_COLUMN_NAMES_UNIVERSAL alone — "delta"
    # only lives in DERIVED_METRIC_TERMS. It was classified TEMPORAL and
    # displaced the real "month" column as the chart's x-axis, exactly like
    # the original "Prior Month Customer Count" bug this file already covers.
    values = [2.5, -1.0, 4.2, 0.0, 3.1, -2.4, 1.8, 5.0, -0.5, 2.2]
    col_type, meta = classify_column("month_over_month_delta", values)
    assert col_type == ColumnType.NUMERIC, meta


def test_growth_rate_named_column_is_numeric_not_temporal():
    values = [12.5, 8.3, -4.1, 15.0, 6.7, 9.9, 3.2, 11.1, 7.4, 5.6]
    col_type, meta = classify_column("year_over_year_growth_rate", values)
    assert col_type == ColumnType.NUMERIC, meta


def test_prior_period_column_no_longer_outscores_the_base_metric():
    # Once classify_column correctly sees "Prior Month Customer Count" as
    # NUMERIC (previous test), it becomes a second metric candidate — and
    # without a penalty it out-scores "Customer Count" on raw word-match
    # count alone (its name is a superset), wrongly becoming the primary
    # y-axis. This is what select_chart_type must now avoid end-to-end.
    query = "how many customers by branch over month"
    base_score = ChartTypeSelector._score_metric_relevance("Customer Count", query)
    prior_score = ChartTypeSelector._score_metric_relevance("Prior Month Customer Count", query)
    assert base_score > prior_score


def test_live_reproduced_month_over_month_delta_chart_uses_real_month_as_x():
    # Reproduces the exact live query: "how many customers per month by
    # transaction type" — SQL added both previous_month_customer_count (a
    # LAG-based comparison, already correctly numeric before this fix) and
    # month_over_month_delta (the gap this fix closes).
    data = []
    months = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]
    types = ["deposit", "withdrawal", "transfer", "payment"]
    for m_i, month in enumerate(months):
        for t in types:
            data.append({
                "month": month,
                "transaction_type": t,
                "customer_count": 10 + m_i * 3,
                "previous_month_customer_count": "—" if m_i == 0 else 10 + (m_i - 1) * 3,
                "month_over_month_delta": 0.0 if m_i == 0 else round(3 / (10 + (m_i - 1) * 3) * 100, 1),
            })
    analysis = analyze_columns(data)
    assert analysis["month_over_month_delta"]["type"] == ColumnType.NUMERIC
    chart_type, x_col, y_col, _extra, group_col = ChartTypeSelector.select_chart_type(
        analysis, len(data), query="how many customers per month by transaction type"
    )
    assert x_col == "month"
    assert group_col == "transaction_type"
    # The comparison/delta column must not outscore the actual requested
    # metric ("how many customers") as primary y-axis just because "month"
    # happens to appear in both the query and the comparison column's name.
    assert y_col == "customer_count"


def test_period_over_period_naming_convention_also_penalized():
    query = "how many customers by branch over month"
    base_score = ChartTypeSelector._score_metric_relevance("Customer Count", query)
    delta_score = ChartTypeSelector._score_metric_relevance("month_over_month_delta", query)
    growth_score = ChartTypeSelector._score_metric_relevance("year_over_year_growth_rate", query)
    assert base_score > delta_score
    assert base_score > growth_score


def test_grouped_line_chart_x_axis_is_the_real_date_column_not_the_comparison_metric():
    data = []
    for month, m_val in [("2024-01-01", None), ("2024-02-01", 2), ("2024-03-01", 5)]:
        for b in range(1, 6):
            data.append({
                "Month": month,
                "Branch Name": f"Branch {b}",
                "Customer Count": 10 + b,
                "Prior Month Customer Count": "—" if m_val is None else m_val + b,
            })
    analysis = analyze_columns(data)
    chart_type, x_col, y_col, _extra, group_col = ChartTypeSelector.select_chart_type(
        analysis, len(data), query="how many customers by branch over month"
    )
    assert chart_type == "grouped_line"
    assert x_col == "Month"
    assert y_col == "Customer Count"
    assert group_col == "Branch Name"


def test_bare_month_number_column_stays_temporal_despite_being_numeric():
    # Guard against over-correcting: a bare "month" column (no accompanying
    # metric word like count/total/amount) holding small integers (1-12) is
    # a calendar dimension (e.g. EXTRACT(MONTH FROM date)), not a magnitude —
    # it must stay TEMPORAL even though its values are 100% numeric. Only a
    # name that ALSO reads as a metric (like "Prior Month Customer Count")
    # should let numeric values override the temporal keyword.
    values = [1, 2, 3, 1, 2, 3, 1, 2, 3, 1]
    col_type, meta = classify_column("month", values)
    assert col_type == ColumnType.TEMPORAL, meta
