from src.modules.ai.surface_context_schema import SurfaceContext, surface_context_to_state_patch


def test_dashboard_explain_sets_analyze_lifecycle():
    ctx = SurfaceContext(
        surface="dashboard",
        surface_ref={"id": "dash-1"},
        intent="explain",
        selection={"widget_id": "w-9"},
    )
    patch = surface_context_to_state_patch(ctx)
    assert patch["target_dashboard_id"] == "dash-1"
    assert patch["target_widget_id"] == "w-9"
    assert patch["dashboard_lifecycle_action"] == "analyze"


def test_dashboard_ask_defaults_to_analyze():
    ctx = SurfaceContext(
        surface="dashboard",
        surface_ref={"id": "dash-2"},
        intent="ask",
    )
    patch = surface_context_to_state_patch(ctx)
    assert patch["dashboard_lifecycle_action"] == "analyze"


def test_notebook_build_sets_analysis_mode():
    ctx = SurfaceContext(surface="notebook", surface_ref={"id": "nb-1"}, intent="build")
    patch = surface_context_to_state_patch(ctx)
    assert patch["_analysis_mode_override"] == "notebook"


def test_notebook_ask_sets_advisor_mode():
    ctx = SurfaceContext(surface="notebook", surface_ref={"id": "nb-2"}, intent="ask")
    patch = surface_context_to_state_patch(ctx)
    assert patch["_analysis_mode_override"] == "notebook_advisor"


def test_sheet_ask_sets_advisor_mode():
    ctx = SurfaceContext(surface="sheet", surface_ref={"id": "wb-1"}, intent="explain")
    patch = surface_context_to_state_patch(ctx)
    assert patch["_analysis_mode_override"] == "sheet_advisor"


def test_sheet_refine_sets_advisor_and_embedded_flag():
    ctx = SurfaceContext(
        surface="sheet",
        surface_ref={"id": "wb-2"},
        intent="refine",
        artifacts={"tables": [{"id": "t1", "row_count": 3}]},
    )
    patch = surface_context_to_state_patch(ctx)
    assert patch["_analysis_mode_override"] == "sheet_advisor"
    assert patch.get("surface_embedded_data") is True
