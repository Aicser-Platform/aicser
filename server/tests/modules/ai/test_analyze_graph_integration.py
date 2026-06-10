"""Smoke tests for LangGraph analyze workflow graph construction."""

import pytest

pytest.importorskip("langgraph")


def test_build_graph_compiles():
    from src.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator

    orch = LangGraphMultiAgentOrchestrator.__new__(LangGraphMultiAgentOrchestrator)
    graph = orch._build_graph()
    assert graph is not None


def test_build_initial_state_has_trace():
    from ee.modules.ai.orchestrator.initial_state import build_initial_state

    class _Lite:
        active_model = "test-model"
        default_model = "test-model"

    state = build_initial_state(
        litellm_service=_Lite(),
        query="show sales",
        conversation_id="conv-1",
        user_id="u-1",
        organization_id="org-1",
        data_source_id="ds-1",
    )
    assert state["trace_id"]
    assert state["current_stage"] == "start"
    assert state["execution_metadata"]["analysis_mode"] == "standard"
