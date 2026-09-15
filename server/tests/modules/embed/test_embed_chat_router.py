"""Tests for the embed-chat endpoint's scope enforcement and conversation-id
surfacing (server/ee/modules/embed/chat_router.py).

Context: this endpoint calls `analyze_unified` directly as a plain async
function (not through FastAPI's Depends()) specifically so its signature,
decorators, and route registration never need to change -- real
session-authenticated behavior on POST /ai/analyze stays untouched. These
tests exercise everything THIS module is responsible for around that call:
forcing data_source_id/kb_library_ids to what the assistant was actually
configured for (never trusting whatever an anonymous visitor's browser
sent), rejecting an analysis_mode outside allowed_modes, building the
manufactured current_token from the *owner's* identity (never the visitor's),
and surfacing the resolved conversation_id back to the caller without
modifying analyze_unified's own return shape.

Calling `embed_chat_analyze` directly with an explicit `ctx=` argument
bypasses Depends() the same way the module itself bypasses it for
analyze_unified -- this is a plain function call, not a FastAPI dependency
resolution.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ee.modules.ai.api_streaming import ChatRequestSchema
from ee.modules.embed import chat_router
from ee.modules.embed.chat_auth import EmbedChatContext


def _ctx(**overrides) -> EmbedChatContext:
    defaults = dict(
        assistant_id=str(uuid.uuid4()),
        name="Bot",
        organization_id=str(uuid.uuid4()),
        project_id=None,
        primary_data_source_id="ds-primary",
        data_source_ids=[],
        allowed_modes=["ai_search"],
        library_ids=["lib-1"],
        capabilities="rag_only",
        owner_user_id="owner-1",
        visitor_id="visitor-1",
        token_jti="jti-1",
    )
    defaults.update(overrides)
    return EmbedChatContext(**defaults)


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    monkeypatch.setattr(chat_router, "check_embed_rate_limit", AsyncMock(return_value=None))


@pytest.mark.asyncio
async def test_client_supplied_data_source_id_is_overridden_by_assistant_config(monkeypatch):
    """Never trust an anonymous visitor's data_source_id -- force whatever
    the assistant admin actually configured (EmbedAssistant.primary_data_source_id)."""
    ctx = _ctx(primary_data_source_id="ds-safe")
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", data_source_id="ds-attacker-supplied", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    sent_request = analyze_mock.call_args.kwargs["request"]
    assert sent_request.data_source_id == "ds-safe"


@pytest.mark.asyncio
async def test_data_source_id_untouched_when_assistant_has_none_configured(monkeypatch):
    ctx = _ctx(primary_data_source_id=None)
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", data_source_id="ds-from-client", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    sent_request = analyze_mock.call_args.kwargs["request"]
    assert sent_request.data_source_id == "ds-from-client"


@pytest.mark.asyncio
async def test_client_supplied_kb_library_ids_overridden_by_assistant_config(monkeypatch):
    """Same rationale as data_source_id: an anonymous visitor must not be
    able to read RAG content from libraries this assistant was never
    granted by passing an arbitrary kb_library_ids array."""
    ctx = _ctx(library_ids=["lib-allowed"])
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(
        query="hi", analysis_mode="ai_search", kb_library_ids=["lib-attacker-supplied"],
    )
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    sent_request = analyze_mock.call_args.kwargs["request"]
    assert sent_request.kb_library_ids == ["lib-allowed"]


@pytest.mark.asyncio
async def test_disallowed_analysis_mode_rejected_400_before_calling_analyze(monkeypatch):
    ctx = _ctx(allowed_modes=["ai_search"])
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="standard")
    with pytest.raises(HTTPException) as exc:
        await chat_router.embed_chat_analyze(
            assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
            stream=False, ctx=ctx,
        )
    assert exc.value.status_code == 400
    analyze_mock.assert_not_called()


@pytest.mark.asyncio
async def test_allowed_analysis_mode_passes_through(monkeypatch):
    ctx = _ctx(allowed_modes=["ai_search", "standard"])
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="standard")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )
    analyze_mock.assert_called_once()


@pytest.mark.asyncio
async def test_empty_allowed_modes_permits_any_mode(monkeypatch):
    """allowed_modes=[] (assistant never restricted modes) must not reject
    everything -- only a non-empty allowlist gates request.analysis_mode."""
    ctx = _ctx(allowed_modes=[])
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="anything_goes")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )
    analyze_mock.assert_called_once()


@pytest.mark.asyncio
async def test_manufactured_token_carries_owner_identity_not_visitor_id(monkeypatch):
    """The embed-token owner's user_id is used only as the internal
    billing/acting identity analyze_unified expects in current_token -- must
    never be the visitor id, and must be shaped like JWTCookieBearer's
    normal return value (id/user_id/sub/organization_id)."""
    ctx = _ctx(owner_user_id="admin-owner-123", organization_id="org-999", visitor_id="visitor-should-not-appear")
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    token = analyze_mock.call_args.kwargs["current_token"]
    assert token["id"] == "admin-owner-123"
    assert token["user_id"] == "admin-owner-123"
    assert token["sub"] == "admin-owner-123"
    assert token["organization_id"] == "org-999"
    assert "visitor-should-not-appear" not in token.values()


@pytest.mark.asyncio
async def test_resolved_conversation_id_is_set_on_request_before_analyze_call(monkeypatch):
    ctx = _ctx()
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-resolved"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search", conversation_id=None)
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    sent_request = analyze_mock.call_args.kwargs["request"]
    assert sent_request.conversation_id == "conv-resolved"


@pytest.mark.asyncio
async def test_stream_false_response_gets_conversation_id_key_added(monkeypatch):
    ctx = _ctx()
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-abc"))
    monkeypatch.setattr(chat_router, "analyze_unified", AsyncMock(return_value={"summary": "hi"}))

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    result = await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )
    assert result["conversation_id"] == "conv-abc"


@pytest.mark.asyncio
async def test_stream_true_response_gets_conversation_id_header(monkeypatch):
    ctx = _ctx()
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-xyz"))

    async def _gen():
        yield b"data: {}\n\n"

    fake_stream_response = StreamingResponse(_gen(), media_type="text/event-stream")
    monkeypatch.setattr(chat_router, "analyze_unified", AsyncMock(return_value=fake_stream_response))

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    result = await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=True, ctx=ctx,
    )
    assert result.headers["X-Embed-Conversation-Id"] == "conv-xyz"


@pytest.mark.asyncio
async def test_two_or_more_data_source_ids_activate_federation(monkeypatch):
    """2+ configured data_source_ids -> selected_data_source_ids (cross-source
    DuckDB federation), not the single-source data_source_id field."""
    ctx = _ctx(primary_data_source_id="ds-legacy", data_source_ids=["ds-a", "ds-b"])
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    sent_request = analyze_mock.call_args.kwargs["request"]
    assert sent_request.selected_data_source_ids == ["ds-a", "ds-b"]
    assert sent_request.data_source_id is None


@pytest.mark.asyncio
async def test_exactly_one_data_source_id_sets_single_data_source_id(monkeypatch):
    ctx = _ctx(primary_data_source_id="ds-legacy", data_source_ids=["ds-only"])
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    sent_request = analyze_mock.call_args.kwargs["request"]
    assert sent_request.data_source_id == "ds-only"
    assert sent_request.selected_data_source_ids is None


@pytest.mark.asyncio
async def test_empty_data_source_ids_falls_back_to_primary_data_source_id(monkeypatch):
    ctx = _ctx(primary_data_source_id="ds-legacy", data_source_ids=[])
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    sent_request = analyze_mock.call_args.kwargs["request"]
    assert sent_request.data_source_id == "ds-legacy"


@pytest.mark.asyncio
async def test_preferred_model_overrides_client_supplied_model(monkeypatch):
    ctx = _ctx(preferred_model="gpt-5")
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search", model="attacker-supplied-model")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert analyze_mock.call_args.kwargs["request"].model == "gpt-5"


@pytest.mark.asyncio
async def test_no_preferred_model_leaves_client_model_untouched(monkeypatch):
    ctx = _ctx(preferred_model=None)
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search", model="client-model")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert analyze_mock.call_args.kwargs["request"].model == "client-model"


@pytest.mark.asyncio
async def test_temperature_override_applied_when_set(monkeypatch):
    ctx = _ctx(temperature=0.3)
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert analyze_mock.call_args.kwargs["request"].temperature == 0.3


@pytest.mark.asyncio
async def test_temperature_zero_is_applied_not_treated_as_falsy(monkeypatch):
    """0.0 is a valid, deliberate temperature -- must not be dropped by an
    `if ctx.temperature:` truthiness check."""
    ctx = _ctx(temperature=0.0)
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert analyze_mock.call_args.kwargs["request"].temperature == 0.0


@pytest.mark.asyncio
async def test_no_temperature_configured_leaves_request_temperature_none(monkeypatch):
    ctx = _ctx(temperature=None)
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert analyze_mock.call_args.kwargs["request"].temperature is None


@pytest.mark.asyncio
async def test_system_prompt_becomes_custom_instructions(monkeypatch):
    ctx = _ctx(system_prompt="You are a helpful support bot for Acme.")
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert analyze_mock.call_args.kwargs["request"].custom_instructions == "You are a helpful support bot for Acme."


@pytest.mark.asyncio
async def test_no_system_prompt_leaves_custom_instructions_none(monkeypatch):
    ctx = _ctx(system_prompt=None)
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", AsyncMock(return_value="conv-1"))
    analyze_mock = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(chat_router, "analyze_unified", analyze_mock)

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert analyze_mock.call_args.kwargs["request"].custom_instructions is None


@pytest.mark.asyncio
async def test_get_embed_chat_config_includes_builder_display_fields(monkeypatch):
    ctx = _ctx(
        welcome_message="Hi there!",
        conversation_starters=["What can you do?", "Show me revenue"],
        icon_emoji="🤖",
        color="#4F46E5",
    )
    result = await chat_router.get_embed_chat_config(assistant_id=ctx.assistant_id, ctx=ctx)
    assert result["welcome_message"] == "Hi there!"
    assert result["conversation_starters"] == ["What can you do?", "Show me revenue"]
    assert result["icon_emoji"] == "🤖"
    assert result["color"] == "#4F46E5"
    # Server-side-only fields must never leak into the client-facing config.
    assert "system_prompt" not in result
    assert "fallback_message" not in result
    assert "temperature" not in result
    assert "preferred_model" not in result


@pytest.mark.asyncio
async def test_rate_limit_checked_before_conversation_resolution(monkeypatch):
    """Rate limit must run before any DB write (conversation creation) so an
    abusive visitor can't spam new Conversation rows past their budget."""
    ctx = _ctx()
    call_order = []

    async def _rate_limit(*_a, **_k):
        call_order.append("rate_limit")

    async def _resolve_conv(*_a, **_k):
        call_order.append("resolve_conversation")
        return "conv-1"

    monkeypatch.setattr(chat_router, "check_embed_rate_limit", _rate_limit)
    monkeypatch.setattr(chat_router, "resolve_embed_conversation", _resolve_conv)
    monkeypatch.setattr(chat_router, "analyze_unified", AsyncMock(return_value={"ok": True}))

    body = ChatRequestSchema(query="hi", analysis_mode="ai_search")
    await chat_router.embed_chat_analyze(
        assistant_id=ctx.assistant_id, request=body, http_request=SimpleNamespace(),
        stream=False, ctx=ctx,
    )

    assert call_order == ["rate_limit", "resolve_conversation"]
