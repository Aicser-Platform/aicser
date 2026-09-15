"""create_chart skill must narrate grounded insights, not stop at the chart."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.skills.skill_graph_handlers import skill_create_chart


@pytest.mark.asyncio
async def test_skill_create_chart_runs_insight_synthesizer_without_llm() -> None:
    ctx = {
        "query": "revenue by month",
        "query_result": [{"month": "Jan", "revenue": 10}],
        "workflow_state": {
            "query": "revenue by month",
            "query_result": [{"month": "Jan", "revenue": 10}],
        },
    }

    async def fake_chart(state):
        state["echarts_config"] = {"type": "bar"}
        return state

    async def fake_insights(state, litellm=None):
        state["insights"] = [{"title": "January revenue", "what": "Revenue is 10", "so_what": "", "now_what": ""}]
        state["executive_summary"] = "January revenue is 10."
        state["message"] = state["executive_summary"]
        return state

    async def fake_finalizer(state):
        return state

    with patch(
        "ee.modules.ai.nodes.chart_builder_node.chart_builder_node", new=fake_chart
    ), patch(
        "ee.modules.ai.nodes.insight_synthesizer_node.insight_synthesizer_node", new=fake_insights
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node", new=fake_finalizer
    ):
        out = await skill_create_chart(ctx)

    assert out["success"] is True
    assert out["insights"]
    assert "10" in (out["executive_summary"] or "")
    assert out["query_result"] == [{"month": "Jan", "revenue": 10}]
