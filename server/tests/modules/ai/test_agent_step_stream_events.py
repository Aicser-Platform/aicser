"""The agent kernel's checklist UI (AgentPlanPanel) only re-syncs its step
list off events carrying agent_plan/execution_plan (see
syncAgentPlanFromPartial.ts's agentFieldsFromPartial on the client) - those
fields were only ever attached to the plan-creation and replan events, never
to the per-step emit_step_started/emit_step_complete/emit_step_failed events
fired as each step actually runs. Result: the checklist painted once when the
plan was created and then looked frozen for the rest of a multi-step run,
even though the backend was genuinely progressing through steps one at a
time - it just never told the UI. This pins the fix: every step event must
carry the full, current plan so the frontend's existing sync path (which
already worked correctly for plan-creation/replan) picks it up for free."""

import asyncio

import pytest

from ee.modules.ai.kernel.schemas import AgentGoal, AgentPlan, AgentPlanStep, DeliverableType
from ee.modules.ai.kernel.stream_events import (
    emit_step_complete,
    emit_step_failed,
    emit_step_started,
)
# stream_events.py's _emit() reads the queue via `from src.modules.ai.utils.
# stream_queue_context import get_stream_queue` - src.modules.ai is a
# separately-loaded module object from ee.modules.ai (src/modules/ai/__init__.py
# redirects __path__ to the ee tree when EE is enabled, but that's a *second*
# load, not an alias), so it holds its own independent ContextVar instance.
# Setting the ee-path one here would leave production's src-path get_stream_queue()
# reading None, silently no-opping _emit() and hanging any test that awaits the
# queue - must import through the same src alias production code actually uses.
from src.modules.ai.utils.stream_queue_context import set_stream_queue


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
        assert len(payload["execution_plan"]) == 2
        assert payload["execution_plan"][0]["status"] == "active"
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
        assert payload["execution_plan"][0]["status"] == "complete"
        assert payload["execution_plan"][1]["status"] == "pending"
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
        assert payload["execution_plan"][0]["status"] == "failed"
        assert payload["error"] == "boom"
    finally:
        set_stream_queue(None)
