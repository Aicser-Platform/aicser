"""Tests for embed-chat conversation isolation
(server/ee/modules/embed/chat_conversation.py).

Context: Conversation (ee/modules/chats/models.py) has nullable user_id/
project_id and a free-form json_metadata Text column. resolve_embed_conversation
tags every conversation it creates with {"embed_assistant_id",
"embed_visitor_id", "embed_token_jti"} and requires an exact match before
letting a caller-supplied conversation_id be reused. This is the boundary
that stops visitor A from reusing/reading visitor B's conversation (both
would otherwise resolve to the same embed-token-owner identity, since
neither has a real user account) and stops this endpoint from being usable
against an ordinary in-app conversation that was never embed-tagged.

These tests use a fake in-memory session (no real DB) so they exercise the
matching logic itself, not SQLAlchemy/Postgres.
"""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi import HTTPException

from ee.modules.chats.models import Conversation
from ee.modules.embed import chat_conversation
from ee.modules.embed.chat_auth import EmbedChatContext


def _ctx(**overrides) -> EmbedChatContext:
    defaults = dict(
        assistant_id=str(uuid.uuid4()),
        name="Bot",
        organization_id=str(uuid.uuid4()),
        project_id=None,
        primary_data_source_id=None,
        data_source_ids=[],
        allowed_modes=[],
        library_ids=[],
        capabilities="rag_only",
        owner_user_id=str(uuid.uuid4()),
        visitor_id="visitor-a",
        token_jti="jti-1",
    )
    defaults.update(overrides)
    return EmbedChatContext(**defaults)


class _FakeDB:
    """Stands in for the AsyncSession used inside `async with async_session()
    as db:` — only implements what resolve_embed_conversation calls."""

    def __init__(self, get_return=None):
        self.added = []
        self.committed = False
        self.refreshed = []
        self.get_return = get_return
        self.get_calls = []

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        self.refreshed.append(obj)
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()

    async def get(self, model, id_):
        self.get_calls.append((model, id_))
        return self.get_return


class _FakeSessionCtx:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_session(monkeypatch, db: _FakeDB) -> None:
    monkeypatch.setattr(chat_conversation, "async_session", lambda: _FakeSessionCtx(db))


@pytest.mark.asyncio
async def test_no_conversation_id_creates_new_tagged_conversation(monkeypatch):
    ctx = _ctx(project_id=str(uuid.uuid4()))
    db = _FakeDB()
    _patch_session(monkeypatch, db)

    result = await chat_conversation.resolve_embed_conversation(ctx, None)

    assert db.committed is True
    assert len(db.added) == 1
    created = db.added[0]
    assert isinstance(created, Conversation)
    assert str(created.user_id) == ctx.owner_user_id
    assert str(created.project_id) == ctx.project_id
    metadata = json.loads(created.json_metadata)
    assert metadata["embed_assistant_id"] == ctx.assistant_id
    assert metadata["embed_visitor_id"] == ctx.visitor_id
    assert metadata["embed_token_jti"] == ctx.token_jti
    assert result == str(created.id)


@pytest.mark.asyncio
async def test_blank_conversation_id_is_treated_as_absent(monkeypatch):
    ctx = _ctx()
    db = _FakeDB()
    _patch_session(monkeypatch, db)

    result = await chat_conversation.resolve_embed_conversation(ctx, "   ")

    assert len(db.added) == 1
    assert result == str(db.added[0].id)


@pytest.mark.asyncio
async def test_matching_conversation_id_is_reused_without_creating_a_new_one(monkeypatch):
    ctx = _ctx(assistant_id="assistant-1", visitor_id="visitor-a")
    conv_id = uuid.uuid4()
    existing = Conversation(
        id=conv_id,
        is_deleted=False,
        json_metadata=json.dumps(
            {"embed_assistant_id": "assistant-1", "embed_visitor_id": "visitor-a", "embed_token_jti": "jti-1"}
        ),
    )
    db = _FakeDB(get_return=existing)
    _patch_session(monkeypatch, db)

    result = await chat_conversation.resolve_embed_conversation(ctx, str(conv_id))

    assert result == str(conv_id)
    assert db.added == []
    assert db.committed is False


