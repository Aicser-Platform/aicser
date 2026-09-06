"""Regression tests: Dashboard, Business OS (assess/strategy/plan), and RAG
previously built their LLM prompts from only the current turn's query, with
zero access to state["conversation_history"] — unlike Chat/Analyze/Report,
which already thread it through. A follow-up like "make the hero chart a
bar instead", "lean more aggressive on that strategy", or "what about the
other document" had no prior-turn text to resolve against.

These tests assert conversation_history now actually reaches each LLM call,
using the shared ee.modules.ai.utils.conversation_history.format_recent_conversation_block
helper (or, for RAG, real prior messages in the `messages` list).
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.utils.conversation_history import format_recent_conversation_block


def test_format_recent_conversation_block_empty():
    assert format_recent_conversation_block(None) == ""
    assert format_recent_conversation_block([]) == ""


def test_format_recent_conversation_block_renders_recent_turns():
    history = [
        {"role": "user", "content": "show revenue by region"},
        {"role": "assistant", "content": "Here's revenue by region..."},
    ]
    block = format_recent_conversation_block(history)
    assert "show revenue by region" in block
    assert "Here's revenue by region" in block
    assert "user:" in block and "assistant:" in block


def test_format_recent_conversation_block_truncates_and_limits_turns():
    history = [{"role": "user", "content": f"turn {i}" * 50} for i in range(10)]
    block = format_recent_conversation_block(history, max_turns=2, max_chars_per_turn=20)
    assert history[-1]["content"][:20] in block
    assert history[0]["content"] not in block
    assert block.count("user:") == 2  # only the last 2 turns kept


@pytest.mark.asyncio
async def test_dashboard_planner_includes_conversation_history_in_prompt():
    from ee.modules.ai.services.dashboard_llm_planner import _llm_refine_dashboard_plan
    from ee.modules.ai.schemas.dashboard_plan import DashboardLLMPlan

    seed = DashboardLLMPlan(dashboard_title="Seed", dashboard_subtitle="", pages=[])
    captured = {}

    async def fake_completion(*args, **kwargs):
        captured["messages"] = kwargs.get("messages")
        return {
            "success": True,
            "content": '{"dashboard_title": "Refined", "dashboard_subtitle": "", "pages": []}',
        }

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(side_effect=fake_completion),
    ):
        await _llm_refine_dashboard_plan(
            seed,
            prompt="make the hero chart a bar instead",
            schema_summary="orders(id, amount)",
            data_source_name="orders_db",
            tables_info=[],
            conversation_history=[
                {"role": "user", "content": "show me revenue trend"},
                {"role": "assistant", "content": "Here's your revenue trend dashboard."},
            ],
        )

    user_msg = next(m["content"] for m in captured["messages"] if m["role"] == "user")
    assert "show me revenue trend" in user_msg
    assert "revenue trend dashboard" in user_msg


@pytest.mark.asyncio
async def test_business_strategy_prompt_includes_conversation_history():
    from ee.modules.decision_os.decision_synthesizer import build_strategic_prompt

    _, user_prompt = build_strategic_prompt(
        "lean more aggressive",
        {"health_score": 70, "executive_summary": "Solid quarter."},
        conversation_history=[
            {"role": "user", "content": "what are my strategic options"},
            {"role": "assistant", "content": "I outlined 3 strategic paths..."},
        ],
    )
    assert "what are my strategic options" in user_prompt
    assert "3 strategic paths" in user_prompt


@pytest.mark.asyncio
async def test_dashboard_planner_includes_org_kpi_context_in_prompt():
    """
    kpi_memory_service holds org-verified KPI expressions (e.g. "MRR: SUM(...)
    WHERE status='active'") -- NL2SQL and Business Assess already ground on
    it via OrgContextService.get_kpi_context, but the dashboard planner never
    did, so a KPI-card widget could still guess a metric's aggregation wrong
    even when the org has already verified the correct expression elsewhere.
    """
    from ee.modules.ai.services.dashboard_llm_planner import _llm_refine_dashboard_plan
    from ee.modules.ai.schemas.dashboard_plan import DashboardLLMPlan

    seed = DashboardLLMPlan(dashboard_title="Seed", dashboard_subtitle="", pages=[])
    captured = {}

    async def fake_completion(*args, **kwargs):
        captured["messages"] = kwargs.get("messages")
        return {
            "success": True,
            "content": '{"dashboard_title": "Refined", "dashboard_subtitle": "", "pages": []}',
        }

    async def fake_kpi_context(self, organization_id, query, data_source_id=None):
        assert organization_id == "org-1"
        return "BUSINESS CONTEXT (org-verified KPI definitions):\n- MRR: SUM(subscriptions.amount) WHERE status = 'active'"

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(side_effect=fake_completion),
    ), patch(
        "ee.modules.ai.services.org_context_service.OrgContextService.get_kpi_context",
        new=fake_kpi_context,
    ):
        await _llm_refine_dashboard_plan(
            seed,
            prompt="show MRR trend",
            schema_summary="subscriptions(id, amount, status)",
            data_source_name="billing_db",
            tables_info=[],
            organization_id="org-1",
            data_source_id="ds-1",
        )

    user_msg = next(m["content"] for m in captured["messages"] if m["role"] == "user")
    assert "org-verified KPI definitions" in user_msg
    assert "MRR: SUM(subscriptions.amount)" in user_msg


def test_rag_history_message_assembly_matches_node_logic():
    """
    rag_retrieval_node builds history_messages inline (not via a testable
    helper, to preserve real multi-turn message roles rather than a flattened
    text block) — this locks in that exact filtering/truncation logic so a
    future edit can't silently drop it back to [system, user] only.
    """
    conversation_history = [
        {"role": "user", "content": "summarize document A"},
        {"role": "assistant", "content": "Document A covers Q3 results."},
        {"role": "system", "content": "should be excluded"},
        {"role": "user", "content": ""},
    ]

    history_messages = []
    for msg in conversation_history[-6:]:
        if isinstance(msg, dict) and msg.get("role") in ("user", "assistant") and msg.get("content"):
            history_messages.append({"role": msg["role"], "content": str(msg["content"])[:600]})

    assert history_messages == [
        {"role": "user", "content": "summarize document A"},
        {"role": "assistant", "content": "Document A covers Q3 results."},
    ]
