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


def test_bare_report_request_is_not_hijacked_into_docx_export():
    """Reproduces a live bug: "create a report for important insights" used to
    match bare "report" in the old generate_docx trigger, find no analysis
    keywords in "important insights" (needs_analysis_before_export's own gap),
    and fall into the export-only branch - producing [research (RAG - searching
    a knowledge base that may not even exist for the active data source),
    generate_docx (which then fails its own L2 approval gate)] instead of ever
    reaching the executive_report pipeline that should have answered it.
    A plain "report" ask with no explicit file/export verb must produce no
    plan at all, so it falls through to normal routing."""
    for q in (
        "create a report for important insights",
        "give me a report on this quarter's performance",
        "I need a report on customer churn",
    ):
        assert _infer_plan_steps(q) == []


def test_report_with_explicit_export_verb_still_triggers_docx():
    """The fix must not lose real export intent - "export"/"download"/"email me"
    alongside "report" is unambiguous."""
    for q in (
        "export this report as a word document",
        "download the report",
        "email me a report on revenue",
    ):
        steps = _infer_plan_steps(q)
        assert any(s.get("skill") == "generate_docx" for s in steps), q
