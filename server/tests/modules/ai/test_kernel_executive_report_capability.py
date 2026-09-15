"""_exec_executive_report called executive_report_planner_node and
executive_report_synthesis_node with an extra litellm positional argument
neither accepts (they each build their own LiteLLMService internally) -
every kernel-routed executive report request raised TypeError before any
report_plan/sections/executive_summary was produced. Since
should_use_agent_kernel() now routes every request through the kernel, this
was a 100% failure rate for "Forecast revenue for Q4 and write it up as an
executive report"-style requests, surfaced to the user as a vague failed
plan step.

Kernel-unification roadmap step 1: the classic graph's edges are
report_synthesis -> response_finalizer -> artifact_quality_gate
(graph_builder.py), but _exec_executive_report stopped at synthesis.
response_finalizer's job for report state is progressive-narration
streaming only (its own evaluation logic passes through untouched for
report_sections state - see the "Executive Report passthrough" branch in
response_finalizer_node.py); artifact_quality_gate is where the real,
distinct completeness assessment (state["artifact_quality"]) actually gets
computed. Without both calls, a kernel-routed report never got that
observability field populated at all, even though the report's own
is_partial/disclosure-note logic (executive_report_synthesis_node, fixed
earlier this session) already ran correctly either way - two genuinely
different things, both real gaps.

Patch target note: these tests patch `ee.modules.ai.nodes.*`, not
`src.modules.ai.nodes.*` - the latter is a separate, stale module object
(confirmed via `ee.modules.ai.nodes.X is not src.modules.ai.nodes.X` despite
both loading the same file on disk) that capability_registry.py's actual
imports never resolve through, so patching it silently no-ops and lets the
real node run instead of the fake. The original version of this test file
had exactly that bug, discovered while extending it for this fix.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_executive_report


def _base_ctx(state=None):
    return {
        "workflow_state": state if state is not None else {"query": "quarterly executive report"},
        "litellm_service": object(),
        "multi_query_service": object(),
        "data_service": object(),
    }


@pytest.mark.asyncio
async def test_calls_planner_and_synthesis_with_state_only():
    ctx = _base_ctx()
    state = ctx["workflow_state"]

    planner_mock = AsyncMock(side_effect=lambda s: {**s, "report_plan": {"sections": []}})
    execution_mock = AsyncMock(side_effect=lambda s, mq, ds: {**s, "report_sections": [{"id": "s1", "status": "complete"}]})
    synthesis_mock = AsyncMock(side_effect=lambda s: {**s, "executive_summary": "All good."})
    finalizer_mock = AsyncMock(side_effect=lambda s: s)
    gate_mock = AsyncMock(side_effect=lambda s: s)

    with patch(
        "ee.modules.ai.nodes.executive_report_planner_node.executive_report_planner_node", planner_mock
    ), patch(
        "ee.modules.ai.nodes.executive_report_execution_node.executive_report_execution_node", execution_mock
    ), patch(
        "ee.modules.ai.nodes.executive_report_synthesis_node.executive_report_synthesis_node", synthesis_mock
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node", finalizer_mock
    ), patch(
        "ee.modules.ai.nodes.artifact_quality_gate_node.artifact_quality_gate_node", gate_mock
    ):
        result = await _exec_executive_report(ctx)

    # Regression: these must be called with ONLY state - a second positional
    # arg (litellm) raises TypeError against the real single-argument nodes.
    planner_mock.assert_awaited_once_with(state)
    synthesis_mock.assert_awaited_once()
    assert len(synthesis_mock.await_args.args) == 1
    execution_mock.assert_awaited_once()
    finalizer_mock.assert_awaited_once()
    gate_mock.assert_awaited_once()
    assert result["success"] is True
    assert result["workflow_state"]["executive_summary"] == "All good."


@pytest.mark.asyncio
async def test_response_finalizer_and_quality_gate_run_after_synthesis_in_order():
    """Order matters: quality gate must see whatever response_finalizer
    leaves behind, matching the classic graph's edge order exactly."""
    ctx = _base_ctx()
    call_order = []

    async def fake_planner(s):
        return {**s, "report_plan": {"sections": []}}

    async def fake_execution(s, mq, ds):
        return {**s, "report_sections": [{"id": "s1", "status": "complete"}]}

    async def fake_synthesis(s):
        call_order.append("synthesis")
        return {**s, "executive_summary": "Report body."}

    async def fake_finalizer(s):
        call_order.append("response_finalizer")
        return {**s, "current_stage": "report_synthesis_complete"}

    async def fake_gate(s):
        call_order.append("artifact_quality_gate")
        assert s.get("current_stage") == "report_synthesis_complete"
        return {**s, "artifact_quality": {"artifact": "executive_report", "score": 1.0, "sections_complete": 1}}

    with patch(
        "ee.modules.ai.nodes.executive_report_planner_node.executive_report_planner_node", fake_planner
    ), patch(
        "ee.modules.ai.nodes.executive_report_execution_node.executive_report_execution_node", fake_execution
    ), patch(
        "ee.modules.ai.nodes.executive_report_synthesis_node.executive_report_synthesis_node", fake_synthesis
    ), patch(
        "ee.modules.ai.nodes.response_finalizer_node.response_finalizer_node", fake_finalizer
    ), patch(
        "ee.modules.ai.nodes.artifact_quality_gate_node.artifact_quality_gate_node", fake_gate
    ):
        result = await _exec_executive_report(ctx)

    assert call_order == ["synthesis", "response_finalizer", "artifact_quality_gate"]
    assert result["workflow_state"]["artifact_quality"]["sections_complete"] == 1


@pytest.mark.asyncio
async def test_fails_closed_when_services_missing_instead_of_raising():
    state = {"query": "quarterly executive report"}
    ctx = {"workflow_state": state, "litellm_service": object()}

    result = await _exec_executive_report(ctx)

    assert result["success"] is False
    assert "requires query and data services" in result["error"]
