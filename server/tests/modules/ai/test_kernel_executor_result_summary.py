"""_summarize_result (kernel/executor.py) — the one-line result_summary shown
per step in AgentPlanPanel's checklist.

Regression coverage: this used to only check top-level `result` keys, but the
most common kernel capability (_exec_analytics_pipeline) nests everything
inside result["workflow_state"] instead, so it almost always fell through to
the generic "Step completed" fallback regardless of how much the step
actually produced. See executor.py's own docstring on _summarize_result for
the full reasoning.
"""

from ee.modules.ai.kernel.executor import _summarize_result


def test_prefers_executive_summary_when_nested_in_workflow_state():
    result = {
        "success": True,
        "workflow_state": {
            "executive_summary": "Revenue grew 12% month-over-month, driven mainly by the enterprise segment.",
            "insights": [{"title": "Enterprise segment drove growth"}],
            "query_result": [{"a": 1}] * 10,
            "echarts_config": {"series": []},
        },
    }
    assert _summarize_result(result) == "Revenue grew 12% month-over-month, driven mainly by the enterprise segment."


def test_falls_back_to_top_insight_headline_when_no_executive_summary():
    result = {
        "success": True,
        "workflow_state": {
            "insights": [
                {"title": "Churn spiked in the EU region"},
                {"title": "Second insight"},
            ],
        },
    }
    assert _summarize_result(result) == "Churn spiked in the EU region (+1 more)"


def test_chart_with_row_count_from_nested_query_result():
    result = {
        "success": True,
        "workflow_state": {
            "echarts_config": {"series": []},
            "query_result": [{"a": 1}, {"a": 2}, {"a": 3}],
        },
    }
    assert _summarize_result(result) == "Chart built from 3 rows"


def test_query_only_row_count_no_chart_yet():
    result = {
        "success": True,
        "workflow_state": {"query_result": [{"a": 1}]},
    }
    assert _summarize_result(result) == "Query returned 1 row"


def test_dashboard_created_still_works_top_level():
    result = {
        "success": True,
        "dashboard_created": {"dashboard_id": "abc123", "widget_count": 6},
    }
    assert _summarize_result(result) == "Dashboard abc123 with 6 widgets"


def test_report_sections_nested_in_workflow_state():
    result = {
        "success": True,
        "workflow_state": {"report_sections": [{"title": "A"}, {"title": "B"}, {"title": "C"}]},
    }
    assert _summarize_result(result) == "Report with 3 sections"


def test_recommendations_only_fallback():
    result = {
        "success": True,
        "workflow_state": {"recommendations": [{"title": "Do X"}, {"title": "Do Y"}]},
    }
    assert _summarize_result(result) == "2 recommendations ready"


def test_generic_fallback_when_nothing_meaningful_present():
    result = {"success": True, "workflow_state": {}}
    assert _summarize_result(result) == "Step completed"


def test_short_executive_summary_does_not_win_over_insights():
    """A trivially short/placeholder executive_summary (<15 chars) shouldn't
    win over a real insight headline - guards the length floor."""
    result = {
        "success": True,
        "workflow_state": {
            "executive_summary": "N/A",
            "insights": [{"what": "Sales dipped in Q3"}],
        },
    }
    assert _summarize_result(result) == "Sales dipped in Q3"
