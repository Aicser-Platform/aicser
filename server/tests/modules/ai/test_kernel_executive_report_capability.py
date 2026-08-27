"""_exec_executive_report called executive_report_planner_node and
executive_report_synthesis_node with an extra litellm positional argument
neither accepts (they each build their own LiteLLMService internally) -
every kernel-routed executive report request raised TypeError before any
report_plan/sections/executive_summary was produced. Since
should_use_agent_kernel() now routes every request through the kernel, this
was a 100% failure rate for "Forecast revenue for Q4 and write it up as an
executive report"-style requests, surfaced to the user as a vague failed
plan step."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_executive_report


@pytest.mark.asyncio
async def test_calls_planner_and_synthesis_with_state_only():
    state = {"query": "quarterly executive report"}
    ctx = {
        "workflow_state": state,
        "litellm_service": object(),
        "multi_query_service": object(),
        "data_service": object(),
    }

    planner_mock = AsyncMock(side_effect=lambda s: {**s, "report_plan": {"sections": []}})
    execution_mock = AsyncMock(side_effect=lambda s, mq, ds: {**s, "report_sections": [{"id": "s1"}]})
    synthesis_mock = AsyncMock(side_effect=lambda s: {**s, "executive_summary": "All good."})

    with patch(
        "src.modules.ai.nodes.executive_report_planner_node.executive_report_planner_node", planner_mock
    ), patch(
        "src.modules.ai.nodes.executive_report_execution_node.executive_report_execution_node", execution_mock
    ), patch(
        "src.modules.ai.nodes.executive_report_synthesis_node.executive_report_synthesis_node", synthesis_mock
    ):
        result = await _exec_executive_report(ctx)

    # Regression: these must be called with ONLY state - a second positional
    # arg (litellm) raises TypeError against the real single-argument nodes.
    planner_mock.assert_awaited_once_with(state)
    synthesis_mock.assert_awaited_once()
    assert len(synthesis_mock.await_args.args) == 1
    execution_mock.assert_awaited_once()
    assert result["success"] is True
    assert result["workflow_state"]["executive_summary"] == "All good."


@pytest.mark.asyncio
async def test_fails_closed_when_services_missing_instead_of_raising():
    state = {"query": "quarterly executive report"}
    ctx = {"workflow_state": state, "litellm_service": object()}

    result = await _exec_executive_report(ctx)

    assert result["success"] is False
    assert "requires query and data services" in result["error"]
