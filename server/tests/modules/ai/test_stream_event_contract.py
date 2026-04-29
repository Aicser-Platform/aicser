import json

import pytest
from fastapi import HTTPException

from src.modules.ai import api_streaming


async def _collect_sse_events(response) -> list[dict]:
    chunks: list[str] = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, bytes):
            chunks.append(chunk.decode("utf-8", errors="replace"))
        else:
            chunks.append(str(chunk))
    raw = "".join(chunks)
    events: list[dict] = []
    for line in raw.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[len("data: ") :].strip()
        if not payload:
            continue
        events.append(json.loads(payload))
    return events


@pytest.mark.asyncio
async def test_stream_fast_path_emits_type_and_event_type(monkeypatch):
    monkeypatch.setattr(
        api_streaming,
        "get_fast_conversational_response",
        lambda _query: "Fast response for contract test.",
    )

    request = api_streaming.ChatRequestSchema(
        query="hello",
        conversation_id=None,
        data_source_id=None,
    )
    token = {"id": "u-stream-fast", "organization_id": "org-stream-fast"}

    response = await api_streaming._stream_analyze_response(request, token)
    events = await _collect_sse_events(response)

    assert len(events) >= 2
    assert events[0].get("type") == "token"
    assert events[0].get("event_type") == "token"

    complete = next(event for event in events if event.get("type") == "complete")
    assert complete.get("event_type") == "complete"
    assert complete.get("workflow_complete") is True
    assert complete.get("success") is True


@pytest.mark.asyncio
async def test_resume_requires_original_query():
    request = api_streaming.ResumeRequestSchema(
        conversation_id="conv-resume-1",
        resume={"choices": {"time_column": "order_date"}},
        query=None,
    )
    token = {"id": "u-resume-missing-query", "organization_id": "org-resume"}

    with pytest.raises(HTTPException) as exc_info:
        await api_streaming.analyze_resume_streaming(request=request, current_token=token)

    assert exc_info.value.status_code == 400
    assert "query is required to resume" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_resume_rejects_blank_conversation_id():
    request = api_streaming.ResumeRequestSchema(
        conversation_id="   ",
        resume="order_date",
        query="show monthly sales",
    )
    token = {"id": "u-resume-blank-conv", "organization_id": "org-resume"}

    with pytest.raises(HTTPException) as exc_info:
        await api_streaming.analyze_resume_streaming(request=request, current_token=token)

    assert exc_info.value.status_code == 400
    assert "conversation_id is required" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_resume_stream_emits_event_type_alias(monkeypatch):
    class _FakeLiteLLMService:
        pass

    class _FakeDataConnectivityService:
        pass

    class _FakeMultiEngineQueryService:
        pass

    class _FakeOrchestrator:
        def __init__(self, **_kwargs):
            pass

        async def execute_streaming(self, **_kwargs):
            yield {
                "type": "progress",
                "current_stage": "query_execution",
                "progress_percentage": 40,
                "message": "Executing query",
            }
            yield {
                "type": "complete",
                "event_type": "complete",
                "workflow_complete": True,
                "success": True,
                "current_stage": "complete",
                "message": "Done",
                "execution_metadata": {"status": "completed"},
            }

    def _fake_orchestrator_imports():
        return (
            _FakeOrchestrator,
            (lambda err, context=None: str(err or "")),
            (lambda msg: msg),
        )

    monkeypatch.setattr(api_streaming, "LiteLLMService", _FakeLiteLLMService)
    monkeypatch.setattr(api_streaming, "_get_langgraph_orchestrator_imports", _fake_orchestrator_imports)

    from src.modules.data.service import data_connectivity_service
    from src.modules.data.service import multi_engine_query_service

    monkeypatch.setattr(data_connectivity_service, "DataConnectivityService", _FakeDataConnectivityService)
    monkeypatch.setattr(
        multi_engine_query_service,
        "MultiEngineQueryService",
        _FakeMultiEngineQueryService,
    )

    request = api_streaming.ResumeRequestSchema(
        conversation_id="conv-resume-2",
        resume={"choices": {"time_column": "order_date"}},
        query="show monthly sales",
        data_source_id="ds-1",
    )
    token = {"id": "u-resume-stream", "organization_id": "org-resume"}

    response = await api_streaming.analyze_resume_streaming(request=request, current_token=token)
    events = await _collect_sse_events(response)

    assert len(events) >= 2
    progress = events[0]
    assert progress.get("type") == "progress"
    assert progress.get("event_type") == "progress"

    complete = next(event for event in events if event.get("type") == "complete")
    assert complete.get("event_type") == "complete"
    assert complete.get("workflow_complete") is True


@pytest.mark.asyncio
async def test_resume_stream_error_is_sanitized_and_has_alias(monkeypatch):
    class _FakeLiteLLMService:
        pass

    class _FakeDataConnectivityService:
        pass

    class _FakeMultiEngineQueryService:
        pass

    class _FakeOrchestrator:
        def __init__(self, **_kwargs):
            pass

        async def execute_streaming(self, **_kwargs):
            raise RuntimeError("SQLSTATE[08001]: connect timeout")
            yield  # pragma: no cover

    def _fake_orchestrator_imports():
        return (
            _FakeOrchestrator,
            (lambda _err, context=None: "Friendly resume error"),
            (lambda msg: msg),
        )

    monkeypatch.setattr(api_streaming, "LiteLLMService", _FakeLiteLLMService)
    monkeypatch.setattr(api_streaming, "_get_langgraph_orchestrator_imports", _fake_orchestrator_imports)

    from src.modules.data.service import data_connectivity_service
    from src.modules.data.service import multi_engine_query_service

    monkeypatch.setattr(data_connectivity_service, "DataConnectivityService", _FakeDataConnectivityService)
    monkeypatch.setattr(
        multi_engine_query_service,
        "MultiEngineQueryService",
        _FakeMultiEngineQueryService,
    )

    request = api_streaming.ResumeRequestSchema(
        conversation_id="conv-resume-err",
        resume={"choices": {"time_column": "order_date"}},
        query="show monthly sales",
        data_source_id="ds-1",
    )
    token = {"id": "u-resume-err", "organization_id": "org-resume"}

    response = await api_streaming.analyze_resume_streaming(request=request, current_token=token)
    events = await _collect_sse_events(response)
    err = next(event for event in events if event.get("type") == "error")
    assert err.get("event_type") == "error"
    assert err.get("error") == "Friendly resume error"


