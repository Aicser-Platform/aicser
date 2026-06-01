"""Dashboard PESD service tests."""

import pytest

from src.modules.ai.services.dashboard_pesd_service import (
    build_kpi_sections,
    infer_dashboard_tier,
    synthesize_widget_specs,
)


SAMPLE_SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "order_id", "type": "int"},
                {"name": "revenue", "type": "float"},
                {"name": "region", "type": "varchar"},
                {"name": "order_date", "type": "timestamp"},
            ],
        }
    ]
}


def test_infer_dashboard_tier_executive():
    assert infer_dashboard_tier("Build an executive KPI dashboard for leadership") == "executive"


def test_infer_dashboard_tier_explicit_preference():
    assert infer_dashboard_tier("any prompt", {"dashboard_tier": "monitoring"}) == "monitoring"
    assert infer_dashboard_tier("executive board pack", {"dashboard_tier": "operational"}) == "operational"


def test_build_kpi_sections_minimum_count():
    sections = build_kpi_sections("Revenue by region over time", SAMPLE_SCHEMA, "duckdb", "operational")
    assert len(sections) >= 3


def test_synthesize_widget_specs_meets_minimum():
    executed = [
        {
            "title": "Revenue Trend",
            "chart_type": "line",
            "chart_query": {"tableName": "orders", "x": "order_date", "yMetrics": [{"field": "revenue", "aggregation": "sum"}]},
            "status": "complete",
        }
    ]
    specs, meta = synthesize_widget_specs(executed, SAMPLE_SCHEMA, "orders", min_widgets=6)
    assert len(specs) >= 6
    assert meta.get("generated_by") == "ai_dashboard_pesd"
