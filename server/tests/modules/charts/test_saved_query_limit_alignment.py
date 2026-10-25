"""A chart pinned from a saved SQL query re-aggregates that SQL as a subquery
(`_execute_saved_query_chart`). When the chart itself has no explicit `limit`,
the wrapping aggregation previously always capped at a hardcoded 5000 rows
regardless of what the original SQL's own LIMIT was — so a chat-pinned "top 20"
chart would silently show up to 5000 categories on the dashboard instead of the
20 the user actually saw. `_extract_sql_limit` closes that gap by preferring the
saved SQL's own trailing LIMIT when the chart doesn't override it.

Pure helper — no DB needed; instantiate ChartService via __new__.
"""

from src.modules.charts.services.v2.chart_service import ChartService


def _svc() -> ChartService:
    return ChartService.__new__(ChartService)


def test_extracts_trailing_limit():
    svc = _svc()
    sql = "SELECT product, SUM(revenue) AS total FROM orders GROUP BY product ORDER BY total DESC LIMIT 20"
    assert svc._extract_sql_limit(sql) == 20


def test_extracts_limit_before_trailing_offset_and_semicolon():
    svc = _svc()
    assert svc._extract_sql_limit("SELECT a FROM t LIMIT 50 OFFSET 10;") == 50


def test_returns_none_when_sql_has_no_limit():
    svc = _svc()
    assert svc._extract_sql_limit("SELECT product, SUM(revenue) FROM orders GROUP BY product") is None


def test_returns_none_for_non_positive_limit():
    svc = _svc()
    assert svc._extract_sql_limit("SELECT a FROM t LIMIT 0") is None


def test_returns_none_for_empty_sql():
    svc = _svc()
    assert svc._extract_sql_limit("") is None
    assert svc._extract_sql_limit(None) is None


def test_chart_without_a_sort_keeps_the_saved_sql_order():
    """A "top 10 provinces by amount" query pinned as a bar chart re-aggregates over the SQL;
    with no sort of its own the chart keeps the SQL's ORDER BY instead of GROUP BY order."""
    svc = _svc()
    sql = (
        "SELECT branch_province, SUM(loan_amount_usd) AS total_loan_usd FROM loans "
        "GROUP BY branch_province ORDER BY total_loan_usd DESC LIMIT 10"
    )
    metrics = [{"field": "total_loan_usd", "aggregation": "sum"}]
    assert svc._saved_sql_sort(sql, "branch_province", metrics) == ("y_0", "desc")
    assert svc._saved_sql_sort(sql.replace("total_loan_usd DESC", "branch_province"), "branch_province", metrics) == ("x", "asc")
    # Ordered by something the chart doesn't show, or not ordered at all: nothing to inherit.
    assert svc._saved_sql_sort(sql.replace("ORDER BY total_loan_usd DESC", "ORDER BY COUNT(*) DESC"), "branch_province", metrics) is None
    assert svc._saved_sql_sort("SELECT a, b FROM t", "a", metrics) is None