@pytest.mark.asyncio
async def test_stream_bills_only_on_terminal_success(monkeypatch):
    class _FakeLiteLLMService:
        pass

    class _FakeDataConnectivityService:
        pass

    class _FakeMultiEngineQueryService:
        pass

    class _FakeOrchestrator:
        def __init__(self, **_kwargs):
            pass

        async def execute_streaming(self, **_kwargs):
            # Non-terminal interruption-like stream: no complete/workflow_complete.
            yield {
                "type": "progress",
                "current_stage": "query_execution",
                "progress_percentage": 40,
                "message": "Executing query",
            }

    def _fake_orchestrator_imports():
        return (
            _FakeOrchestrator,
            (lambda err, context=None: str(err or "")),
            (lambda msg: msg),
        )

    calls = {"count": 0}

    async def _fake_track_ai_credits_idempotent(**_kwargs):
        calls["count"] += 1
        return True, True, "ok"

    class _FakeBillingSession:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(api_streaming, "LiteLLMService", _FakeLiteLLMService)
    monkeypatch.setattr(api_streaming, "_get_langgraph_orchestrator_imports", _fake_orchestrator_imports)

    from src.modules.data.service import data_connectivity_service
    from src.modules.data.service import multi_engine_query_service

    monkeypatch.setattr(data_connectivity_service, "DataConnectivityService", _FakeDataConnectivityService)
    monkeypatch.setattr(
        multi_engine_query_service,
        "MultiEngineQueryService",
        _FakeMultiEngineQueryService,
    )
    from src.modules.pricing import usage_tracker
    monkeypatch.setattr(usage_tracker, "track_ai_credits_idempotent", _fake_track_ai_credits_idempotent)
    from src.db import session as db_session
    monkeypatch.setattr(db_session, "async_session", lambda: _FakeBillingSession())

    request = api_streaming.ChatRequestSchema(
        query="show monthly sales",
        conversation_id="conv-stream-billing",
        data_source_id="ds-1",
    )
    token = {"id": "u-stream-billing", "organization_id": "org-stream-billing"}

    response = await api_streaming._stream_analyze_response(
        request,
        token,
        credit_cost=5,
        billing_organization_id="org-stream-billing",
        billing_model="auto",
    )
    _ = await _collect_sse_events(response)
    assert calls["count"] == 0


@pytest.mark.asyncio
async def test_stream_billing_passes_credit_idempotency_key(monkeypatch):
    class _FakeLiteLLMService:
        pass

    class _FakeDataConnectivityService:
        pass

    class _FakeMultiEngineQueryService:
        pass

    class _FakeOrchestrator:
        def __init__(self, **_kwargs):
            pass

        async def execute_streaming(self, **_kwargs):
            yield {
                "type": "complete",
                "event_type": "complete",
                "workflow_complete": True,
                "success": True,
                "current_stage": "complete",
                "message": "Done",
                "execution_metadata": {"status": "completed"},
            }

    def _fake_orchestrator_imports():
        return (
            _FakeOrchestrator,
            (lambda err, context=None: str(err or "")),
            (lambda msg: msg),
        )

    seen_keys = []

    async def _fake_track_ai_credits_idempotent(**kwargs):
        seen_keys.append(kwargs.get("idempotency_key"))
        return True, True, "ok"

    class _FakeBillingSession:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(api_streaming, "LiteLLMService", _FakeLiteLLMService)
    monkeypatch.setattr(api_streaming, "_get_langgraph_orchestrator_imports", _fake_orchestrator_imports)
    from src.modules.data.service import data_connectivity_service
    from src.modules.data.service import multi_engine_query_service
    monkeypatch.setattr(data_connectivity_service, "DataConnectivityService", _FakeDataConnectivityService)
    monkeypatch.setattr(
        multi_engine_query_service,
        "MultiEngineQueryService",
        _FakeMultiEngineQueryService,
    )
    from src.modules.pricing import usage_tracker
    monkeypatch.setattr(usage_tracker, "track_ai_credits_idempotent", _fake_track_ai_credits_idempotent)
    from src.db import session as db_session
    monkeypatch.setattr(db_session, "async_session", lambda: _FakeBillingSession())

    request = api_streaming.ChatRequestSchema(
        query="show monthly sales",
        conversation_id="conv-stream-billing-key",
        data_source_id="ds-1",
    )
    token = {"id": "u-stream-billing-key", "organization_id": "org-stream-billing-key"}

    response = await api_streaming._stream_analyze_response(
        request,
        token,
        credit_cost=5,
        billing_organization_id="org-stream-billing-key",
        billing_model="auto",
        credit_idempotency_key="abc123key",
    )
    _ = await _collect_sse_events(response)
    assert seen_keys == ["abc123key"]

