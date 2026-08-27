"""verify_goal_semantic previously only ran its LLM "does this actually answer the
question" check for chart_analysis — dashboard/executive_report/kb_answer/multi_step
had no semantic check at all, only the structural verify_goal (widget count, etc.),
which can't catch a structurally-fine-but-off-topic answer. This now covers every
deliverable type except export (a file, not a text answer). custom IS now covered
too — judged against the goal's own success_criteria rather than skipped, since a
dynamically-composed plan should still be held to some bar (see planner.py's custom
branch and kernel/verifier.py's is_custom handling).
"""

from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.kernel.schemas import AgentGoal, DeliverableType
from ee.modules.ai.kernel.verifier import verify_goal_semantic


def _fake_litellm(passed: bool = True, reason: str = ""):
    service = AsyncMock()
    service.generate_completion = AsyncMock(
        return_value={"content": f'{{"passed": {str(passed).lower()}, "reason": "{reason}"}}'}
    )
    return service


@pytest.mark.parametrize(
    "deliverable_type",
    [
        DeliverableType.chart_analysis,
        DeliverableType.dashboard,
        DeliverableType.executive_report,
        DeliverableType.kb_answer,
        DeliverableType.multi_step,
        DeliverableType.custom,
    ],
)
@pytest.mark.asyncio
async def test_semantic_verification_now_covers_this_deliverable_type(deliverable_type):
    goal = AgentGoal(objective="revenue by region", deliverable_type=deliverable_type)
    state = {"query": "show revenue by region", "message": "Here is revenue by region: ..."}

    result = await verify_goal_semantic(goal, state, _fake_litellm(passed=False, reason="off topic"))

    assert result is not None
    assert result.passed is False
    assert result.heal_action == "replanner"


@pytest.mark.asyncio
async def test_semantic_verification_still_skips_export():
    goal = AgentGoal(objective="export as pdf", deliverable_type=DeliverableType.export)
    state = {"query": "export this as pdf", "message": "Here is your export."}

    result = await verify_goal_semantic(goal, state, _fake_litellm(passed=False))

    assert result is None
