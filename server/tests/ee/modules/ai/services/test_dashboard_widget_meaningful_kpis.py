"""Regression tests: dashboard KPI cards must show a real business-meaningful
number, not a technically-correct-but-meaningless aggregate, and must not
duplicate the same underlying number under two different titles.

Live-reproduced: an education dataset's dashboard showed a "Total Score:
9.45k" KPI card right next to a correct "Average Score: 78.71" card for the
exact same "score" column - summing a per-student score across every row
produces a number nobody asks for (it grows with row count, has no unit
anyone reasons about, and isn't "the total" of anything real), while the
average is the number a real administrator would actually want. The same
underlying widget-generation pipeline also produced literal duplicate KPI
cards (two "Total Score" cards, two "Record Count" cards) from independent
widget-producing functions that don't cross-check each other's output.

Fixed generally, not by special-casing "score": SUM defaults to AVG for any
numeric column whose name suggests a per-entity measure (score, rate, ratio,
age, balance, margin, rating, index, ...) rather than a genuinely additive
quantity (revenue, quantity, clicks, orders) - the same domain-agnostic
name-token approach already used elsewhere in this module for other
guardrails, so it applies to any data source/industry, not just this one
dataset. A lightweight post-correction dedup catches the resulting duplicate
when two independently-produced widgets converge on the same field+
aggregation after correction.
"""

from ee.modules.ai.services.dashboard_widget_validator import (
    _is_non_additive_column,
    validate_widgets,
)

_SCHEMA = {
    "tables": [
        {
            "name": "grades",
            "columns": [
                {"name": "grade_letter", "type": "VARCHAR"},
                {"name": "score", "type": "DOUBLE"},
                {"name": "revenue_usd", "type": "DOUBLE"},
            ],
        }
    ]
}


def _stat_widget(name: str, field: str, aggregation: str, table: str = "grades") -> dict:
    return {
        "name": name,
        "chart_type": "stat",
        "chart_query": {"tableName": table, "yMetrics": [{"field": field, "aggregation": aggregation}]},
    }


def test_is_non_additive_column_recognizes_domain_agnostic_measures():
    """The token set is deliberately not tied to any one industry's
    vocabulary - education (score, grade, gpa), finance (rate, balance,
    margin), healthcare (age, index), CX (nps, csat, satisfaction) all use
    "score"-shaped per-entity measures under different names."""
    for name in (
        "score", "test_score", "credit_score", "health_score", "satisfaction_score",
        "pass_rate", "conversion_rate", "gpa", "grade_average", "account_balance",
        "profit_margin", "customer_age", "nps", "csat_rating",
    ):
        assert _is_non_additive_column(name), name


def test_is_non_additive_column_leaves_genuinely_additive_columns_alone():
    for name in ("revenue_usd", "quantity", "clicks", "order_count", "amount", "impressions"):
        assert not _is_non_additive_column(name), name


def test_sum_of_non_additive_column_corrected_to_average_on_stat_card():
    widgets = [_stat_widget("Total Score", "score", "sum")]
    kept, dropped = validate_widgets(widgets, _SCHEMA)

    assert not dropped
    assert len(kept) == 1
    assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "avg"
    assert "total" not in kept[0]["name"].lower()


def test_sum_of_additive_column_on_stat_card_is_unaffected():
    """Control case: a genuinely additive metric (revenue) must keep SUM."""
    widgets = [_stat_widget("Total Revenue", "revenue_usd", "sum")]
    kept, dropped = validate_widgets(widgets, _SCHEMA)

    assert not dropped
    assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "sum"


def test_breakdown_chart_sum_of_non_additive_column_is_unaffected():
    """Scoped to stat/kpi cards only - a grouped SUM (e.g. "total delay by
    carrier") is a legitimate comparative aggregate even for a non-additive-
    looking column name; only the bare, ungrouped headline number is
    unambiguously meaningless."""
    widgets = [
        {
            "name": "Score by Grade Letter",
            "chart_type": "bar",
            "chart_query": {
                "tableName": "grades",
                "x": "grade_letter",
                "yMetrics": [{"field": "score", "aggregation": "sum"}],
            },
        }
    ]
    kept, dropped = validate_widgets(widgets, _SCHEMA)

    assert not dropped
    assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "sum"


def test_duplicate_kpi_cards_from_independent_producers_are_deduped():
    """Reproduces the live duplication: two independently-built "Total
    Score" stat cards for the same table+field+aggregation - most likely to
    arise from two different widget-producing functions, or (as here) from
    two cards that converge onto the same field+aggregation only after the
    SUM-to-AVG correction runs."""
    widgets = [
        _stat_widget("Total Score", "score", "sum"),
        _stat_widget("Average Score", "score", "avg"),
    ]
    kept, dropped = validate_widgets(widgets, _SCHEMA)

    assert len(kept) == 1
    assert len(dropped) == 1
    assert dropped[0]["reason"] == "duplicate of an earlier widget"
    assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "avg"


def test_distinct_kpi_cards_are_not_deduped():
    """Control case: genuinely different metrics/fields must both survive."""
    widgets = [
        _stat_widget("Average Score", "score", "avg"),
        _stat_widget("Total Revenue", "revenue_usd", "sum"),
    ]
    kept, dropped = validate_widgets(widgets, _SCHEMA)

    assert len(kept) == 2
    assert not dropped
