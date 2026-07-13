from src.modules.dashboards.chart_data_validation import validate_chart_data


def test_validate_bar_requires_matching_categories_and_values():
    valid = validate_chart_data(
        "bar",
        {"x": ["A", "B"], "series": [{"name": "Revenue", "data": [10, 20]}]},
    )
    invalid = validate_chart_data(
        "bar",
        {"x": ["A", "B"], "series": [{"name": "Revenue", "data": [10]}]},
    )

    assert valid.valid is True
    assert invalid.valid is False
    assert "different lengths" in invalid.reason


def test_validate_stat_requires_value_or_series_data():
    assert validate_chart_data("stat", {"value": 42}).valid is True
    assert validate_chart_data("stat", {"y": [1, 2]}).valid is True

    invalid = validate_chart_data("stat", {"x": ["Total"], "y": []})

    assert invalid.valid is False
    assert invalid.reason == "KPI returned no value"


def test_validate_scatter_requires_xy_points():
    valid = validate_chart_data(
        "scatter",
        {"series": [{"name": "Points", "data": [[1, 2], [3, 4]]}]},
    )
    invalid = validate_chart_data(
        "scatter",
        {"series": [{"name": "Points", "data": [["missing-y"]]}]},
    )

    assert valid.valid is True
    assert invalid.valid is False


def test_validate_table_accepts_row_payloads():
    valid = validate_chart_data(
        "table",
        {"columns": ["region", "revenue"], "rows": [{"region": "APAC", "revenue": 10}]},
    )
    invalid = validate_chart_data("table", {"columns": ["region"], "rows": []})

    assert valid.valid is True
    assert invalid.valid is False
