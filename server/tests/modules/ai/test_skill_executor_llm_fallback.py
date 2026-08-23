"""Tests for skill_executor_node's LLM-driven fallback.

planner_node only matches export/report keywords or an explicit [Agent Skill: name]
tag - it has zero regex coverage for run_sql/create_chart/create_dashboard/etc, so
any request that doesn't hit those patterns used to fall straight through to a
"No agent skill workflow was planned" message. Now that gap goes through real
LLM function-calling over the same skill catalog before giving up.
"""

from unittest.mock import patch

import pytest

from ee.modules.ai.nodes.skill_executor_node import skill_executor_node
from ee.modules.ai.skills.registry import _REGISTRY


async def _fake_run_sql(ctx):
    return {"success": True, "message": "Ran SQL and found 42 rows."}


@pytest.mark.asyncio
async def test_llm_fallback_selects_and_executes_a_skill():
    async def fake_generate_completion_with_tools(self, prompt, system_context, tools, **kwargs):
        assert any(t["function"]["name"] == "run_sql" for t in tools)
        return {"success": True, "tool_calls": [{"name": "run_sql", "arguments": {}}], "content": ""}

    original_handler = _REGISTRY["run_sql"].handler
    _REGISTRY["run_sql"].handler = _fake_run_sql
    try:
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
            new=fake_generate_completion_with_tools,
        ):
            state = {"query": "can you dig into this for me", "user_id": "u1", "organization_id": None}
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["run_sql"].handler = original_handler

    assert out["current_stage"] == "skill_complete"
    assert out["skill_results"] == [{"skill": "run_sql", "success": True, "message": "Ran SQL and found 42 rows."}]
    assert out["agent_plan"]["trigger"] == "llm_selection"


@pytest.mark.asyncio
async def test_llm_fallback_empty_selection_falls_through_gracefully():
    async def fake_no_match(self, prompt, system_context, tools, **kwargs):
        return {"success": True, "tool_calls": [], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_no_match,
    ):
        state = {"query": "hello there, how are you", "user_id": "u1", "organization_id": None}
        out = await skill_executor_node(state)

    assert out["current_stage"] == "skill_no_plan"
    assert out["message"] == "No agent skill workflow was planned for this request."


@pytest.mark.asyncio
async def test_llm_fallback_on_error_falls_through_gracefully():
    async def fake_error(self, prompt, system_context, tools, **kwargs):
        raise RuntimeError("provider unavailable")

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_error,
    ):
        state = {"query": "hello there, how are you", "user_id": "u1", "organization_id": None}
        out = await skill_executor_node(state)

    assert out["current_stage"] == "skill_no_plan"


@pytest.mark.asyncio
async def test_skill_result_sql_and_chart_promote_to_top_level_state():
    """Regression: run_sql/create_chart results carry sql_query/echarts_config, but
    the node used to only stash them in step['result'] — state['sql_query'] stayed
    None, so 'Inspect SQL' had nothing canonical to show for a skill-driven turn and
    fell back to scraping the chat prose instead."""

    async def fake_create_chart(ctx):
        return {
            "success": True,
            "skill": "create_chart",
            "sql_query": "SELECT region, SUM(revenue) FROM sales GROUP BY region",
            "echarts_config": {"series": [{"type": "bar"}]},
            "chart_type": "bar",
        }

    original_handler = _REGISTRY["create_chart"].handler
    _REGISTRY["create_chart"].handler = fake_create_chart
    try:
        state = {
            "query": "[Agent Skill: create_chart] revenue by region",
            "user_id": "u1",
            "organization_id": None,
        }
        out = await skill_executor_node(state)
    finally:
        _REGISTRY["create_chart"].handler = original_handler

    assert out["sql_query"] == "SELECT region, SUM(revenue) FROM sales GROUP BY region"
    assert out["echarts_config"] == {"series": [{"type": "bar"}]}
    assert out["chart_type"] == "bar"


@pytest.mark.asyncio
async def test_regex_fast_path_never_calls_the_llm():
    """Export-intent queries planner_node already handles must not pay for an LLM call."""
    called = {"llm": False}

    async def fake_should_not_be_called(self, prompt, system_context, tools, **kwargs):
        called["llm"] = True
        return {"success": True, "tool_calls": [], "content": ""}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
        new=fake_should_not_be_called,
    ):
        state = {"query": "export this as a pdf report", "user_id": "u1", "organization_id": None}
        out = await skill_executor_node(state)

    assert out["current_stage"] == "skill_complete"
    assert out["agent_plan"].get("trigger") != "llm_selection"
    assert called["llm"] is False
