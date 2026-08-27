"""_exec_create_dashboard used to always run the full create-from-scratch PESD
chain (skill_create_dashboard) regardless of dashboard_lifecycle_action. Since
should_use_agent_kernel() is unconditional, every dashboard request goes
through this capability - so a follow-up like "make that chart a bar chart"
on an existing dashboard silently became "build a brand new dashboard",
and the versioned refine/undo tooling in dashboard_lifecycle_node.py was
unreachable. This mirrors the classic graph's dashboard_lifecycle_router ->
{refiner,updater,analyzer,regenerator} conditional edges (graph_builder.py's
_dashboard_lifecycle_condition) inside the kernel capability instead."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_create_dashboard


def _ctx(action: str | None):
    state = {"query": "make that chart a bar chart", "target_dashboard_id": "dash-1"}
    if action is not None:
        state["dashboard_lifecycle_action"] = action
    return {"workflow_state": state}, state


@pytest.mark.asyncio
async def test_refine_action_dispatches_to_dashboard_refiner_not_create():
    ctx, state = _ctx("refine")
    refiner_mock = AsyncMock(return_value={**state, "dashboard_created": {"dashboard_id": "dash-1"}})
    create_mock = AsyncMock()

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_refiner_node", refiner_mock
    ), patch("ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock):
        result = await _exec_create_dashboard(ctx)

    refiner_mock.assert_awaited_once()
    create_mock.assert_not_awaited()
    assert result["success"] is True


@pytest.mark.asyncio
async def test_undo_action_also_dispatches_to_dashboard_refiner():
    """dashboard_refiner_node internally delegates to dashboard_undo_node for
    action == "undo" - same contract as the classic graph's edge mapping
    ("refine": "dashboard_refiner" comment says "also handles undo")."""
    ctx, state = _ctx("undo")
    refiner_mock = AsyncMock(return_value=state)
    create_mock = AsyncMock()

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_refiner_node", refiner_mock
    ), patch("ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock):
        await _exec_create_dashboard(ctx)

    refiner_mock.assert_awaited_once()
    create_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_action_dispatches_to_dashboard_updater():
    ctx, state = _ctx("update")
    updater_mock = AsyncMock(return_value=state)
    create_mock = AsyncMock()

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_updater_node", updater_mock
    ), patch("ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock):
        await _exec_create_dashboard(ctx)

    updater_mock.assert_awaited_once()
    create_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_analyze_action_dispatches_to_dashboard_analyzer():
    ctx, state = _ctx("analyze")
    analyzer_mock = AsyncMock(return_value=state)
    create_mock = AsyncMock()

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_analyzer_node", analyzer_mock
    ), patch("ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock):
        await _exec_create_dashboard(ctx)

    analyzer_mock.assert_awaited_once()
    create_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_regenerate_action_runs_regenerator_then_falls_through_to_create():
    """Classic graph: dashboard_regenerator -> dashboard_intent (falls through
    to the create PESD chain), not a terminal step of its own."""
    ctx, state = _ctx("regenerate")
    regenerator_mock = AsyncMock(return_value=state)
    create_mock = AsyncMock(return_value={"success": True, "dashboard_created": {"dashboard_id": "dash-1"}})

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_regenerator_node", regenerator_mock
    ), patch("ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock):
        result = await _exec_create_dashboard(ctx)

    regenerator_mock.assert_awaited_once()
    create_mock.assert_awaited_once()
    assert result["dashboard_created"]["dashboard_id"] == "dash-1"


@pytest.mark.asyncio
async def test_create_action_or_unset_still_uses_the_full_pesd_chain():
    for action in ("create", None):
        ctx, state = _ctx(action)
        create_mock = AsyncMock(return_value={"success": True, "dashboard_created": {"dashboard_id": "dash-2"}})
        refiner_mock = AsyncMock()

        with patch(
            "ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock
        ), patch("ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_refiner_node", refiner_mock):
            result = await _exec_create_dashboard(ctx)

        create_mock.assert_awaited_once()
        refiner_mock.assert_not_awaited()
        assert result["dashboard_created"]["dashboard_id"] == "dash-2"
