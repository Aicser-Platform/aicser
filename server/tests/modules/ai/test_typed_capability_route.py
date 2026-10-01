"""Typed (Jev-style) capability routing: confident single-tool answers become the plan."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.decisions.service import DecisionOutcome
from ee.modules.ai.kernel import planner

CAPS = [
    {"name": "run_sql", "description": "Query data"},
    {"name": "apply_decision", "description": "Apply a saved AI Decision to each row"},
    {"name": "score_with_model", "description": "Score rows with an approved model"},
    {"name": "search_libraries", "description": "Search knowledge libraries"},
]


def _outcome(capability, single="true", conf=0.97, mode="primary"):
    o = DecisionOutcome(question_set="capability_route", mode=mode, backend="jev")
    o.answers = {"capability": {"value": capability, "confidence": conf}, "single": {"value": single, "confidence": conf}}
    o.thresholds = {"capability": 0.9, "single": 0.9}
    return o


async def _route(outcome, state=None, mode="primary"):
    registry = type("R", (), {"list_capabilities": lambda self, exclude=None: CAPS})()
    with patch("ee.modules.ai.decisions.service.mode_for", return_value=mode), \
         patch("ee.modules.ai.decisions.service.ask_decisions", new=AsyncMock(return_value=outcome)) as ask, \
         patch("ee.modules.ai.kernel.capability_registry.get_capability_registry", return_value=registry), \
         patch("ee.modules.ai.services.capability_governance_service.get_disabled_capabilities", new=AsyncMock(return_value=set())):
        steps = await planner._typed_route(state or {"query": "score customers with the churn model", "organization_id": "o1"})
    return steps, ask


@pytest.mark.asyncio
async def test_confident_single_capability_becomes_the_plan():
    steps, ask = await _route(_outcome("score_with_model"))
    assert [s.capability for s in steps] == ["score_with_model"]
    qset = ask.call_args.kwargs["question_set_override"]
    assert set(qset.get("capability").criteria) == {c["name"] for c in CAPS}


@pytest.mark.asyncio
async def test_decisions_query_rows_first_when_there_are_none():
    steps, _ = await _route(_outcome("apply_decision"), {"query": "flag complaints", "organization_id": "o1"})
    assert [s.capability for s in steps] == ["run_sql", "apply_decision"]
    assert steps[1].depends_on == ["query"]


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", [
    _outcome("score_with_model", conf=0.6),       # not confident: the planner decides
    _outcome("score_with_model", single="false"),  # needs several steps: the planner decomposes
    _outcome("run_sql"),                           # the tuned pipeline stays in charge
    _outcome("not_a_capability"),
])
async def test_other_answers_leave_planning_to_the_existing_paths(outcome):
    steps, _ = await _route(outcome)
    assert steps is None


@pytest.mark.asyncio
async def test_shadow_mode_never_changes_the_plan():
    steps, _ = await _route(_outcome("score_with_model"), mode="shadow")
    assert steps is None
