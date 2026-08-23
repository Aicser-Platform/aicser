"""Conversation access and user-scoped listing helpers."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from src.modules.chats.conversations.service import ConversationService


def test_conversation_visible_to_owner():
    meta = {"user_id": "user-a", "visibility": "private"}
    assert ConversationService._conversation_visible_to_user(meta, "user-a") is True
    assert ConversationService._conversation_visible_to_user(meta, "user-b") is False


def test_conversation_visible_when_shared_with_project():
    meta = {"user_id": "user-a", "visibility": "project"}
    assert ConversationService._conversation_visible_to_user(meta, "user-b") is True


def test_conversation_visible_when_in_shared_with_list():
    meta = {"user_id": "user-a", "visibility": "private", "shared_with": ["user-b", "user-c"]}
    assert ConversationService._conversation_visible_to_user(meta, "user-b") is True
    assert ConversationService._conversation_visible_to_user(meta, "user-d") is False


def test_parse_metadata_merges_preserves_owner():
    existing = {"user_id": "user-a", "created_by": "user-a", "visibility": "private", "shared_with": []}
    incoming = {"last_data_source_id": "ds-1"}
    merged = {**existing, **incoming}
    for preserve_key in ("user_id", "created_by", "visibility", "shared_with"):
        if existing.get(preserve_key) is not None and preserve_key not in incoming:
            merged[preserve_key] = existing[preserve_key]
    assert merged["user_id"] == "user-a"
    assert merged["last_data_source_id"] == "ds-1"


def test_response_builder_dashboard_success():
    from src.modules.ai.services.response_builder import build_workflow_response

    state = {
        "current_stage": "dashboard_generation_complete",
        "dashboard_created": {"dashboard_id": "dash-1", "widget_count": 4},
        "message": "Created dashboard **Sales** with 4 widgets.",
        "executive_summary": "Created dashboard **Sales** with 4 widgets.",
        "execution_metadata": {"status": "completed"},
    }
    result = build_workflow_response(state, "build a sales dashboard", "conv-1")
    assert result["success"] is True
    assert result.get("dashboard_created", {}).get("dashboard_id") == "dash-1"


def test_conversation_visibility_sql_uses_text_cast_for_user_id():
    """asyncpg may bind UUID-shaped user ids as uuid; json_metadata is TEXT in DB."""
    from src.modules.chats.conversations.service import _CONVERSATION_USER_VISIBILITY_SQL

    assert _CONVERSATION_USER_VISIBILITY_SQL.count("CAST(:user_id AS TEXT)") >= 2
    assert "json_metadata::jsonb" in _CONVERSATION_USER_VISIBILITY_SQL


def test_required_steps_subset_uses_set():
    from src.modules.onboarding.steps import REQUIRED_STEP_IDS, normalize_completed_steps

    done = normalize_completed_steps(list(REQUIRED_STEP_IDS))
    assert set(REQUIRED_STEP_IDS).issubset(done)


def _async_session_returning(project):
    """Mimics `async with async_session() as session: await session.get(...)`."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=project)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return lambda: cm


@pytest.mark.asyncio
async def test_project_access_denied_without_chat_view_permission():
    """The exact gap this closes: previously ANY role at all (viewer
    included) granted access - now it must be an actual chat:view holder."""
    project_id = uuid4()
    org_id = uuid4()
    project = SimpleNamespace(organization_id=org_id)

    with patch(
        "src.modules.chats.conversations.service.async_session",
        new=_async_session_returning(project),
    ), patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=False),
    ) as mock_check:
        result = await ConversationService._user_has_project_access(str(uuid4()), str(project_id))

    assert result is False
    mock_check.assert_awaited_once()
    args = mock_check.await_args.args
    assert args[1] == "chat:view"


@pytest.mark.asyncio
async def test_project_access_allowed_with_chat_view_permission():
    project_id = uuid4()
    project = SimpleNamespace(organization_id=uuid4())

    with patch(
        "src.modules.chats.conversations.service.async_session",
        new=_async_session_returning(project),
    ), patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ):
        result = await ConversationService._user_has_project_access(str(uuid4()), str(project_id))

    assert result is True


@pytest.mark.asyncio
async def test_project_access_false_when_project_missing():
    with patch(
        "src.modules.chats.conversations.service.async_session",
        new=_async_session_returning(None),
    ):
        result = await ConversationService._user_has_project_access(str(uuid4()), str(uuid4()))
    assert result is False


@pytest.mark.asyncio
async def test_check_project_access_router_rejects_without_permission():
    from fastapi import HTTPException

    from src.modules.chats.conversations.router import _check_project_access

    project = SimpleNamespace(organization_id=uuid4())
    with patch(
        "src.db.session.async_session",
        new=_async_session_returning(project),
    ), patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=False),
    ):
        with pytest.raises(HTTPException) as exc:
            await _check_project_access(str(uuid4()), str(uuid4()))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_check_project_access_router_allows_with_permission():
    from src.modules.chats.conversations.router import _check_project_access

    project = SimpleNamespace(organization_id=uuid4())
    with patch(
        "src.db.session.async_session",
        new=_async_session_returning(project),
    ), patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ):
        await _check_project_access(str(uuid4()), str(uuid4()))  # must not raise


def test_conversation_response_schema_coerces_jsonb_metadata():
    from uuid import uuid4
    from datetime import datetime, timezone
    from src.modules.chats.conversations.schemas import ConversationResponseSchema

    row = ConversationResponseSchema(
        id=uuid4(),
        title=None,
        project_id=str(uuid4()),
        json_metadata={"user_id": "user-a", "visibility": "private"},
        created_at=datetime.now(timezone.utc),
    )
    assert row.title == "Untitled conversation"
    assert isinstance(row.json_metadata, str)
    assert "user-a" in row.json_metadata
