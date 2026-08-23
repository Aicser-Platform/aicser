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
