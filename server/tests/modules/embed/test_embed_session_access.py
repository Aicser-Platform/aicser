"""Tests for the session-authenticated assistant access check
(server/ee/modules/embed/session_access.py).

Context: EmbedAssistant.visibility (private/shared/public) governs the
SESSION-authenticated path -- GET /api/embed/assistants/{id}
(assistant_router.py) -- completely separately from auth_mode, which governs
the token-based external embed-chat surface (chat_auth.py, untouched here).
These tests lock in all three visibility levels plus the two access-control
bugs this feature specifically had to get right:
  1. An expired/inactive/soft-deleted EmbedAssistantShare row must not grant
     access (session_access._is_share_row_live).
  2. Project-based sharing must use an EXPLICIT per-project UserRole check
     (session_access._has_explicit_project_role), not the looser pattern in
     ProjectService.get_user_projects (which treats ANY org-level role as
     implying access to every project in the org -- a real bug found while
     building this feature, see ProjectService.list_organization_projects
     for the correct pattern this mirrors instead).

Uses the same fake in-memory async-session pattern as
test_embed_chat_conversation.py -- no real DB required. Each helper in
session_access.py opens its own `async with async_session() as session`
block and calls `session.execute(...)` once; _FakeSessionFactory hands out
one canned result per call, in the order the code under test will ask for
them.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, List

import pytest

from ee.modules.embed import session_access
from ee.modules.embed.models import EmbedAssistant, EmbedAssistantShare


def _assistant(**overrides) -> EmbedAssistant:
    defaults = dict(
        id=uuid.uuid4(),
        name="Support Bot",
        organization_id=uuid.uuid4(),
        project_id=None,
        created_by=uuid.uuid4(),
        is_active=True,
        is_deleted=False,
        visibility="private",
    )
    defaults.update(overrides)
    return EmbedAssistant(**defaults)


def _share(**overrides) -> EmbedAssistantShare:
    defaults = dict(
        id=uuid.uuid4(),
        assistant_id=uuid.uuid4(),
        shared_by=uuid.uuid4(),
        shared_with=None,
        project_id=None,
        organization_id=uuid.uuid4(),
        permission="use",
        expires_at=None,
        is_active=True,
        is_deleted=False,
    )
    defaults.update(overrides)
    return EmbedAssistantShare(**defaults)


class _FakeScalars:
    def __init__(self, items: List[Any]):
        self._items = items

    def all(self):
        return self._items


class _FakeResult:
    def __init__(self, items: List[Any]):
        self._items = items

    def scalars(self):
        return _FakeScalars(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class _FakeDB:
    def __init__(self, queue: List[_FakeResult]):
        self._queue = queue

    async def execute(self, _stmt):
        if not self._queue:
            raise AssertionError("session_access made more DB queries than the test expected")
        return self._queue.pop(0)


class _FakeSessionCtx:
    def __init__(self, db: _FakeDB):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeSessionFactory:
    """Each call to async_session() pops the next queued result set and hands
    out a fresh fake session backed by it -- matches session_access.py's
    `async with async_session() as session:` per-helper-call usage."""

    def __init__(self, result_sets: List[List[Any]]):
        self._result_sets = list(result_sets)

    def __call__(self):
        if not self._result_sets:
            raise AssertionError("session_access opened more sessions than the test expected")
        return _FakeSessionCtx(_FakeDB([_FakeResult(self._result_sets.pop(0))]))


def _patch_session(monkeypatch, *result_sets: List[Any]) -> None:
    monkeypatch.setattr(session_access, "async_session", _FakeSessionFactory(list(result_sets)))


# ── public visibility ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_public_visibility_allows_any_org_member(monkeypatch):
    user_id = str(uuid.uuid4())
    assistant = _assistant(visibility="public")
    # One query: _is_organization_member -- a matching UserRole row exists.
    _patch_session(monkeypatch, [uuid.uuid4()])

    assert await session_access.can_access_assistant_via_session(user_id, assistant) is True


@pytest.mark.asyncio
async def test_public_visibility_denies_non_member(monkeypatch):
    user_id = str(uuid.uuid4())
    assistant = _assistant(visibility="public")
    _patch_session(monkeypatch, [])  # no UserRole row for this org

    assert await session_access.can_access_assistant_via_session(user_id, assistant) is False


# ── shared visibility ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_shared_visibility_allows_direct_share(monkeypatch):
    user_id = uuid.uuid4()
    assistant = _assistant(visibility="shared")
    share = _share(assistant_id=assistant.id, shared_with=user_id)
    # One query: _has_active_share fetches all shares for this assistant.
    _patch_session(monkeypatch, [share])

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is True


@pytest.mark.asyncio
async def test_shared_visibility_denies_unrelated_user(monkeypatch):
    assistant = _assistant(visibility="shared")
    share = _share(assistant_id=assistant.id, shared_with=uuid.uuid4())
    _patch_session(monkeypatch, [share])

    assert await session_access.can_access_assistant_via_session(str(uuid.uuid4()), assistant) is False


@pytest.mark.asyncio
async def test_shared_visibility_rejects_expired_share(monkeypatch):
    """An expired EmbedAssistantShare must not grant access even though it
    directly names this user."""
    user_id = uuid.uuid4()
    assistant = _assistant(visibility="shared")
    expired_share = _share(
        assistant_id=assistant.id,
        shared_with=user_id,
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    _patch_session(monkeypatch, [expired_share])

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is False


@pytest.mark.asyncio
async def test_shared_visibility_rejects_inactive_share(monkeypatch):
    user_id = uuid.uuid4()
    assistant = _assistant(visibility="shared")
    inactive_share = _share(assistant_id=assistant.id, shared_with=user_id, is_active=False)
    _patch_session(monkeypatch, [inactive_share])

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is False


@pytest.mark.asyncio
async def test_shared_visibility_rejects_soft_deleted_share(monkeypatch):
    user_id = uuid.uuid4()
    assistant = _assistant(visibility="shared")
    deleted_share = _share(assistant_id=assistant.id, shared_with=user_id, is_deleted=True)
    _patch_session(monkeypatch, [deleted_share])

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is False


@pytest.mark.asyncio
async def test_shared_visibility_allows_future_expiry(monkeypatch):
    user_id = uuid.uuid4()
    assistant = _assistant(visibility="shared")
    live_share = _share(
        assistant_id=assistant.id,
        shared_with=user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    _patch_session(monkeypatch, [live_share])

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is True


@pytest.mark.asyncio
async def test_shared_visibility_project_share_uses_explicit_project_role(monkeypatch):
    """A project-scoped share must grant access when the user holds an
    EXPLICIT per-project UserRole -- the correct pattern from
    ProjectService.list_organization_projects, not the bug in
    ProjectService.get_user_projects (any org-level role implies every
    project)."""
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    assistant = _assistant(visibility="shared")
    project_share = _share(assistant_id=assistant.id, shared_with=None, project_id=project_id)
    # First query: _has_active_share's fetch. Second query: the explicit
    # per-project UserRole lookup for this user/project -- a row exists.
    _patch_session(monkeypatch, [project_share], [uuid.uuid4()])

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is True


@pytest.mark.asyncio
async def test_shared_visibility_project_share_denies_user_without_explicit_role(monkeypatch):
    """Same project share, but the user has NO explicit UserRole row for
    that project (e.g. they only hold an unrelated org-level role) -- must
    be denied, which is exactly the bug get_user_projects has and
    list_organization_projects doesn't."""
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    assistant = _assistant(visibility="shared")
    project_share = _share(assistant_id=assistant.id, shared_with=None, project_id=project_id)
    _patch_session(monkeypatch, [project_share], [])  # no explicit UserRole row

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is False