@pytest.mark.asyncio
async def test_visitor_a_cannot_reuse_visitor_bs_conversation(monkeypatch):
    """The core isolation guarantee: a conversation tagged for visitor B must
    be rejected when visitor A's context tries to use it, even for the same
    assistant."""
    conv_id = uuid.uuid4()
    conversation_tagged_for_b = Conversation(
        id=conv_id,
        is_deleted=False,
        json_metadata=json.dumps(
            {"embed_assistant_id": "assistant-1", "embed_visitor_id": "visitor-b", "embed_token_jti": "jti-1"}
        ),
    )
    db = _FakeDB(get_return=conversation_tagged_for_b)
    _patch_session(monkeypatch, db)

    ctx_visitor_a = _ctx(assistant_id="assistant-1", visitor_id="visitor-a")
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx_visitor_a, str(conv_id))
    assert exc.value.status_code == 403

    # Sanity check the fixture itself: visitor B's own context IS allowed.
    ctx_visitor_b = _ctx(assistant_id="assistant-1", visitor_id="visitor-b")
    result = await chat_conversation.resolve_embed_conversation(ctx_visitor_b, str(conv_id))
    assert result == str(conv_id)


@pytest.mark.asyncio
async def test_conversation_tagged_for_different_assistant_rejected(monkeypatch):
    """Also guards against reuse across two different embed assistants in
    the same org, not just across visitors of the same one."""
    conv_id = uuid.uuid4()
    conversation = Conversation(
        id=conv_id,
        is_deleted=False,
        json_metadata=json.dumps(
            {"embed_assistant_id": "assistant-OTHER", "embed_visitor_id": "visitor-a", "embed_token_jti": "jti-1"}
        ),
    )
    db = _FakeDB(get_return=conversation)
    _patch_session(monkeypatch, db)

    ctx = _ctx(assistant_id="assistant-1", visitor_id="visitor-a")
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx, str(conv_id))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_missing_json_metadata_treated_as_non_match_not_a_crash(monkeypatch):
    conv_id = uuid.uuid4()
    conversation = Conversation(id=conv_id, is_deleted=False, json_metadata=None)
    db = _FakeDB(get_return=conversation)
    _patch_session(monkeypatch, db)

    ctx = _ctx()
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx, str(conv_id))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_malformed_json_metadata_treated_as_non_match_not_a_crash(monkeypatch):
    """A conversation whose json_metadata isn't valid JSON (e.g. hand-edited,
    or corrupted) must fail closed -- never raise an unhandled
    JSONDecodeError, and never be treated as a match."""
    conv_id = uuid.uuid4()
    conversation = Conversation(id=conv_id, is_deleted=False, json_metadata="{not valid json{{{")
    db = _FakeDB(get_return=conversation)
    _patch_session(monkeypatch, db)

    ctx = _ctx()
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx, str(conv_id))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_json_metadata_that_is_a_json_array_not_object_treated_as_non_match(monkeypatch):
    """json.loads succeeds but yields a list, not a dict -- .get() would
    crash on a plain list; must still fail closed instead."""
    conv_id = uuid.uuid4()
    conversation = Conversation(id=conv_id, is_deleted=False, json_metadata=json.dumps(["not", "a", "dict"]))
    db = _FakeDB(get_return=conversation)
    _patch_session(monkeypatch, db)

    ctx = _ctx()
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx, str(conv_id))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_conversation_not_found_rejected_403_not_404(monkeypatch):
    """Not-found and mismatch return the identical 403 -- this endpoint must
    not distinguish "doesn't exist" from "not yours" for an arbitrary
    conversation_id, which would let a visitor probe for valid ids."""
    db = _FakeDB(get_return=None)
    _patch_session(monkeypatch, db)

    ctx = _ctx()
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx, str(uuid.uuid4()))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_soft_deleted_conversation_rejected_403(monkeypatch):
    conv_id = uuid.uuid4()
    conversation = Conversation(
        id=conv_id,
        is_deleted=True,
        json_metadata=json.dumps(
            {"embed_assistant_id": "assistant-1", "embed_visitor_id": "visitor-a"}
        ),
    )
    db = _FakeDB(get_return=conversation)
    _patch_session(monkeypatch, db)

    ctx = _ctx(assistant_id="assistant-1", visitor_id="visitor-a")
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx, str(conv_id))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_non_uuid_conversation_id_rejected_403_not_a_crash(monkeypatch):
    db = _FakeDB()
    _patch_session(monkeypatch, db)

    ctx = _ctx()
    with pytest.raises(HTTPException) as exc:
        await chat_conversation.resolve_embed_conversation(ctx, "not-a-real-uuid")
    assert exc.value.status_code == 403
    # Never fell through to creating a new conversation either.
    assert db.added == []
