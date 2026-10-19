from src.modules.ai.surface_connectivity import (
    connectivity_from_surface_context,
    request_has_analyzable_data,
    surface_has_embedded_data,
)


def test_connectivity_from_sheet_tables():
    sc = {
        "surface": "sheet",
        "artifacts": {"tables": [{"id": "t1", "row_count": 10, "sample_rows": [{}] * 5}]},
    }
    conn = connectivity_from_surface_context(sc)
    assert conn["has_embedded_grid_data"] is True
    assert conn["can_analyze_without_sidebar_source"] is True
    assert "table" in conn["summary"].lower()


def test_request_has_data_without_sidebar_id():
    sc = {"artifacts": {"widgets": [{"id": "w1"}]}}
    assert request_has_analyzable_data(None, sc) is True
    assert request_has_analyzable_data("ds-1", None) is True
    assert request_has_analyzable_data(None, {"artifacts": {}}) is False


def test_surface_has_embedded_data_state():
    state = {
        "surface_context": {
            "surface": "notebook",
            "artifacts": {"cells": [{"id": "c1"}]},
        }
    }
    assert surface_has_embedded_data(state) is True
