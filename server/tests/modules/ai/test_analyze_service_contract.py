import pytest

from src.modules.ai.service import analyze_service


@pytest.mark.asyncio
async def test_run_langgraph_sync_propagates_failure_success_flag(monkeypatch):
    class _FakeOrchestrator:
        def __init__(self, **_kwargs):
            pass

        async def execute(self, **_kwargs):
            return {
                "success": False,
                "error": "simulated orchestrator failure",
                "message": "workflow failed",
                "execution_metadata": {"status": "error"},
            }

    class _FakeDataConnectivityService:
        pass

    class _FakeMultiEngineQueryService:
        pass

    from src.modules.ai.service import langgraph_orchestrator
    from src.modules.data.service import data_connectivity_service
    from src.modules.data.service import multi_engine_query_service

    monkeypatch.setattr(
        langgraph_orchestrator,
        "LangGraphMultiAgentOrchestrator",
        _FakeOrchestrator,
    )
    monkeypatch.setattr(
        data_connectivity_service,
        "DataConnectivityService",
        _FakeDataConnectivityService,
    )
    monkeypatch.setattr(
        multi_engine_query_service,
        "MultiEngineQueryService",
        _FakeMultiEngineQueryService,
    )

    result = await analyze_service._run_langgraph_sync(
        query="show sales",
        data_source_id="ds-1",
        kb_data_source_id=None,
        conversation_id="conv-1",
        user_id="u-1",
        organization_id="org-1",
        model=None,
        analysis_mode="standard",
        analytics_type="descriptive",
    )
    assert result.get("success") is False
