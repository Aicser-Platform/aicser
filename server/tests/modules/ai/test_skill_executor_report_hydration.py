"""skill_executor_node's conversation-history hydration for report_sections.

A user who says "generate an executive report" then, in a FOLLOW-UP turn,
"export this as a PDF" starts that second turn with a fresh graph state --
state["report_sections"] is empty because the report was built in the prior
turn. The only place that data still exists is the prior turn's persisted
ai_metadata. Before this fix, the hydration lookback only ever restored
query_result/insights from that metadata, never report_sections, so a
follow-up export silently lost the entire report and fell back to whatever
thin flat context happened to be in state.
"""
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.skill_executor_node import skill_executor_node


def _make_state(conversation_id="conv-1"):
    return {
        "query": "export this as a pdf",
        "user_id": "user-1",
        "organization_id": None,
        "conversation_id": conversation_id,
        "agent_plan": {
            "steps": [{"id": "generate_pdf", "type": "skill", "skill": "generate_pdf", "status": "pending"}],
            "planner_version": "1.0",
            "trigger": "explicit_activation",
        },
    }


class _FakeMessage:
    def __init__(self, ai_metadata):
        self.ai_metadata = ai_metadata


@pytest.mark.asyncio
async def test_report_sections_hydrated_from_prior_turn_metadata():
    prior_report_sections = [
        {"id": "s1", "type": "kpi", "title": "Revenue", "status": "complete",
         "narrative": "Revenue is up.", "key_metric": "Revenue", "key_metric_value": "$1M"},
    ]
    fake_detail = type("Detail", (), {"messages": [
        _FakeMessage({"report_sections": prior_report_sections, "report_plan": {"title": "Q3 Report"}}),
    ]})()

    captured_ctx = {}

    async def _fake_run_skill(name, ctx):
        captured_ctx.update(ctx)
        return {"success": True, "skill": name}

    with patch(
        "ee.modules.chats.conversations.service.ConversationService.get_conversation",
        new=AsyncMock(return_value=fake_detail),
    ), patch("ee.modules.ai.skills.registry.run_skill", new=_fake_run_skill):
        await skill_executor_node(_make_state())

    assert captured_ctx.get("report_sections") == prior_report_sections
    assert captured_ctx.get("chart_title") == "Q3 Report"


@pytest.mark.asyncio
async def test_state_report_sections_take_priority_over_history_lookup():
    """When the current turn's state already has report_sections (e.g. the
    Executive Report was just generated this same turn), the hydration
    lookback must not run at all -- it would waste a DB round-trip and could
    only ever overwrite good data with stale data from a prior turn."""
    current_sections = [{"id": "cur", "type": "kpi", "title": "Current", "status": "complete"}]
    state = _make_state()
    state["report_sections"] = current_sections
    state["query_result"] = [{"a": 1}]

    async def _fake_run_skill(name, ctx):
        return {"success": True, "skill": name}

    with patch(
        "ee.modules.chats.conversations.service.ConversationService.get_conversation",
        new=AsyncMock(side_effect=AssertionError("should not hit the DB when state already has the data")),
    ), patch("ee.modules.ai.skills.registry.run_skill", new=_fake_run_skill):
        await skill_executor_node(state)
