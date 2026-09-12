"""The agent kernel's checklist UI (AgentPlanPanel) only re-syncs its step
list off events carrying agent_plan (see syncAgentPlanFromPartial.ts).
execution_plan is the classic supervisor's plan — emitting both painted two
checklists. Kernel step events must carry agent_plan only."""

import asyncio

import pytest

from ee.modules.ai.kernel.schemas import AgentGoal, AgentPlan, AgentPlanStep, DeliverableType
from ee.modules.ai.kernel.stream_events import (
    emit_step_complete,
    emit_step_failed,
    emit_step_started,
)
# stream_events.py's _emit() reads the queue via `from ee.modules.ai.utils.
# stream_queue_context import get_stream_queue` - src.modules.ai is a
# separately-loaded module object from ee.modules.ai (src/modules/ai/__init__.py
# redirects __path__ to the ee tree when EE is enabled, but that's a *second*
# load, not an alias), so it holds its own independent ContextVar instance.
# Setting the src-path one here would leave production's ee-path get_stream_queue()
# reading None, silently no-opping _emit() and hanging any test that awaits the
# queue - must import through the same ee path production code actually uses.
from ee.modules.ai.utils.stream_queue_context import set_stream_queue


def _make_plan() -> AgentPlan:
    return AgentPlan(
        goal=AgentGoal(objective="Chart revenue", deliverable_type=DeliverableType.chart_analysis),
        steps=[
            AgentPlanStep(id="query", capability="run_sql", label="Query data", status="active"),
            AgentPlanStep(id="chart", capability="create_chart", label="Build chart", status="pending"),
        ],
        strategy="Query then chart",
    )


@pytest.mark.asyncio
async def test_step_started_carries_full_plan():
    queue: asyncio.Queue = asyncio.Queue()
    set_stream_queue(queue)
    try:
        plan = _make_plan()
        await emit_step_started(plan, plan.steps[0], 1, 2)
        _event_type, payload = await queue.get()
        assert payload["agent_plan"]["steps"][0]["id"] == "query"
        assert payload["agent_plan"]["steps"][0]["status"] == "active"
        assert "execution_plan" not in payload
    finally:
        set_stream_queue(None)


@pytest.mark.asyncio
async def test_step_complete_carries_full_plan_with_updated_status():
    queue: asyncio.Queue = asyncio.Queue()
    set_stream_queue(queue)
    try:
        plan = _make_plan()
        plan.steps[0].status = "complete"
        await emit_step_complete(plan, plan.steps[0], 1, 2)
        _event_type, payload = await queue.get()
        assert payload["agent_plan"]["steps"][0]["status"] == "complete"
        assert payload["agent_plan"]["steps"][1]["status"] == "pending"
        assert "execution_plan" not in payload
    finally:
        set_stream_queue(None)


@pytest.mark.asyncio
async def test_step_failed_carries_full_plan():
    queue: asyncio.Queue = asyncio.Queue()
    set_stream_queue(queue)
    try:
        plan = _make_plan()
        plan.steps[0].status = "failed"
        plan.steps[0].error = "boom"
        await emit_step_failed(plan, plan.steps[0], 1, 2)
        _event_type, payload = await queue.get()
        assert payload["agent_plan"]["steps"][0]["status"] == "failed"
        assert payload["error"] == "boom"
        assert "execution_plan" not in payload
    finally:
        set_stream_queue(None)
