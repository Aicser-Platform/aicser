"""Mode requirements gate — transparent degradation when clarification exhausts."""

from typing import Any, Dict

import pytest

pytest.importorskip("pandas")


def test_apply_mode_degradation_on_exhausted_clarification():
    from ee.modules.ai.utils.mode_quality import apply_mode_degradation

    state = {"analytics_type": "predictive", "execution_metadata": {}}
    apply_mode_degradation(
        state,
        from_mode="predictive",
        to_mode="descriptive",
        reason="Could not resolve time column after clarification",
    )
    assert state["mode_degraded"] is True
    assert state["mode_degraded_to"] == "descriptive"
    assert state["execution_metadata"]["warnings"]


@pytest.mark.asyncio
async def test_mode_gate_skips_descriptive():
    from ee.modules.ai.nodes.mode_requirements_gate_node import mode_requirements_gate_node

    state = {
        "analytics_type": "descriptive",
        "query_result": [{"a": 1, "b": 2}],
        "execution_metadata": {},
    }
    out = await mode_requirements_gate_node(state)
    assert out.get("current_stage") != "mode_degraded"


def test_fail_sets_needs_clarification_even_with_no_selections():
    """Regression: _fail() used to only set state["needs_clarification"] = True
    deep inside `if selections:` — when no schema/candidate-derived field options
    could be built (missing=None, candidates=None here, guaranteeing an empty
    selections list), the function still set error/error_code/progress_message
    claiming clarification was needed, but never set the one flag
    langgraph_orchestrator._has_clarification() actually checks to turn this into
    a real interrupt the frontend can render a form for. Live-reproduced: "Needs
    clarification to proceed" rendered as inert text with no form, no buttons —
    the workflow had already stopped but left the user with no way to respond.
    needs_clarification must be True regardless of whether any selections could
    be derived, so the frontend's normalizeClarificationInterruptFromPartial
    (which gracefully falls back to a generic confirm/change-question prompt
    when selections is empty) at least gets a chance to run."""
    from ee.modules.ai.nodes.mode_requirements_gate_node import _fail

    state: Dict[str, Any] = {"query": "why did this happen", "data_source_schema": None}
    out = _fail(
        state,
        "diagnostic",
        "Please specify a dimension to break down by.",
        missing=["focus_dimension"],
        candidates=None,
    )

    assert out["needs_clarification"] is True
    assert out["current_stage"] == "mode_requirements_failed"
    assert out["error_code"] == "MODE_REQUIREMENTS_NOT_MET"
