"""business_journey had no kernel capability at all before kernel-unification
roadmap step 5 - a compound multi-step plan wanting a business-journey
deliverable alongside something else (e.g. "assess my business and email me
a summary") had no way to include it as one step. This pins _exec_business_journey's
dispatch: business_journey_router_node resolves the phase (from state or by
regex-detecting it from the query, exactly like the classic graph's own router
node), then the matching phase node runs, then response_finalizer_node (passthrough
for business_journey - no grounding gate, no retry, matching executive_report's
treatment) — mirroring graph_builder.py's business_journey_router ->
{assess,strategy,plan,execute,monitor} conditional edges, all four leaf nodes
converging on response_finalizer.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_business_journey


def _ctx(query: str, phase: str | None = None, **extra):
    state = {"query": query, **extra}
    if phase is not None:
        state["business_journey_phase"] = phase
    return {"workflow_state": state}, state


def _finalizer_passthrough_mock():
    """response_finalizer_node's business_journey branch just streams and
    returns state unchanged - a realistic default for these dispatch-focused
    tests, which aren't testing the finalizer itself."""
    return AsyncMock(side_effect=lambda s: s)


@pytest.mark.asyncio
async def test_assess_phase_dispatches_to_assess_business_node():
    ctx, state = _ctx("how is my business doing", phase="assess")
    assess_mock = AsyncMock(return_value={**state, "business_state_snapshot": {"health_score": 80}})
    strategy_mock = AsyncMock()

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.assess_business_node", assess_mock
    ), patch(
        "ee.modules.ai.nodes.business_journey_nodes.strategy_analysis_node", strategy_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node",
        _finalizer_passthrough_mock(),
    ):
        result = await _exec_business_journey(ctx)

    assess_mock.assert_awaited_once()
    strategy_mock.assert_not_awaited()
    assert result["success"] is True
    assert result["workflow_state"]["business_state_snapshot"]["health_score"] == 80


@pytest.mark.asyncio
async def test_strategy_phase_dispatches_to_strategy_analysis_node():
    ctx, state = _ctx("what are my best strategic options", phase="strategy")
    strategy_mock = AsyncMock(return_value={**state, "strategic_options": [{"label": "Expand"}]})
    assess_mock = AsyncMock()

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.strategy_analysis_node", strategy_mock
    ), patch(
        "ee.modules.ai.nodes.business_journey_nodes.assess_business_node", assess_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node",
        _finalizer_passthrough_mock(),
    ):
        result = await _exec_business_journey(ctx)

    strategy_mock.assert_awaited_once()
    assess_mock.assert_not_awaited()
    assert result["success"] is True


@pytest.mark.asyncio
async def test_plan_phase_dispatches_to_plan_action_node():
    ctx, state = _ctx("build me a 90 day plan", phase="plan")
    plan_mock = AsyncMock(return_value={**state, "action_plan": {"objective": "Grow revenue"}})

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.plan_action_node", plan_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node",
        _finalizer_passthrough_mock(),
    ):
        result = await _exec_business_journey(ctx)

    plan_mock.assert_awaited_once()
    assert result["success"] is True


@pytest.mark.asyncio
async def test_monitor_phase_dispatches_to_monitor_setup_node():
    ctx, state = _ctx("set up alerts for my kpis", phase="monitor")
    monitor_mock = AsyncMock(return_value={**state, "monitoring_config": {"alerts_created": 3}})

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.monitor_setup_node", monitor_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node",
        _finalizer_passthrough_mock(),
    ):
        result = await _exec_business_journey(ctx)

    monitor_mock.assert_awaited_once()
    assert result["success"] is True


@pytest.mark.asyncio
async def test_execute_phase_falls_back_to_assess_business_node():
    """The classic graph has no dedicated execute node either - "execute"
    re-assesses for a progress check (graph_builder.py's _bj_phase_condition:
    "execute": "assess_business")."""
    ctx, state = _ctx("how am i doing on my plan", phase="execute")
    assess_mock = AsyncMock(return_value={**state, "business_state_snapshot": {"health_score": 65}})

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.assess_business_node", assess_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node",
        _finalizer_passthrough_mock(),
    ):
        result = await _exec_business_journey(ctx)

    assess_mock.assert_awaited_once()
    assert result["success"] is True


@pytest.mark.asyncio
async def test_unset_phase_is_detected_from_query_via_router_node():
    """No business_journey_phase pre-set - this capability is reached via a
    kernel multi-step plan, so business_journey_router_node (the thing that
    normally resolves this upstream in the classic graph) has to run inside
    the capability itself, exactly like it does in graph_builder.py."""
    ctx, state = _ctx("what are my best strategic options this quarter")
    strategy_mock = AsyncMock(return_value={**state, "strategic_options": [{"label": "Expand"}]})

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.strategy_analysis_node", strategy_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node",
        _finalizer_passthrough_mock(),
    ):
        result = await _exec_business_journey(ctx)

    strategy_mock.assert_awaited_once()
    assert ctx["workflow_state"]["business_journey_phase"] == "strategy"


@pytest.mark.asyncio
async def test_response_finalizer_node_is_always_invoked():
    ctx, state = _ctx("assess my business", phase="assess")
    assess_mock = AsyncMock(return_value={**state, "business_state_snapshot": {"health_score": 80}})
    finalizer_mock = AsyncMock(side_effect=lambda s: {**s, "current_stage": "business_journey_complete"})

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.assess_business_node", assess_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node", finalizer_mock
    ):
        result = await _exec_business_journey(ctx)

    finalizer_mock.assert_awaited_once()
    assert result["workflow_state"]["current_stage"] == "business_journey_complete"


@pytest.mark.asyncio
async def test_success_is_false_when_phase_node_produces_no_deliverable():
    ctx, state = _ctx("assess my business", phase="assess")
    assess_mock = AsyncMock(return_value={**state, "message": "No data sources connected"})

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes.assess_business_node", assess_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node",
        _finalizer_passthrough_mock(),
    ):
        result = await _exec_business_journey(ctx)

    assert result["success"] is False