# ── private visibility (default) ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_private_visibility_allows_creator(monkeypatch):
    user_id = uuid.uuid4()
    assistant = _assistant(visibility="private", created_by=user_id)
    # No DB query should be needed at all -- creator check short-circuits
    # before _can_manage's RBAC lookup.
    _patch_session(monkeypatch)

    assert await session_access.can_access_assistant_via_session(str(user_id), assistant) is True


@pytest.mark.asyncio
async def test_private_visibility_denies_unrelated_user_without_manage_rights(monkeypatch):
    assistant = _assistant(visibility="private", created_by=uuid.uuid4())

    async def _cannot_manage(*_a, **_k):
        return False

    monkeypatch.setattr(session_access.EmbedAssistantService, "_can_manage", _cannot_manage)

    assert await session_access.can_access_assistant_via_session(str(uuid.uuid4()), assistant) is False


@pytest.mark.asyncio
async def test_private_visibility_allows_manager_reuses_can_manage(monkeypatch):
    """Non-creator but can manage (embed:manage/embed:create permission) --
    reuses EmbedAssistantService._can_manage directly, per spec."""
    assistant = _assistant(visibility="private", created_by=uuid.uuid4())

    async def _can_manage(*_a, **_k):
        return True

    monkeypatch.setattr(session_access.EmbedAssistantService, "_can_manage", _can_manage)

    assert await session_access.can_access_assistant_via_session(str(uuid.uuid4()), assistant) is True


@pytest.mark.asyncio
async def test_unrecognized_visibility_value_fails_closed_to_private_rules(monkeypatch):
    assistant = _assistant(visibility="something-unexpected", created_by=uuid.uuid4())

    async def _cannot_manage(*_a, **_k):
        return False

    monkeypatch.setattr(session_access.EmbedAssistantService, "_can_manage", _cannot_manage)

    assert await session_access.can_access_assistant_via_session(str(uuid.uuid4()), assistant) is False


# ── universal gates ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_deleted_assistant_never_accessible(monkeypatch):
    assistant = _assistant(visibility="public", is_deleted=True)
    assert await session_access.can_access_assistant_via_session(str(uuid.uuid4()), assistant) is False


@pytest.mark.asyncio
async def test_inactive_assistant_never_accessible(monkeypatch):
    assistant = _assistant(visibility="public", is_active=False)
    assert await session_access.can_access_assistant_via_session(str(uuid.uuid4()), assistant) is False
