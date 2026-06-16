"""Unit tests for mapping raw SQL result rows to the chart-data contract.

`compiled_semantic_sql` (from the AI dashboard planner) and saved/template SQL
return columns under their real aliased names — e.g.
`SELECT "product_type", SUM("term_months") AS total` — NOT the literal columns
`x`/`y` that the dashboard renderer consumes. These tests pin the positional
mapping that turns those rows into {x, y, series} / {value}.

Pure helper — no DB needed; instantiate ChartService via __new__.
"""

from src.modules.charts.services.v2.chart_service import ChartService


def _svc() -> ChartService:
    return ChartService.__new__(ChartService)


def test_grouped_bar_uses_first_column_as_category():
    svc = _svc()
    rows = [
        {"product_type": "Individual Loan", "total": 13293.0},
        {"product_type": "Group Loan", "total": 10527.0},
    ]
    out = svc._map_sql_rows_to_chart_data(rows, chart_type="bar")
    assert out["x"] == ["Individual Loan", "Group Loan"]
    assert out["y"] == [13293.0, 10527.0]
    assert out["series"] == [{"name": "total", "data": [13293.0, 10527.0]}]


def test_multi_measure_becomes_multiple_series():
    svc = _svc()
    rows = [
        {"product_type": "A", "total": 100, "average": 12, "count": 8},
        {"product_type": "B", "total": 200, "average": 11, "count": 18},
    ]
    out = svc._map_sql_rows_to_chart_data(rows, chart_type="bar")
    assert out["x"] == ["A", "B"]
    assert [s["name"] for s in out["series"]] == ["total", "average", "count"]
    assert out["series"][2]["data"] == [8, 18]


def test_stat_returns_first_column_value():
    svc = _svc()
    rows = [{"total_records": 3610, "total_loan_amount_usd": 999}]
    assert svc._map_sql_rows_to_chart_data(rows, chart_type="stat") == {"value": 3610}


def test_stat_honors_explicit_value_alias():
    svc = _svc()
    rows = [{"value": 42}]
    assert svc._map_sql_rows_to_chart_data(rows, chart_type="stat") == {"value": 42}


def test_legacy_x_y_alias_preserved():
    svc = _svc()
    rows = [{"x": "Jan", "y": 5}, {"x": "Feb", "y": 9}]
    out = svc._map_sql_rows_to_chart_data(rows, chart_type="bar")
    assert out["x"] == ["Jan", "Feb"]
    assert out["y"] == [5, 9]
    assert out["series"] == [{"name": "Value", "data": [5, 9]}]


def test_empty_rows_returns_empty_shape():
    svc = _svc()
    assert svc._map_sql_rows_to_chart_data([], chart_type="bar") == {
        "x": [],
        "y": [],
        "series": [],
    }


def test_spaced_column_names_are_valid_and_quoted():
    svc = _svc()
    assert svc._is_valid_field_name("Units Sold") is True
    assert svc._get_aggregate_func("sum", "Units Sold") == 'SUM("Units Sold")'
    assert svc._apply_filters_db(
        [{"field": "Manufacturing Price", "operator": ">=", "value": 10}]
    ) == 'WHERE "Manufacturing Price" >= 10'


def test_saved_sql_runtime_filters_only_use_projected_columns():
    svc = _svc()
    sql = 'SELECT "Segment", SUM("Sales") AS total FROM "data" GROUP BY "Segment"'
    filters = [
        {"field": "Date", "operator": "<=", "value": "2026-06-16"},
        {"field": "Segment", "operator": "in", "value": ["Government"]},
    ]

    assert svc._filters_projected_by_saved_sql(filters, sql) == [filters[1]]
