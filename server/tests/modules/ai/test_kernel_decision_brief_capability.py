"""decision_intelligence_node is synthesis-only (reads analytics_metadata/query_result,
never runs SQL itself) - a kernel capability wrapping it must gather that evidence
first via run_sql + analytics_node first, the same way _exec_analytics_pipeline does
for chart+insights. This mirrors the classic graph's nl2sql -> analytics_node ->
decision_intelligence_node chain (supervisor_node.py's Phase 3b) as one capability,
reachable only from a kernel multi-step/custom plan (a standalone decision-intelligence
request never reaches the kernel — see supervisor_node's Agent Kernel exclusion).

Kernel-unification roadmap step 3: the original capability stopped at
decision_intelligence_node, skipping four real stages the classic graph has —
chart_builder_node/insight_synthesizer_node (parallel render), case_intake_node
(gathers KB evidence into case_file), decision_workflow_node (the safety-critical
piece: evaluates confidence/evidence/stakes against a domain policy and appends a
visible "Human review recommended" note to state["message"] when the bar isn't
met — this is the actual HITL trust mechanism for a product that recommends
actions), and response_finalizer_node (numeric-grounding gate, same bounded-retry
pattern as _exec_analytics_pipeline). All five are now mocked explicitly below
since none were exercised by the original tests.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_decision_brief


def _patches(*, finalizer_verdicts=("approved",)):
    calls = {"finalizer": 0, "insight": 0, "correction": 0, "case_intake": 0, "decision_workflow": 0}

    async def fake_run_sql(ctx):
        state = ctx["workflow_state"]
        return {"success": True, "workflow_state": {**state, "query_result": [{"x": 1}]}}

    async def fake_analytics(s, litellm_service=None):
        return {**s, "analytics_metadata": {"diagnostic": {}}}

    async def fake_chart_builder(s):
        return {**s, "echarts_config": {"type": "bar"}}

    async def fake_insight_synth(s, litellm_service=None):
        calls["insight"] += 1
        return {**s, "insights": [f"insight v{calls['insight']}"]}

    async def fake_case_intake(s):
        calls["case_intake"] += 1
        return {**s, "case_file": {"evidence_items": [{"id": "e1"}]}}

    async def fake_decision(s, litellm):
        return {**s, "decision_brief": {"executive_decision": "Do X"}}

    async def fake_decision_workflow(s):
        calls["decision_workflow"] += 1
        return {**s, "hitl_required": False, "current_stage": "decision_workflow_complete"}

    async def fake_finalizer(s):
        calls["finalizer"] += 1
        return s

    def fake_route(s, logger=None):
        idx = min(calls["finalizer"], len(finalizer_verdicts)) - 1
        return finalizer_verdicts[idx]

    async def fake_error_correction(s, litellm_service=None):
        calls["correction"] += 1
        return {**s, "echarts_config": {"type": "line"}}

    patches = [
        patch("ee.modules.ai.skills.skill_graph_handlers.skill_run_sql", new=fake_run_sql),
        patch("ee.modules.ai.nodes.analytics_node.analytics_node", new=fake_analytics),
        patch("ee.modules.ai.nodes.chart_builder_node.chart_builder_node", new=fake_chart_builder),
        patch("ee.modules.ai.nodes.insight_synthesizer_node.insight_synthesizer_node", new=fake_insight_synth),
        patch("ee.modules.decision_os.nodes.case_intake_node.case_intake_node", new=fake_case_intake),
        patch("ee.modules.ai.nodes.decision_intelligence_node.decision_intelligence_node", new=fake_decision),
        patch("ee.modules.decision_os.nodes.case_intake_node.decision_workflow_node", new=fake_decision_workflow),
        patch("ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node", new=fake_finalizer),
        patch("ee.modules.ai.utils.workflow_decisions.response_finalizer_route", new=fake_route),
        patch("ee.modules.ai.nodes.error_correction_node.error_correction_node", new=fake_error_correction),
    ]
    return patches, calls


@pytest.mark.asyncio
async def test_runs_full_chain_and_synthesizes_decision_brief():
    state = {"query": "why did churn spike and what should we do"}
    ctx = {"workflow_state": state, "litellm_service": object()}

    patches, calls = _patches()
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], patches[8], patches[9]:
        result = await _exec_decision_brief(ctx)

    assert calls["case_intake"] == 1
    assert calls["decision_workflow"] == 1
    assert calls["finalizer"] == 1
    assert result["success"] is True
    assert result["workflow_state"]["decision_brief"]["executive_decision"] == "Do X"
    # case_intake -> decision_intelligence -> decision_workflow order matters:
    # decision_workflow's confidence policy reads case_file.evidence_items.
    assert result["workflow_state"]["case_file"]["evidence_items"] == [{"id": "e1"}]
    assert result["workflow_state"]["current_stage"] == "decision_workflow_complete"


@pytest.mark.asyncio
async def test_analytics_type_set_to_composite_before_analytics_node():
    """analytics_node must see the composite type, not plain descriptive, or it
    dispatches to the wrong engine entirely."""
    state = {"query": "why did churn spike"}
    ctx = {"workflow_state": state, "litellm_service": object()}
    captured = {}

    async def fake_analytics(s, litellm_service=None):
        captured["analytics_type"] = s.get("analytics_type")
        return {**s, "analytics_metadata": {}}

    patches, _ = _patches()
    with patches[0], patch("ee.modules.ai.nodes.analytics_node.analytics_node", new=fake_analytics), patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], patches[8], patches[9]:
        await _exec_decision_brief(ctx)

    assert captured["analytics_type"] == "diagnostic_prescriptive_predictive"


@pytest.mark.asyncio
async def test_needs_regeneration_verdict_retries_insight_synthesis():
    state = {"query": "why did churn spike"}
    ctx = {"workflow_state": state, "litellm_service": object()}

    patches, calls = _patches(finalizer_verdicts=("needs_regeneration", "approved"))
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], patches[8], patches[9]:
        result = await _exec_decision_brief(ctx)

    assert calls["finalizer"] == 2
    assert calls["insight"] == 2
    assert result["success"] is True


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
