"""execution_metadata["analysis_mode"] used to only get set for decision_intelligence
and the dashboard sticky-follow-up path - every other notable resolution (business
journey, dashboard create, executive report, diagnostic/predictive/prescriptive/
animate) left the frontend's ResolvedModeBadge with nothing backend-sourced to read,
so it fell back entirely to a value the client guessed *before* sending (which can't
know about supervisor_node's own fast-route/template/LLM-orchestration resolution).
Fixed by deriving a resolved mode once, right before return, from the now-authoritative
route_stage / analytics_type - without overwriting the two paths that already set it."""

from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.nodes.supervisor_node import supervisor_node


def _base_state(query: str, **overrides) -> dict:
    """A non-empty schema is required here (unlike test_supervisor_skill_reachability's
    fixture) - an empty tables list makes supervisor_node bail into its clarification
    loop (current_stage="supervisor_needs_clarification") before ever reaching the
    resolved-mode computation these tests exercise, which sits right before return."""
    state = {
        "query": query,
        "user_id": "u1",
        "organization_id": None,
        "data_source_id": "ds1",
        "data_source_schema": {"tables": [{"name": "orders", "columns": [{"name": "revenue"}]}]},
        "agent_context": {"analysis_mode": "auto"},
    }
    state.update(overrides)
    return state


@pytest.mark.asyncio
async def test_diagnostic_selection_resolves_without_llm_call():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(side_effect=AssertionError("should not be called"))

    state = _base_state("why did revenue drop", analytics_type="diagnostic")
    out = await supervisor_node(state, litellm_service=mock)

    assert out["execution_metadata"]["analysis_mode"] == "diagnostic"


@pytest.mark.asyncio
async def test_executive_report_resolves_to_executive_report():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("give me a full report on this quarter's performance")
    state["agent_context"] = {"analysis_mode": "executive_report"}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["execution_metadata"]["analysis_mode"] == "executive_report"


@pytest.mark.asyncio
async def test_business_journey_resolves_to_business_journey():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("how is my business performing this quarter")
    state["agent_context"] = {"analysis_mode": "business_journey"}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["execution_metadata"]["analysis_mode"] == "business_journey"


@pytest.mark.asyncio
async def test_decision_intelligence_still_set_by_its_own_branch_not_overwritten():
    mock = AsyncMock()
    mock.generate_completion = AsyncMock(return_value={"success": True, "content": "{}"})

    state = _base_state("why did churn spike and what should we do")
    state["agent_context"] = {"analysis_mode": "decision_intelligence"}
    out = await supervisor_node(state, litellm_service=mock)

    assert out["execution_metadata"]["analysis_mode"] == "decision_intelligence"
