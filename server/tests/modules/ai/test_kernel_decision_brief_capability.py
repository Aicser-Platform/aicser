"""decision_intelligence_node is synthesis-only (reads analytics_metadata/query_result,
never runs SQL itself) - a kernel capability wrapping it must gather that evidence
first via run_sql + analytics_node first, the same way _exec_analytics_pipeline does
for chart+insights. This mirrors the classic graph's nl2sql -> analytics_node ->
decision_intelligence_node chain (supervisor_node.py's Phase 3b) as one capability,
reachable only from a kernel multi-step/custom plan (a standalone decision-intelligence
request never reaches the kernel — see supervisor_node's Agent Kernel exclusion)."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_decision_brief


@pytest.mark.asyncio
async def test_runs_sql_then_analytics_then_synthesizes_decision_brief():
    state = {"query": "why did churn spike and what should we do"}
    ctx = {"workflow_state": state, "litellm_service": object()}

    run_sql_mock = AsyncMock(
        return_value={"success": True, "workflow_state": {**state, "query_result": [{"x": 1}]}}
    )
    analytics_mock = AsyncMock(
        side_effect=lambda s, litellm_service=None: {**s, "analytics_metadata": {"diagnostic": {}}}
    )
    decision_mock = AsyncMock(
        side_effect=lambda s, litellm: {**s, "decision_brief": {"executive_decision": "Do X"}}
    )

    with patch(
        "ee.modules.ai.skills.skill_graph_handlers.skill_run_sql", run_sql_mock
    ), patch(
        "ee.modules.ai.nodes.analytics_node.analytics_node", analytics_mock
    ), patch(
        "ee.modules.ai.nodes.decision_intelligence_node.decision_intelligence_node", decision_mock
    ):
        result = await _exec_decision_brief(ctx)

    run_sql_mock.assert_awaited_once()
    analytics_mock.assert_awaited_once()
    decision_mock.assert_awaited_once()
    # analytics_node must see the composite type, not plain descriptive, or it
    # dispatches to the wrong engine entirely.
    assert analytics_mock.await_args.args[0]["analytics_type"] == "diagnostic_prescriptive_predictive"
    assert result["success"] is True
    assert result["workflow_state"]["decision_brief"]["executive_decision"] == "Do X"


@pytest.mark.asyncio
async def test_sql_failure_short_circuits_before_synthesis():
    state = {"query": "why did churn spike"}
    ctx = {"workflow_state": state, "litellm_service": object()}

    run_sql_mock = AsyncMock(return_value={"success": False, "error": "no data source"})
    decision_mock = AsyncMock()

    with patch(
        "ee.modules.ai.skills.skill_graph_handlers.skill_run_sql", run_sql_mock
    ), patch(
        "ee.modules.ai.nodes.decision_intelligence_node.decision_intelligence_node", decision_mock
    ):
        result = await _exec_decision_brief(ctx)

    assert result["success"] is False
    decision_mock.assert_not_awaited()
