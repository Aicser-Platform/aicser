"""_exec_create_dashboard used to always run the full create-from-scratch PESD
chain (skill_create_dashboard) regardless of dashboard_lifecycle_action. Since
should_use_agent_kernel() is unconditional, every dashboard request goes
through this capability - so a follow-up like "make that chart a bar chart"
on an existing dashboard silently became "build a brand new dashboard",
and the versioned refine/undo tooling in dashboard_lifecycle_node.py was
unreachable. This mirrors the classic graph's dashboard_lifecycle_router ->
{refiner,updater,analyzer,regenerator} conditional edges (graph_builder.py's
_dashboard_lifecycle_condition) inside the kernel capability instead.

Kernel-unification roadmap step 4 added two more real dependencies to the
create/regenerate fallthrough: detect_dashboard_lifecycle_action (when
dashboard_lifecycle_action isn't already set — this capability is reached
via a kernel multi-step plan, so dashboard_lifecycle_router_node, the only
thing that normally calls this detector, never runs upstream) and
artifact_quality_gate_node (the widget-count self-heal gate a classic
create/regenerate already gets via dashboard_materializer's graph edge).
Both are mocked explicitly below wherever the create-fallthrough path is
exercised, alongside skill_create_dashboard."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_create_dashboard


def _ctx(action: str | None):
    state = {"query": "make that chart a bar chart", "target_dashboard_id": "dash-1"}
    if action is not None:
        state["dashboard_lifecycle_action"] = action
    return {"workflow_state": state}, state


def _quality_gate_passthrough_mock():
    """artifact_quality_gate_node returns the state unchanged (no self-heal
    needed) — a realistic default for these dispatch-focused tests, which
    aren't testing self-heal behavior itself."""
    return AsyncMock(side_effect=lambda s: s)


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
    gate_mock = _quality_gate_passthrough_mock()

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_regenerator_node", regenerator_mock
    ), patch("ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock), patch(
        "ee.modules.ai.nodes.artifact_quality_gate_node.artifact_quality_gate_node", gate_mock
    ):
        result = await _exec_create_dashboard(ctx)

    regenerator_mock.assert_awaited_once()
    create_mock.assert_awaited_once()
    gate_mock.assert_awaited_once()
    assert result["dashboard_created"]["dashboard_id"] == "dash-1"


@pytest.mark.asyncio
async def test_create_action_or_unset_still_uses_the_full_pesd_chain():
    for action in ("create", None):
        ctx, state = _ctx(action)
        create_mock = AsyncMock(return_value={"success": True, "dashboard_created": {"dashboard_id": "dash-2"}})
        refiner_mock = AsyncMock()
        gate_mock = _quality_gate_passthrough_mock()

        with patch(
            "ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock
        ), patch(
            "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_refiner_node", refiner_mock
        ), patch(
            "ee.modules.ai.nodes.artifact_quality_gate_node.artifact_quality_gate_node", gate_mock
        ), patch(
            "ee.modules.ai.nodes.dashboard_lifecycle_node.detect_dashboard_lifecycle_action",
            new=lambda query, state: "",
        ):
            result = await _exec_create_dashboard(ctx)

        create_mock.assert_awaited_once()
        refiner_mock.assert_not_awaited()
        assert result["dashboard_created"]["dashboard_id"] == "dash-2"
        assert ctx["workflow_state"]["dashboard_lifecycle_action"] == "create"


@pytest.mark.asyncio
async def test_unset_action_with_sticky_dashboard_uses_detected_refine_action():
    """The exact original bug this whole file exists for, reopened for the
    kernel multi-step-plan path specifically: an unset dashboard_lifecycle_action
    with a clear board-edit query and a sticky dashboard must detect "refine",
    not silently default to "create"."""
    ctx, state = _ctx(None)
    refiner_mock = AsyncMock(return_value={**state, "dashboard_created": {"dashboard_id": "dash-1"}})
    create_mock = AsyncMock()

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.dashboard_refiner_node", refiner_mock
    ), patch(
        "ee.modules.ai.skills.skill_graph_handlers.skill_create_dashboard", create_mock
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node.detect_dashboard_lifecycle_action",
        new=lambda query, state: "refine",
    ):
        result = await _exec_create_dashboard(ctx)

    refiner_mock.assert_awaited_once()
    create_mock.assert_not_awaited()
    assert ctx["workflow_state"]["dashboard_lifecycle_action"] == "refine"
    assert result["success"] is True
