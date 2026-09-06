"""Kernel-unification roadmap step 2: _exec_analytics_pipeline and
_exec_visualize (capability_registry.py) — the shared capability behind
diagnostic/predictive/prescriptive/animate — stopped at chart_builder_node/
insight_synthesizer_node, never reaching the classic graph's
analytics_render -> response_finalizer edge.

response_finalizer_node's numeric-grounding check (every figure the
narrative cites must trace back to real query/analytics data — see
_check_completeness and _extract_numbers_from_data in
response_finalizer_node.py) is the mechanism that actually catches an
ungrounded/hallucinated insight or a broken chart. Without it, a kernel-
routed Diagnostic/Predictive/Prescriptive/Animate request got real engine
output (forecast/diagnostic/prescriptive fields all correctly populated by
analytics_node) with zero quality gating on the narrative built from it —
the same class of silent-degradation gap already closed for executive_report
(kernel-unification roadmap step 1).

Fixed by calling response_finalizer_node after chart/insights in both
functions, then response_finalizer_route(state) to read its verdict:
approved/degraded_pass -> done; needs_regeneration -> one bounded retry via
insight_synthesizer_node; chart_error -> one bounded retry via
error_correction_node (which reads the correction_context
response_finalizer_route already populated for the chart case). One retry,
not the graph's full cycle capacity — same bounded-retry scope already used
for skill_run_sql's error_correction retry this session.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_analytics_pipeline, _exec_visualize


def _base_ctx(**state_overrides):
    state = {
        "query": "why did revenue drop last quarter",
        "data_source_id": "ds-1",
        "analytics_type": "diagnostic",
    }
    state.update(state_overrides)
    return {
        "workflow_state": state,
        "litellm_service": object(),
        "multi_query_service": object(),
        "data_service": object(),
    }


def _patches(*, finalizer_verdicts, sql_success=True):
    """finalizer_verdicts: list of verdicts response_finalizer_route should
    return on successive calls (1 item = no retry needed, 2 items = one
    retry loop expected)."""
    calls = {"finalizer": 0, "insight": 0, "correction": 0}

    async def fake_skill_run_sql(ctx):
        state = ctx["workflow_state"]
        state["sql_query"] = "SELECT 1"
        state["query_result"] = [{"a": 1}]
        return {"success": sql_success, "workflow_state": state, "skill": "run_sql"}

    async def fake_analytics_node(state, litellm_service=None):
        return {**state, "analytics_metadata": {"type": "diagnostic"}}

    async def fake_chart_builder(state):
        return {**state, "echarts_config": {"type": "bar"}}

    async def fake_insight_synth(state, litellm_service=None):
        calls["insight"] += 1
        return {**state, "insights": [f"insight v{calls['insight']}"]}

    async def fake_finalizer(state):
        calls["finalizer"] += 1
        return state

    def fake_route(state, logger=None):
        idx = min(calls["finalizer"], len(finalizer_verdicts)) - 1
        return finalizer_verdicts[idx]

    async def fake_error_correction(state, litellm_service=None):
        calls["correction"] += 1
        return {**state, "echarts_config": {"type": "line"}}

    patches = [
        patch("ee.modules.ai.skills.skill_graph_handlers.skill_run_sql", new=fake_skill_run_sql),
        patch("ee.modules.ai.nodes.analytics_node.analytics_node", new=fake_analytics_node),
        patch("ee.modules.ai.nodes.chart_builder_node.chart_builder_node", new=fake_chart_builder),
        patch("ee.modules.ai.nodes.insight_synthesizer_node.insight_synthesizer_node", new=fake_insight_synth),
        patch("ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node", new=fake_finalizer),
        patch("ee.modules.ai.utils.workflow_decisions.response_finalizer_route", new=fake_route),
        patch("ee.modules.ai.nodes.error_correction_node.error_correction_node", new=fake_error_correction),
    ]
    return patches, calls


@pytest.mark.asyncio
async def test_analytics_pipeline_calls_finalizer_and_succeeds_on_approved():
    ctx = _base_ctx()
    patches, calls = _patches(finalizer_verdicts=["approved"])
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await _exec_analytics_pipeline(ctx)

    assert calls["finalizer"] == 1
    assert calls["insight"] == 1  # only the original call, no retry
    assert result["success"] is True


@pytest.mark.asyncio
async def test_analytics_pipeline_retries_insight_synthesis_on_needs_regeneration():
    ctx = _base_ctx()
    patches, calls = _patches(finalizer_verdicts=["needs_regeneration", "approved"])
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await _exec_analytics_pipeline(ctx)

    assert calls["finalizer"] == 2
    assert calls["insight"] == 2  # original + one bounded retry
    assert result["success"] is True
    assert result["workflow_state"]["insights"] == ["insight v2"]


@pytest.mark.asyncio
async def test_analytics_pipeline_retries_chart_correction_on_chart_error():
    ctx = _base_ctx()
    patches, calls = _patches(finalizer_verdicts=["chart_error", "approved"])
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await _exec_analytics_pipeline(ctx)

    assert calls["finalizer"] == 2
    assert calls["correction"] == 1
    assert result["success"] is True
    assert result["workflow_state"]["echarts_config"] == {"type": "line"}


@pytest.mark.asyncio
async def test_analytics_pipeline_reports_failure_when_retry_still_fails():
    """Two consecutive needs_regeneration verdicts must not loop forever —
    one bounded retry, then report whatever the final verdict says."""
    ctx = _base_ctx()
    patches, calls = _patches(finalizer_verdicts=["needs_regeneration", "needs_regeneration"])
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await _exec_analytics_pipeline(ctx)

    assert calls["finalizer"] == 2
    assert calls["insight"] == 2
    assert result["success"] is False


@pytest.mark.asyncio
async def test_visualize_calls_finalizer_and_succeeds_on_approved():
    ctx = _base_ctx(query_result=[{"a": 1}])
    patches, calls = _patches(finalizer_verdicts=["approved"])
    # _exec_visualize doesn't call skill_run_sql/analytics_node — only patches [2:] apply.
    with patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await _exec_visualize(ctx)

    assert calls["finalizer"] == 1
    assert result["success"] is True
