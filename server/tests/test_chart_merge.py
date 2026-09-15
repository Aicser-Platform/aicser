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


def test_resolve_table_from_chart_looks_up_real_schema_for_bare_table_name():
    """Regression: a live user's dashboard against the multi-domain sample
    DuckDB (education.grades, education.enrollments, ...) showed fabricated
    "Segment A/B/C/D" placeholder data instead of real grade letters (A-F).
    Root cause: chart_query.tableName is stored bare ("grades", no schema
    prefix) by the dashboard widget builders, but _resolve_table_from_chart's
    bare-name branch defaulted to _default_schema() unconditionally instead
    of looking up the table's real schema in schema_info -- so the query ran
    against "grades" in the default schema (which doesn't exist there; the
    real table is "education"."grades"), raised, and for a sample_duckdb
    source that exception used to be silently swallowed into fabricated
    data. _base_table_schema_name already does this exact per-table lookup
    correctly elsewhere in this class (3 other call sites) -- this test
    pins the bare-tableName path to use it too."""
    from src.modules.charts.services.v2.chart_service import ChartService

    schema_info = {
        "tables": [
            {"name": "grades", "schema": "education", "columns": [{"name": "grade_letter"}]},
            {"name": "enrollments", "schema": "education", "columns": [{"name": "enrolled_at"}]},
        ]
    }
    service = ChartService(None)

    table, schema = service._resolve_table_from_chart({"tableName": "grades"}, schema_info)
    assert table == "grades"
    assert schema == "education"

    table2, schema2 = service._resolve_table_from_chart({"tableName": "enrollments"}, schema_info)
    assert table2 == "enrollments"
    assert schema2 == "education"


def test_resolve_table_from_chart_still_honors_explicit_schema_prefix():
    """Control case: a tableName that already includes "schema.table" must
    keep using the explicit schema, unaffected by the bare-name fix above."""
    from src.modules.charts.services.v2.chart_service import ChartService

    schema_info = {"tables": [{"name": "grades", "schema": "education"}]}
    service = ChartService(None)

    table, schema = service._resolve_table_from_chart({"tableName": "public.grades"}, schema_info)
    assert schema == "public"


def test_sample_fallback_only_reachable_from_file_availability_checks():
    """Regression: _sample_template_fallback_result's fabricated placeholder
    data used to be reachable from generic "except Exception" / query-failure
    branches too -- meaning ANY bug in query execution against a sample_duckdb
    source (not just the intended "sample file genuinely absent" case) got
    silently hidden behind plausible-looking made-up numbers instead of a
    real error. Pins the source-level fix: the fallback call is now only
    reachable from the explicit _sample_duckdb_file_available() checks."""
    import inspect

    from src.modules.charts.services.v2 import chart_service as mod

    source = inspect.getsource(mod.ChartService.execute)
    # Two legitimate call sites remain, each immediately preceded by the
    # file-availability guard on the same or prior line.
    assert source.count("_sample_template_fallback_result") == 2
    for guarded in (
        'if data_source.type == "sample_duckdb" and not self._sample_duckdb_file_available():\n'
        '                return self._sample_template_fallback_result(chart)',
        'if data_source.type == "sample_duckdb" and not self._sample_duckdb_file_available():\n'
        '            return self._sample_template_fallback_result(chart)',
    ):
        assert guarded in source, guarded
