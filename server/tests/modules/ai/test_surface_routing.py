from ee.modules.ai.utils.surface_routing import resolve_surface_advisor_mode


def test_sheet_surface_routes_to_sheet_advisor_without_data_source():
    state = {
        "surface_context": {
            "surface": "sheet",
            "intent": "ask",
            "surface_ref": {"id": "wb-1", "title": "excel"},
            "artifacts": {"sheets": [{"name": "Sheet1"}]},
        },
        "execution_metadata": {"analysis_mode": "standard"},
        "agent_context": {"analysis_mode": "standard"},
    }
    assert resolve_surface_advisor_mode(state) == "sheet_advisor"


def test_sheet_with_tables_refine_still_advisor():
    state = {
        "surface_context": {
            "surface": "sheet",
            "intent": "refine",
            "artifacts": {"tables": [{"id": "t1", "row_count": 50}]},
        },
        "agent_context": {"analysis_mode": "standard"},
    }
    assert resolve_surface_advisor_mode(state) == "sheet_advisor"


def test_notebook_explicit_mode():
    state = {
        "surface_context": {"surface": "notebook", "intent": "explain"},
        "execution_metadata": {"analysis_mode": "notebook_advisor"},
    }
    assert resolve_surface_advisor_mode(state) == "notebook_advisor"


def test_fast_route_skips_conversational_when_embedded_data():
    from ee.modules.ai.utils.routing_utils import fast_route_query

    decision = fast_route_query(
        "analyze revenue by region",
        analysis_mode="sheet_advisor",
        data_source_id=None,
        embedded_surface_data=True,
    )
    assert decision is not None
    assert decision["primary_agent"] == "sheet_advisor"
