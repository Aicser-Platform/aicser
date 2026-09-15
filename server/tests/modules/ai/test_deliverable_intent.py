"""Report + file-format intent must not fall through to NL2SQL.

Live: "create me a report of data insights in power point" was classified as
standard Analyze, NL2SQL produced no SQL, and the user got "I wasn't able to
translate your question into a query" instead of an executive report + PPTX.
"""

from ee.modules.ai.nodes.planner_node import _collect_export_steps, _infer_plan_steps
from ee.modules.ai.utils.routing_utils import (
    attach_requested_deliverables,
    detect_requested_export_formats,
    infer_analysis_mode_from_query,
    query_looks_like_deliverable,
    query_wants_full_report,
)


SCREENSHOT_QUERY = "create me a report of data insights in power point"


def test_screenshot_query_is_executive_report_not_sql():
    assert query_wants_full_report(SCREENSHOT_QUERY)
    assert infer_analysis_mode_from_query(SCREENSHOT_QUERY) == "executive_report"
    assert detect_requested_export_formats(SCREENSHOT_QUERY) == ["pptx"]


def test_power_point_two_words_is_pptx():
    for q in (
        "export as power point",
        "in PowerPoint",
        "as a pptx",
        "make slides from this report",
    ):
        assert "pptx" in detect_requested_export_formats(q), q


def test_filename_mention_is_not_an_export():
    assert detect_requested_export_formats("What else does notes.pptx say?") == []


def test_dashboard_export_is_not_a_new_report():
    q = "export this dashboard as a PowerPoint presentation"
    assert infer_analysis_mode_from_query(q) != "executive_report"


def test_bare_insights_report_without_format_still_routes_to_report():
    q = "create a report for important insights"
    assert infer_analysis_mode_from_query(q) == "executive_report"
    assert _infer_plan_steps(q) == []


def test_attach_defers_pptx_after_report_content():
    state = {
        "agent_context": {"analysis_mode": "executive_report"},
        "execution_metadata": {},
    }
    attach_requested_deliverables(state, SCREENSHOT_QUERY)
    skills = [s["skill"] for s in (state.get("deferred_export_skills") or [])]
    assert "generate_pptx" in skills
    assert state["execution_metadata"]["requested_export_formats"] == ["pptx"]


def test_planner_matches_power_point_as_pptx():
    skills = [s.get("skill") for s in _collect_export_steps(SCREENSHOT_QUERY)]
    assert "generate_pptx" in skills


def test_screenshot_query_looks_like_deliverable():
    assert query_looks_like_deliverable(SCREENSHOT_QUERY)
    assert query_looks_like_deliverable("make slides of this analysis")
    assert not query_looks_like_deliverable("how many customers signed up last month")


def test_attach_prefers_llm_formats_over_regex():
    state = {
        "agent_context": {"analysis_mode": "standard"},
        "execution_metadata": {},
    }
    attach_requested_deliverables(state, "create me a report of data insights", formats=["pptx"])
    skills = [s["skill"] for s in (state.get("deferred_export_skills") or [])]
    assert "generate_pptx" in skills
    assert state["execution_metadata"]["requested_export_formats"] == ["pptx"]
    assert state["execution_metadata"]["requested_export_formats_llm"] == ["pptx"]
