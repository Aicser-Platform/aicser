"""Tests for dashboard KPI validator and embed payload errors."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from ee.modules.ai.services.dashboard_kpi_validator import (
    apply_insight_trend_fallback,
    enrich_stat_chart_query,
    enrich_widget_spec_for_kpi,
    stat_result_is_rich,
)


def test_enrich_stat_chart_query_adds_temporal_axis():
    schema = {
        "tables": [
            {
                "name": "orders",
                "columns": [
                    {"name": "order_date", "type": "date"},
                    {"name": "amount", "type": "numeric"},
                ],
            }
        ]
    }

    def classify(_schema, _table):
        return {"temporal": ["order_date"], "numeric": ["amount"], "categorical": []}

    query, options = enrich_stat_chart_query(
        {"yMetrics": [{"field": "amount", "aggregation": "sum"}]},
        {},
        schema=schema,
        table_name="orders",
        classify_columns_fn=classify,
    )
    assert query["x"] == "order_date"
    assert query["xGrain"] == "month"
    assert options["showSparkline"] is True


def test_apply_insight_trend_fallback_parses_percent():
    options = apply_insight_trend_fallback({}, "Revenue ↑22% vs prior month — on track")
    assert options["trendValue"] == "↑22%"


def test_stat_result_is_rich_with_comparison():
    assert stat_result_is_rich({"value": 10, "comparisonValue": 8}) is True
    assert stat_result_is_rich({"value": 10}) is False


def test_enrich_widget_spec_for_kpi_stat_only():
    spec = {"chart_type": "bar", "chart_query": {}}
    out = enrich_widget_spec_for_kpi(
        spec,
        schema={},
        table_name="orders",
        classify_columns_fn=lambda *_: {"temporal": [], "numeric": [], "categorical": []},
    )
    assert out is spec
    assert "x" not in spec["chart_query"]


@pytest.mark.asyncio
async def test_build_embed_payload_surfaces_widget_error():
    from src.modules.dashboards import operations as dash_ops

    chart = MagicMock()
    chart.id = uuid4()
    chart.title = "Revenue KPI"
    chart.chart_type = "stat"
    chart.data_source_id = uuid4()
    chart.chart_options = {"showTrend": True}
    chart.chart_query = {"aggregate": "count"}

    dash = MagicMock()
    dash.id = uuid4()
    dash.name = "Sales"
    dash.description = "Overview"
    dash.config = {"key_insight": "Revenue up 12%."}

    chart_svc = MagicMock()
    chart_svc.list_charts_with_layout = AsyncMock(return_value=[(chart, {"x": 0, "y": 0, "w": 3, "h": 4})])
    chart_svc.chart_service.execute = AsyncMock(side_effect=RuntimeError("connection refused"))

    dash_svc = MagicMock()
    dash_svc.get_by_id = AsyncMock(return_value=dash)

    with patch.object(dash_ops, "DashboardService", return_value=dash_svc), patch.object(
        dash_ops, "DashboardChartService", return_value=chart_svc
    ):
        payload = await dash_ops.build_embed_payload(MagicMock(), dash.id)

    assert payload["config"]["key_insight"] == "Revenue up 12%."
    assert len(payload["widgets"]) == 1
    assert payload["widgets"][0]["success"] is False
    assert "connection refused" in payload["widgets"][0]["error"]
