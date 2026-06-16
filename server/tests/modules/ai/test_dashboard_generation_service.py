"""Tests for AI dashboard generation planning."""

from src.modules.ai.services.dashboard_generation_service import (
    plan_dashboard_widgets,
    _pick_focus_columns,
    _classify_columns,
    _heuristic_flat_widgets,
    _merge_widget_specs,
)


def test_plan_dashboard_widgets_includes_kpi_and_charts():
    schema = {
        "tables": [
            {
                "name": "sales",
                "columns": [
                    {"name": "order_date", "type": "timestamp"},
                    {"name": "region", "type": "varchar"},
                    {"name": "revenue", "type": "float"},
                ],
            }
        ]
    }
    widgets = plan_dashboard_widgets("Sales dashboard", schema, "sales")
    types = {w["chart_type"] for w in widgets}
    assert "stat" in types
    assert "bar" in types or "line" in types
    assert len(widgets) >= 3
    drill_widgets = [w for w in widgets if w.get("chart_query", {}).get("drillPath")]
    assert drill_widgets, "Expected at least one widget with drillPath"


def test_classify_columns_recognizes_jsonschema_number_type():
    """File-uploaded schemas use JSON-schema types: 'number' floats must be numeric, not categorical."""
    schema = {
        "columns": [
            {"name": "Quantity", "type": "integer"},
            {"name": "UnitPrice", "type": "number"},
            {"name": "TotalPrice", "type": "number"},
            {"name": "Region", "type": "string"},
        ]
    }
    cols = _classify_columns(schema, "data")
    assert "UnitPrice" in cols["numeric"]
    assert "TotalPrice" in cols["numeric"]
    assert "Quantity" in cols["numeric"]
    assert "UnitPrice" not in cols["categorical"]


def test_classify_columns_detects_date_named_string_columns_as_temporal():
    """File inference types dates as 'string'; date-named columns must still be temporal."""
    schema = {
        "columns": [
            {"name": "OrderDate", "type": "string"},
            {"name": "DeliveryDate", "type": "string"},
            {"name": "Region", "type": "string"},
            {"name": "CustomerName", "type": "string"},
        ]
    }
    cols = _classify_columns(schema, "data")
    assert "OrderDate" in cols["temporal"]
    assert "DeliveryDate" in cols["temporal"]
    assert "OrderDate" not in cols["categorical"]
    # Non-date strings stay categorical
    assert "Region" in cols["categorical"]
    assert "CustomerName" in cols["categorical"]


def test_classify_columns_skips_uuid_style_names():
    schema = {
        "tables": [
            {
                "name": "t",
                "columns": [
                    {"name": "transaction_uuid", "type": "varchar"},
                    {"name": "amount", "type": "float"},
                ],
            }
        ]
    }
    cols = _classify_columns(schema, "t")
    assert "transaction_uuid" not in cols["categorical"]
    assert "amount" in cols["numeric"]


def test_classify_columns_skips_surrogate_numeric_ids():
    schema = {
        "tables": [
            {
                "name": "loans",
                "columns": [
                    {"name": "loan_id", "type": "bigint"},
                    {"name": "npl_flag", "type": "varchar"},
                    {"name": "principal", "type": "decimal"},
                ],
            }
        ]
    }
    cols = _classify_columns(schema, "loans")
    assert "loan_id" not in cols["numeric"]
    assert "principal" in cols["numeric"]
    focus = _pick_focus_columns("KPI dashboard", cols)
    assert focus["metric"] == "principal"
    assert focus["dimension"] == "npl_flag"


def test_plan_dashboard_widgets_avoids_aggregating_loan_id():
    schema = {
        "tables": [
            {
                "name": "loans",
                "columns": [
                    {"name": "loan_id", "type": "bigint"},
                    {"name": "segment", "type": "varchar"},
                ],
            }
        ]
    }
    widgets = plan_dashboard_widgets("Executive overview", schema, "loans")
    for w in widgets:
        cq = w.get("chart_query") or {}
        for m in cq.get("yMetrics") or []:
            assert m.get("field") != "loan_id"


def test_pick_focus_columns_from_prompt_keywords():
    schema = {
        "tables": [
            {
                "name": "orders",
                "columns": [
                    {"name": "order_date", "type": "timestamp"},
                    {"name": "region", "type": "varchar"},
                    {"name": "revenue", "type": "float"},
                    {"name": "product_name", "type": "varchar"},
                ],
            }
        ]
    }
    cols = _classify_columns(schema, "orders")
    focus = _pick_focus_columns("Revenue trend by region over time", cols)
    assert focus["metric"] == "revenue"
    assert focus["dimension"] == "region"
    assert focus["time_dim"] == "order_date"


def test_plan_dashboard_widgets_drill_through_when_detail_page():
    schema = {
        "tables": [
            {
                "name": "sales",
                "columns": [
                    {"name": "order_date", "type": "timestamp"},
                    {"name": "region", "type": "varchar"},
                    {"name": "revenue", "type": "float"},
                ],
            }
        ]
    }
    detail_id = "00000000-0000-4000-8000-000000000001"
    widgets = plan_dashboard_widgets(
        "Sales by region with table breakdown",
        schema,
        "sales",
        detail_page_id=detail_id,
    )
    bar = next(w for w in widgets if w["chart_type"] == "bar")
    assert bar["chart_query"]["drillThrough"]["targetPageId"] == detail_id
    detail_table = next((w for w in widgets if w.get("page_id") == detail_id), None)
    assert detail_table is not None
    assert detail_table["chart_type"] == "table"


def test_heuristic_flat_widgets_includes_story_headline():
    schema = {
        "tables": [
            {
                "name": "sales",
                "columns": [
                    {"name": "region", "type": "varchar"},
                    {"name": "revenue", "type": "float"},
                ],
            }
        ]
    }
    widgets = _heuristic_flat_widgets("Revenue by region", schema, "sales", None)
    assert widgets[0]["chart_type"] == "text"
    assert widgets[0]["page_role"] == "overview"
    assert "content" in widgets[0]["chart_options"]


def test_merge_widget_specs_fills_partial_llm_output():
    partial = [
        {
            "name": "Headline",
            "chart_type": "text",
            "layout": {"x": 0, "y": 0, "w": 12, "h": 2},
            "page_role": "overview",
            "chart_query": {},
            "chart_options": {"content": "Story"},
        }
    ]
    filler = _heuristic_flat_widgets("Revenue by region", {
        "tables": [{"name": "sales", "columns": [{"name": "region", "type": "varchar"}, {"name": "revenue", "type": "float"}]}]
    }, "sales", None)
    merged = _merge_widget_specs(partial, filler, min_count=4)
    assert len(merged) >= 4
    assert merged[0]["chart_type"] == "text"
