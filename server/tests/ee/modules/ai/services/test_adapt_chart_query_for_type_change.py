"""A chat-driven "update this widget's chart type" edit (dashboard_lifecycle_node's
refine/update tool) never asks the LLM for a new chart_query - only chart_type
itself is solicited. Without adaptation, an existing stat widget's chart_query
(no 'x' field at all) survived untouched under a switched chart_type, always
rendering an incompatible shape. These mirror the same deterministic rules
already covered client-side for a manual chart-type switch
(chartTypeMappingPreserve.test.ts) so both paths degrade the same safe way."""

from ee.modules.ai.services.dashboard_widget_validator import (
    adapt_chart_query_for_type_change,
)


def test_no_change_when_type_is_unchanged():
    q = {"x": "region", "yMetrics": [{"field": "revenue", "aggregation": "sum"}]}
    assert adapt_chart_query_for_type_change(q, "bar", "bar") == q


def test_trims_y_metrics_to_one_for_single_metric_types():
    q = {
        "x": "region",
        "yMetrics": [
            {"field": "revenue", "aggregation": "sum"},
            {"field": "cost", "aggregation": "sum"},
        ],
    }
    result = adapt_chart_query_for_type_change(q, "bar", "stat")
    assert len(result["yMetrics"]) == 1


def test_drops_secondary_axis_when_leaving_bar_line_area():
    q = {
        "x": "region",
        "yMetrics": [{"field": "revenue", "aggregation": "sum"}],
        "yMetricsSecondary": [{"field": "orders", "aggregation": "sum"}],
    }
    result = adapt_chart_query_for_type_change(q, "bar", "pie")
    assert result["yMetricsSecondary"] == []


def test_seeds_x_metrics_when_entering_scatter():
    q = {"x": "spend", "yMetrics": [{"field": "revenue", "aggregation": "sum"}]}
    result = adapt_chart_query_for_type_change(q, "bar", "scatter")
    assert result["xMetrics"] == [{"field": "spend", "aggregation": "none"}]


def test_stat_to_bar_leaves_missing_x_visible_rather_than_guessing():
    """stat has no 'x' field at all - the migration must not fabricate one out
    of thin air; the resulting widget is correctly left needing configuration
    (surfaced by widgetSetupStatus.ts) rather than silently misconfigured."""
    q = {"yMetrics": [{"field": "revenue", "aggregation": "sum"}]}
    result = adapt_chart_query_for_type_change(q, "stat", "bar")
    assert "x" not in result or not result["x"]
