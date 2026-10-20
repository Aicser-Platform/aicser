from ee.modules.ai.surface_agent.runner import run_surface_agent_toolkit

TABLE = {
    "id": "t1",
    "name": "Sheet1!A1:D10",
    "columns": ["campus", "status", "amount"],
    "row_count": 8,
    "sample_rows": [["A", "PAID", 100], ["A", "UNPAID", 50], ["B", "PAID", 200]],
}


def test_profiles_whatever_the_question_says():
    # What runs depends on what the workbook holds, never on the wording.
    for question in ("show me a chart by campus", "what's going on here?"):
        run = run_surface_agent_toolkit(question, "sheet", {"workbook_tables": [TABLE]})
        assert run.tools_run == ["profile_tables"]
        assert run.actions == []  # nothing computed from samples for the person to apply
        assert "campus" in run.proof_blocks[0]


def test_dashboard_profiles_widgets_and_proposes_nothing():
    run = run_surface_agent_toolkit(
        "add a KPI for monthly revenue", "dashboard", {"dashboard_widget_catalog": [{"id": "w1", "title": "Revenue", "chart_type": "bar"}]}
    )
    assert run.tools_run == ["profile_widgets"]
    assert run.actions == []
