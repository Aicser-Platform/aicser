"""Semantic chart type must match UI switcher (line vs area)."""

from ee.modules.ai.nodes.chart_builder_node import _semantic_chart_type


def test_semantic_prefers_stamped_aiser_chart_type():
    chart = {
        "aiserChartType": "line",
        "series": [{"type": "line", "areaStyle": {"opacity": 0.3}, "data": [1, 2]}],
    }
    assert _semantic_chart_type(chart) == "line"


def test_semantic_area_from_meaningful_fill():
    chart = {"series": [{"type": "line", "areaStyle": {"opacity": 0.3}, "data": [1, 2]}]}
    assert _semantic_chart_type(chart) == "area"


def test_semantic_line_without_fill():
    chart = {"series": [{"type": "line", "data": [1, 2]}]}
    assert _semantic_chart_type(chart) == "line"


def test_semantic_ignores_decorative_hairline_fill():
    chart = {"series": [{"type": "line", "areaStyle": {"opacity": 0.1}, "data": [1, 2]}]}
    assert _semantic_chart_type(chart) == "line"
