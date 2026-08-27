"""deep_file_analysis_node is self-contained (builds its own DataConnectivityService
etc.) - this capability is a thin pass-through with no evidence-gathering step of its
own to add first, unlike executive_report/decision_brief. Registered so a kernel
multi-step/custom plan can compose a deep dive into a larger compound ask; a standalone
"give me a deep dive" request never reaches the kernel at all (should_use_agent_kernel()
excludes deep-file-analysis-intent queries so they reach the classic graph's LLM
orchestrator instead — the only thing that currently knows to route to this node
directly for a standalone ask)."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.kernel.capability_registry import _exec_deep_file_analysis


@pytest.mark.asyncio
async def test_success_passes_through_workflow_state():
    state = {"query": "deep dive on this file", "data_source_id": "ds-1"}
    ctx = {"workflow_state": state}

    node_mock = AsyncMock(
        return_value={**state, "current_stage": "deep_analysis_complete", "analytics_metadata": {"foo": 1}}
    )

    with patch(
        "ee.modules.ai.nodes.deep_file_analysis_node.deep_file_analysis_node", node_mock
    ):
        result = await _exec_deep_file_analysis(ctx)

    node_mock.assert_awaited_once()
    assert result["success"] is True
    assert result["capability"] == "deep_file_analysis"
    assert result["workflow_state"]["analytics_metadata"] == {"foo": 1}
    assert "error" not in result


@pytest.mark.asyncio
async def test_node_error_surfaces_as_failure_not_raised_exception():
    state = {"query": "deep dive on this file", "data_source_id": "ds-1"}
    ctx = {"workflow_state": state}

    node_mock = AsyncMock(
        return_value={**state, "current_stage": "deep_analysis_error", "error": "Data source ds-1 not found"}
    )

    with patch(
        "ee.modules.ai.nodes.deep_file_analysis_node.deep_file_analysis_node", node_mock
    ):
        result = await _exec_deep_file_analysis(ctx)

    assert result["success"] is False
    assert result["error"] == "Data source ds-1 not found"
