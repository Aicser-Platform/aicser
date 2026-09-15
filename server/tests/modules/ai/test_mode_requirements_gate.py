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


def test_confident_metric_from_query_only_when_clear():
    """Clarification should not fire when the query clearly names a metric."""
    from ee.modules.ai.nodes.mode_requirements_gate_node import (
        _confident_metric_from_query,
    )

    metrics = ["revenue", "cost", "orders"]
    assert _confident_metric_from_query(metrics, "forecast revenue next 6 months") == "revenue"
    assert _confident_metric_from_query(metrics, "what will happen next quarter") is None
    assert _confident_metric_from_query(["value"], "forecast the trend") == "value"


def test_match_choice_maps_qualified_name_to_result_column():
    from ee.modules.ai.nodes.mode_requirements_gate_node import _match_choice_to_candidates

    assert _match_choice_to_candidates("loans.principal_amount", ["principal_amount", "interest_due"]) == "principal_amount"
    assert _match_choice_to_candidates("loans.principal_amount", ["total_principal_amount"]) == "total_principal_amount"


@pytest.mark.asyncio
async def test_prescriptive_gate_does_not_reask_after_user_confirm():
    """After the user picks metric + lever, SQL aliases must not pop the same card again."""
    from ee.modules.ai.nodes.mode_requirements_gate_node import mode_requirements_gate_node

    state = {
        "analytics_type": "prescriptive",
        "query": "what should we do next",
        "query_result": [
            {"branch_name": "A", "total": 100, "count": 3},
            {"branch_name": "B", "total": 80, "count": 2},
            {"branch_name": "C", "total": 60, "count": 1},
            {"branch_name": "D", "total": 40, "count": 1},
            {"branch_name": "E", "total": 20, "count": 1},
        ],
        "clarification_response": {
            "choices": {
                "objective_metric": "loans.principal_amount",
                "lever_dimension": "loans.branch_name",
                "optimization_direction": "maximize",
            }
        },
        "execution_metadata": {},
        "unified_retry_state": {},
    }
    out = await mode_requirements_gate_node(state)
    assert out.get("current_stage") == "mode_requirements_passed"
    assert out.get("needs_clarification") is not True
    params = (out.get("execution_metadata") or {}).get("mode_parameters") or {}
    assert params.get("objective_metric")
    assert params.get("lever_dimension") == "branch_name"


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
