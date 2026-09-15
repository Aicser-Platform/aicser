"""Tests for the embed-chat auth dependency (server/ee/modules/embed/chat_auth.py).

Context: `analyze_unified` (ee/modules/ai/api_streaming.py) is guarded only
by JWTCookieBearer, which validates a real login session (cookie or
Supabase/Keycloak bearer, signed with settings.SECRET_KEY/JWT_SECRET) --
never the embed JWT (signed with the separate settings.JWT_SECRET_KEY, see
src/modules/embed/service.py). `get_embed_chat_context` is the new, separate
trust boundary that lets a real anonymous embed visitor in at all. These
tests lock in its full reject-condition list so a future change can't
silently loosen it -- e.g. accidentally accepting a token for an assistant
still on the default "session" auth_mode (which must keep requiring a real
session), or a token minted for a different org's assistant.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from jose import JWTError

from ee.modules.embed import chat_auth
from ee.modules.embed.models import EmbedAssistant


def _fake_request(headers: dict) -> SimpleNamespace:
    return SimpleNamespace(headers=headers)


def _make_assistant(**overrides) -> EmbedAssistant:
    defaults = dict(
        id=uuid.uuid4(),
        name="Support Bot",
        organization_id=uuid.uuid4(),
        project_id=None,
        capabilities="rag_only",
        library_ids=["lib-1"],
        primary_data_source_id="ds-1",
        allowed_modes=["ai_search"],
        auth_mode="embed_jwt",
        is_active=True,
        is_deleted=False,
    )
    defaults.update(overrides)
    return EmbedAssistant(**defaults)


def _verified_token(org_id, user_id: str = "owner-1") -> dict:
    return {
        "valid": True,
        "scopes": ["chat"],
        "resource_id": None,
        "user_id": user_id,
        "org_id": org_id,
        "allowed_domains": [],
        "jti": "jti-1",
    }


@pytest.mark.asyncio
async def test_missing_authorization_header_rejected_401():
    request = _fake_request({"X-Embed-Visitor-Id": "visitor-1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context("assistant-1", request)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_non_bearer_authorization_header_rejected_401():
    request = _fake_request({"Authorization": "Basic abc", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context("assistant-1", request)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_missing_visitor_id_header_rejected_400():
    """Without a per-visitor id the backend has no way to isolate two
    different anonymous visitors of the same widget from each other -- must
    reject outright, not silently pool them into the token owner's identity."""
    request = _fake_request({"Authorization": "Bearer tok"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context("assistant-1", request)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_blank_visitor_id_header_rejected_400():
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "   "})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context("assistant-1", request)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_invalid_or_expired_or_revoked_token_rejected_401(monkeypatch):
    monkeypatch.setattr(chat_auth, "verify_embed_token", AsyncMock(side_effect=JWTError("bad token")))
    request = _fake_request({"Authorization": "Bearer bad", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context("assistant-1", request)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_wrong_scope_token_rejected_401(monkeypatch):
    """verify_embed_token(required_scope='chat') itself raises JWTError for a
    token minted with e.g. only ['dashboard'] scope -- confirm that surfaces
    as a clean 401 here rather than propagating an unhandled exception."""
    monkeypatch.setattr(
        chat_auth, "verify_embed_token",
        AsyncMock(side_effect=JWTError("Missing required scope: chat")),
    )
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context("assistant-1", request)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_assistant_not_found_rejected_404(monkeypatch):
    org_id = str(uuid.uuid4())
    monkeypatch.setattr(chat_auth, "verify_embed_token", AsyncMock(return_value=_verified_token(org_id)))
    monkeypatch.setattr(chat_auth.EmbedAssistantService, "get_assistant", AsyncMock(return_value=None))
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context("assistant-1", request)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_soft_deleted_assistant_rejected_404(monkeypatch):
    assistant = _make_assistant(is_deleted=True)
    org_id = str(assistant.organization_id)
    monkeypatch.setattr(chat_auth, "verify_embed_token", AsyncMock(return_value=_verified_token(org_id)))
    monkeypatch.setattr(chat_auth.EmbedAssistantService, "get_assistant", AsyncMock(return_value=assistant))
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context(str(assistant.id), request)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_session_auth_mode_assistant_rejects_embed_token_403(monkeypatch):
    """The opt-in gate: an assistant left at the default 'session' auth_mode
    must NOT accept this token path at all, even with an otherwise-valid
    token and matching org -- it must keep requiring a real session."""
    assistant = _make_assistant(auth_mode="session")
    org_id = str(assistant.organization_id)
    monkeypatch.setattr(chat_auth, "verify_embed_token", AsyncMock(return_value=_verified_token(org_id)))
    monkeypatch.setattr(chat_auth.EmbedAssistantService, "get_assistant", AsyncMock(return_value=assistant))
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context(str(assistant.id), request)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_inactive_assistant_rejected_403(monkeypatch):
    assistant = _make_assistant(is_active=False)
    org_id = str(assistant.organization_id)
    monkeypatch.setattr(chat_auth, "verify_embed_token", AsyncMock(return_value=_verified_token(org_id)))
    monkeypatch.setattr(chat_auth.EmbedAssistantService, "get_assistant", AsyncMock(return_value=assistant))
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context(str(assistant.id), request)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_org_mismatch_rejected_403(monkeypatch):
    """Defense in depth: a token minted for org A must never work against
    org B's assistant, even with a valid signature and embed_jwt auth_mode."""
    assistant = _make_assistant()
    other_org_id = str(uuid.uuid4())
    monkeypatch.setattr(
        chat_auth, "verify_embed_token", AsyncMock(return_value=_verified_token(other_org_id))
    )
    monkeypatch.setattr(chat_auth.EmbedAssistantService, "get_assistant", AsyncMock(return_value=assistant))
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "v1"})
    with pytest.raises(HTTPException) as exc:
        await chat_auth.get_embed_chat_context(str(assistant.id), request)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_anonymous_auth_mode_is_accepted_and_context_populated(monkeypatch):
    assistant = _make_assistant(auth_mode="anonymous")
    org_id = str(assistant.organization_id)
    monkeypatch.setattr(
        chat_auth, "verify_embed_token",
        AsyncMock(return_value=_verified_token(org_id, user_id="owner-9")),
    )
    monkeypatch.setattr(chat_auth.EmbedAssistantService, "get_assistant", AsyncMock(return_value=assistant))
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "visitor-42"})

    ctx = await chat_auth.get_embed_chat_context(str(assistant.id), request)

    assert ctx.assistant_id == str(assistant.id)
    assert ctx.organization_id == org_id
    assert ctx.owner_user_id == "owner-9"
    assert ctx.visitor_id == "visitor-42"
    assert ctx.primary_data_source_id == "ds-1"
    assert ctx.allowed_modes == ["ai_search"]
    assert ctx.library_ids == ["lib-1"]
    assert ctx.auth_mode == "anonymous"


@pytest.mark.asyncio
async def test_embed_jwt_auth_mode_is_accepted(monkeypatch):
    assistant = _make_assistant(auth_mode="embed_jwt")
    org_id = str(assistant.organization_id)
    monkeypatch.setattr(chat_auth, "verify_embed_token", AsyncMock(return_value=_verified_token(org_id)))
    monkeypatch.setattr(chat_auth.EmbedAssistantService, "get_assistant", AsyncMock(return_value=assistant))
    request = _fake_request({"Authorization": "Bearer tok", "X-Embed-Visitor-Id": "v1"})

    ctx = await chat_auth.get_embed_chat_context(str(assistant.id), request)
    assert ctx.auth_mode == "embed_jwt"
