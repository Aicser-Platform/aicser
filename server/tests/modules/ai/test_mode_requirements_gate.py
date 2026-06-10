"""Mode requirements gate — transparent degradation when clarification exhausts."""

import pytest

pytest.importorskip("pandas")


def test_apply_mode_degradation_on_exhausted_clarification():
    from src.modules.ai.utils.mode_quality import apply_mode_degradation

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
