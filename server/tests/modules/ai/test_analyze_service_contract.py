import os

import pytest

os.environ["DEBUG"] = "false"

from src.modules.ai.services import analyze_service


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
                "sql_query": "SELECT 1",
                "query_result": [{"value": 1}],
                "query_result_data": [{"value": 1}],
                "query_result_row_count": 1,
                "query_result_columns": ["value"],
                "chart_config": {"series": []},
                "execution_metadata": {"status": "error"},
            }

    class _FakeDataConnectivityService:
        pass

    class _FakeMultiEngineQueryService:
        pass

    from src.modules.ai.services import langgraph_orchestrator
    from src.modules.data.services import data_connectivity_service
    from src.modules.data.services import multi_engine_query_service

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
        "get_multi_engine_query_service",
        lambda: _FakeMultiEngineQueryService(),
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
    assert result.get("sql_query") == "SELECT 1"
    assert result.get("query_result_data") == [{"value": 1}]
    assert result.get("query_result_row_count") == 1
    assert result.get("chart_config") == {"series": []}
    assert result.get("message") == "workflow failed"
