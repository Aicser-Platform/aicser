"""Tests for the chart ORDER BY clause builder.

When a chart applies date bucketing (x_grain), SELECT and GROUP BY use the
truncated expression aliased as ``x``, but ORDER BY used to reference the raw
column. On DuckDB that raises:
    Binder Error: column "disbursement_date" must appear in the GROUP BY clause
Ordering by the ``x`` alias matches the grouped expression and works on both
DuckDB and Postgres, with or without bucketing.
"""

from src.modules.charts.services.v2.chart_service import ChartService


def _svc() -> ChartService:
    return ChartService.__new__(ChartService)


def test_sort_by_x_orders_by_alias_not_raw_column():
    out = _svc()._build_order_clause("x", "asc", "disbursement_date")
    assert out == "ORDER BY x ASC"


def test_sort_by_x_desc():
    out = _svc()._build_order_clause("x", "desc", "disbursement_date")
    assert out == "ORDER BY x DESC"


def test_sort_by_y_uses_metric_alias():
    assert _svc()._build_order_clause("y", "desc", "disbursement_date", has_y_metrics=True) == "ORDER BY y_0 DESC"
    assert _svc()._build_order_clause("y", "asc", "disbursement_date", has_y_metrics=False) == "ORDER BY y ASC"


def test_record_order_returns_empty():
    assert _svc()._build_order_clause("record_order", "asc", "disbursement_date") == ""
