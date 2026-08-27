"""The Agent Kernel's analyze_data/analytics_pipeline capabilities used to call
analytics_node() directly on just the base NL2SQL result. For advanced modes
(predictive/diagnostic/prescriptive) that base result can legitimately be
empty (e.g. "forecast next 3 months" translates into a query for dates that
don't exist yet), because the real evidence-gathering step - mode_query_planner_node
-> multi_query_execution_node, which the classic supervisor graph always runs
before analytics_node for these modes - was skipped entirely in the kernel path.
This regressed "Forecast" mode to "query returned no results" once
should_use_agent_kernel() started routing every request through the kernel.
_maybe_build_deep_analytics_evidence() closes that gap."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import (
    _exec_analyze_data,
    _maybe_build_deep_analytics_evidence,
)


@pytest.mark.asyncio
async def test_descriptive_mode_skips_evidence_gathering():
    state = {"analytics_type": "descriptive", "query_result": []}
    mqs = AsyncMock()
    dsvc = AsyncMock()
    out = await _maybe_build_deep_analytics_evidence({"multi_query_service": mqs, "data_service": dsvc}, state)
    assert out is state
    mqs.assert_not_called()


@pytest.mark.asyncio
async def test_predictive_mode_runs_mode_query_planner_and_multi_query_execution():
    state = {"analytics_type": "predictive", "query_result": []}
    mqs = object()
    dsvc = object()

    planner_mock = AsyncMock(side_effect=lambda s: {**s, "mode_query_plan": {"queries": ["q1"]}})
    executor_mock = AsyncMock(side_effect=lambda s, mq, ds: {**s, "query_result": [{"month": "2026-01", "amount": 100}]})

    with patch(
        "src.modules.ai.nodes.mode_query_planner_node.mode_query_planner_node", planner_mock
    ), patch(
        "src.modules.ai.nodes.multi_query_execution_node.multi_query_execution_node", executor_mock
    ):
        out = await _maybe_build_deep_analytics_evidence({"multi_query_service": mqs, "data_service": dsvc}, state)

    planner_mock.assert_awaited_once()
    executor_mock.assert_awaited_once()
    assert executor_mock.await_args.args[1] is mqs
    assert executor_mock.await_args.args[2] is dsvc
    assert out["query_result"] == [{"month": "2026-01", "amount": 100}]


@pytest.mark.asyncio
async def test_predictive_mode_skips_evidence_gathering_when_services_unavailable():
    """Kernel test fixtures (and some real call sites) pass litellm_service=None
    and no multi_query_service/data_service - must fail open, not crash."""
    state = {"analytics_type": "predictive", "query_result": []}
    out = await _maybe_build_deep_analytics_evidence({}, state)
    assert out is state


@pytest.mark.asyncio
async def test_exec_analyze_data_wires_evidence_before_analytics_node():
    state = {"analytics_type": "predictive", "query_result": []}
    ctx = {"workflow_state": state, "multi_query_service": object(), "data_service": object()}

    call_order = []

    async def fake_evidence(ctx_arg, state_arg):
        call_order.append("evidence")
        return {**state_arg, "query_result": [{"month": "2026-01", "amount": 100}]}

    async def fake_analytics_node(state_arg, litellm_service=None):
        call_order.append("analytics_node")
        assert state_arg["query_result"], "analytics_node must see evidence-gathered data, not the empty base result"
        return state_arg

    with patch(
        "ee.modules.ai.kernel.capability_registry._maybe_build_deep_analytics_evidence", fake_evidence
    ), patch("ee.modules.ai.nodes.analytics_node.analytics_node", fake_analytics_node):
        result = await _exec_analyze_data(ctx)

    assert call_order == ["evidence", "analytics_node"]
    assert result["success"] is True
