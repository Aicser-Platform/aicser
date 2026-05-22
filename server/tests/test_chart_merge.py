def test_standalone_chart_router_importable_from_charts():
    from src.modules.charts.router import standalone_chart_router
    assert standalone_chart_router is not None


def test_standalone_chart_project_id_is_optional_for_ce():
    import inspect

    from src.modules.charts.router import standalone_create_chart, standalone_list_charts

    assert inspect.signature(standalone_create_chart).parameters["project_id"].default is None
    assert inspect.signature(standalone_list_charts).parameters["project_id"].default is None


def test_standalone_chart_create_ignores_project_id_in_ce():
    import inspect

    from src.modules.charts import router

    source = inspect.getsource(router.standalone_create_chart)

    assert 'if not is_ee_enabled():\n        project_uuid = None' in source
    assert 'chart_payload["project_id"] = project_uuid' in source


def test_standalone_chart_payload_keeps_designer_query_fields():
    from src.modules.charts.router import _normalize_chart_payload

    chart_payload, layout = _normalize_chart_payload(
        {
            "dataSourceId": "ds_1",
            "chartType": "bar",
            "title": "Sales",
            "layout": {"x": 0, "y": 0, "w": 6, "h": 5},
            "chartQuery": {
                "tableName": "orders",
                "x": "region",
                "xGrain": "month",
                "groupField": "segment",
                "filters": [{"field": "status", "operator": "eq", "value": "paid"}],
                "metricFilters": [{"field": "amount", "aggregation": "sum", "operator": "gt", "value": 10}],
                "limit": 20,
                "seriesLimit": 5,
            },
        }
    )

    assert layout == {"x": 0, "y": 0, "w": 6, "h": 5}
    assert chart_payload["chart_options"]["layout"] == layout
    assert chart_payload["chart_query"]["tableName"] == "orders"
    assert chart_payload["chart_query"]["xGrain"] == "month"
    assert chart_payload["chart_query"]["groupField"] == "segment"
    assert chart_payload["chart_query"]["filters"] == [{"field": "status", "operator": "eq", "value": "paid"}]
    assert chart_payload["chart_query"]["metricFilters"] == [
        {"field": "amount", "aggregation": "sum", "operator": "gt", "value": 10}
    ]
    assert chart_payload["chart_query"]["limit"] == 20
    assert chart_payload["chart_query"]["seriesLimit"] == 5


def test_sample_duckdb_missing_file_uses_demo_fallback(monkeypatch):
    import sys
    import types

    monkeypatch.setitem(sys.modules, "duckdb", types.SimpleNamespace(DuckDBPyConnection=object))

    from src.modules.charts.models import Chart
    from src.modules.charts.services.v2.chart_service import ChartService

    monkeypatch.setenv("SAMPLE_DATA_DUCKDB_PATH", "/tmp/aicser-missing-sample.duckdb")
    monkeypatch.setattr("src.modules.charts.services.v2.chart_service.os.path.isfile", lambda path: False)

    service = ChartService(None)
    assert service._sample_duckdb_file_available() is False

    chart = Chart(
        title="Students by Status",
        chart_type="bar",
        data_source_id="sample",
        chart_query={"x": "status"},
        chart_options={},
    )
    result = service._sample_template_fallback_result(chart)

    assert result["x"]
    assert result["y"]
    assert result["series"][0]["data"] == result["y"]
