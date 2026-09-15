"""Tests for planner analyze-then-export routing."""
from ee.modules.ai.kernel.planner import _infer_export_skill
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


def test_referenced_filename_is_not_hijacked_into_export():
    """Reproduces a live bug: a user asking a follow-up KB question that
    names one of their own documents by filename -- "What else does
    ABA_FY2024_Audited_FS-EN.pdf say about this topic?" -- had the request
    hijacked into a content-less PDF export (bypassing RAG entirely, the user
    got "PDF report report_....html is ready to download" instead of an
    answer). Root cause: \\b(pdf|\\.pdf)\\b matches the ".pdf" extension
    inside any filename ("\\b" only requires a word/non-word transition,
    which "." satisfies just as well as whitespace). Same false-positive
    shape as the "report" bug above, for file extensions instead of a bare
    word. A plain filename mention with no export verb must produce no plan
    at all, so it falls through to normal (RAG) routing."""
    for q in (
        "What else does ABA_FY2024_Audited_FS-EN.pdf say about this topic?",
        "Summarize contract_v2_final.docx for me",
        "What's in quarterly_metrics.xlsx?",
        "Compare notes.pptx with the other file",
        "Does sales_2026.csv include EU regions?",
    ):
        assert _infer_plan_steps(q) == [], q
        assert _infer_export_skill(q) is None, q


def test_bare_format_word_still_triggers_export_without_a_filename():
    """Control case: the fix must not lose real format-only export intent
    when the word isn't attached to a referenced filename."""
    assert _infer_export_skill("give me this as a pdf") == "generate_pdf"
    assert _infer_export_skill("can you export a csv of this") == "generate_csv"
    steps = _infer_plan_steps("give me this as a pdf")
    assert any(s.get("skill") == "generate_pdf" for s in steps)
