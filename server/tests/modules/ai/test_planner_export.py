"""Tests for planner analyze-then-export routing."""
from ee.modules.ai.nodes.planner_node import _infer_plan_steps, needs_analysis_before_export


def test_export_only_skips_analysis():
    assert not needs_analysis_before_export("Export this to Excel")
    steps = _infer_plan_steps("Export this to Excel")
    skills = [s.get("skill") for s in steps if s.get("type") == "skill"]
    assert "generate_xlsx" in skills
    assert not any(s.get("type") == "analyze" for s in steps)


def test_combined_query_includes_analysis():
    q = "Show revenue by month and export to Excel"
    assert needs_analysis_before_export(q)
    steps = _infer_plan_steps(q)
    assert steps[0]["type"] == "analyze"
    assert any(s.get("skill") == "generate_xlsx" for s in steps)


def test_export_prior_results_no_analysis():
    assert not needs_analysis_before_export("Export that to Word document")
    steps = _infer_plan_steps("Export that to Word document")
    assert not any(s.get("type") == "analyze" for s in steps)
    assert any(s.get("skill") == "generate_docx" for s in steps)
