"""Tests for sticky dashboard lifecycle intent detection (no full app bootstrap)."""

# RELIABILITY: this file used to install a fake sys.modules["src"] (a bare
# types.ModuleType with no __path__) before importing dashboard_lifecycle_node,
# to dodge a heavier import chain from a stale "src.modules.ai.schemas.graph_state"
# path that predates the ee.modules.ai module boundary this codebase now uses.
# That path no longer exists anywhere, so the stub's own guard
# ("if 'src.modules.ai.schemas.graph_state' in sys.modules: return") never
# short-circuited - it unconditionally clobbered the REAL "src" package (server/src,
# a real, working package with real submodules like src.db.session) for the rest
# of the pytest SESSION, not just this file. Any other test file collected in the
# same run that needed the real "src" package afterwards (directly, or via
# unittest.mock.patch("src...")) failed with "'src' is not a package" - a
# cross-file test-isolation bug that had nothing to do with whatever it was
# actually testing. detect_dashboard_lifecycle_action is a pure function (no I/O,
# doesn't touch AiserWorkflowState or advance_plan_step at all), so nothing here
# ever needed the stub in the first place - the plain import below works
# standalone and no longer pollutes global interpreter state for sibling test
# files.
from ee.modules.ai.nodes.dashboard_lifecycle_node import detect_dashboard_lifecycle_action


def test_detect_change_chart_is_refine_with_sticky():
    action = detect_dashboard_lifecycle_action(
        "Change the main bar chart to a line chart",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "refine"


def test_detect_explain_widget_is_analyze():
    action = detect_dashboard_lifecycle_action(
        "Explain what the Revenue widget shows and the key takeaway",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "analyze"


def test_detect_add_kpi_is_refine():
    action = detect_dashboard_lifecycle_action(
        "Add a KPI widget to this dashboard",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "refine"


def test_detect_undo():
    action = detect_dashboard_lifecycle_action(
        "Undo the last dashboard change",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "undo"


def test_detect_explicit_create_even_with_sticky():
    action = detect_dashboard_lifecycle_action(
        "Create a new dashboard for sales",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "create"


def test_explicit_action_wins():
    action = detect_dashboard_lifecycle_action(
        "whatever text",
        {"target_dashboard_id": "dash-1", "dashboard_lifecycle_action": "update"},
    )
    assert action == "update"


def test_explicit_undo_wins():
    action = detect_dashboard_lifecycle_action(
        "add a kpi",
        {"target_dashboard_id": "dash-1", "dashboard_lifecycle_action": "undo"},
    )
    assert action == "undo"


def test_standalone_question_with_sticky_dashboard_does_not_run_dashboard_analyzer():
    """Live-reproduced bug: a plain new question ("how many customers monthly over
    brand") while a dashboard was still sticky used to return "analyze", which
    supervisor_node.py dispatches straight to dashboard_analyzer_node - a node that
    summarizes the EXISTING dashboard's own widgets, ignoring the actual question
    entirely. The dashboard itself was never at risk (nothing here writes to it),
    but the response was simply wrong - a summary of unrelated widgets instead of
    an answer. Must return the falsy "not a dashboard action" sentinel so the
    caller falls through to normal analysis routing."""
    for query in (
        "how many customers monthly over brand",
        "how many customers signed up last month",
        "show me revenue by region",
        "what is the average order value",
    ):
        action = detect_dashboard_lifecycle_action(query, {"target_dashboard_id": "dash-1"})
        assert action == "", query


def test_standalone_question_without_sticky_dashboard_still_creates():
    """No sticky dashboard at all (target_dashboard_id unset) must be unaffected -
    the standalone_viz carve-out only applies once a dashboard is already sticky."""
    action = detect_dashboard_lifecycle_action("how many customers monthly over brand", {})
    assert action == "create"


def test_export_request_with_sticky_dashboard_is_not_a_board_edit():
    """Live-reproduced bug: "Export this dashboard as a PowerPoint presentation",
    sent while a dashboard was sticky, fell all the way to the `mentions_board`
    catch-all (the literal token "dashboard" appears in the sentence), which
    returned "refine" - the correctly-matched generate_pptx agent skill
    (supervisor_node.py's Phase -1) never got a chance, and the request was
    silently turned into an LLM "plan widget edits" call for a sentence that
    isn't an edit instruction at all. An export/download request names the
    dashboard as the thing being exported, not an instruction to change it -
    same treatment as the standalone_viz carve-out above."""
    for query in (
        "Export this dashboard as a PowerPoint presentation",
        "download the dashboard as a pdf",
        "export this dashboard as an excel spreadsheet",
        "can you export the dashboard as a word document",
    ):
        action = detect_dashboard_lifecycle_action(query, {"target_dashboard_id": "dash-1"})
        assert action == "", query


def test_export_request_combined_with_explicit_board_edit_still_refines():
    """A query that BOTH explicitly asks to edit the board AND mentions export
    should still be treated as a board edit - the export carve-out only applies
    when there's no explicit board-edit phrase alongside it."""
    action = detect_dashboard_lifecycle_action(
        "add a widget to this dashboard and export it as a pdf",
        {"target_dashboard_id": "dash-1"},
    )
    assert action == "refine"


def test_unrecognized_standalone_question_defaults_to_not_a_dashboard_action():
    """Regression: live bug, one level deeper than the standalone_viz carve-out
    above. "how many customers monthly over brand" is protected because it
    literally contains "how many" - but standalone_viz is a fixed phrase list
    ("how many", "how much", "by region", "by branch", ...), not a general
    pattern, so a same-shaped question worded differently falls through it
    entirely. Before this fix, ANY query matching none of standalone_viz/soft/
    mentions_board fell through to the function's final "return "create"" -
    meaning an unrecognized rewording of a normal question, with a dashboard
    already sticky, built ANOTHER dashboard instead of just being answered.
    Live-reproduced: "count students by grade" (asked right after a dashboard
    had just been created in the same conversation) created a second,
    unwanted "Count Students By Grade" dashboard. None of these deliberately
    avoid every literal phrase in standalone_viz/soft/mentions_board, to prove
    the fix is the general default-to-not-a-dashboard-action behavior, not
    another phrase added to chase this one example."""
    for query in (
        "count students by grade",
        "students per grade level",
        "total revenue this quarter",
        "top 5 products",
        "list all customers in california",
        "average order value last week",
    ):
        action = detect_dashboard_lifecycle_action(query, {"target_dashboard_id": "dash-1"})
        assert action == "", query
