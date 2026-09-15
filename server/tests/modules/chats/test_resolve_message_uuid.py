"""_resolve_message_uuid (formerly _resolve_feedback_message_uuid) is the
shared fallback used by every per-message action keyed on the chat UI's
message id: the id shown in the message list can be a client-generated
placeholder until the turn is fully saved server-side, so path-id lookups
must fall back to matching by trace_id (stored in
ai_metadata.execution_metadata per turn) instead of failing outright.

rerun-sql was recently wired onto this same resolver (previously it did a
raw `WHERE id = :mid` match with no fallback at all, so editing SQL on a
message whose id hadn't been resolved to a real UUID yet always failed with
"Message not found")."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from ee.modules.chats.conversations.service import ConversationService


@pytest.mark.asyncio
async def test_resolves_real_uuid_without_querying_db():
    svc = ConversationService()
    session = MagicMock()
    session.execute = AsyncMock()
    real_id = uuid.uuid4()

    resolved = await svc._resolve_message_uuid(session, str(uuid.uuid4()), str(real_id), None)

    assert resolved == real_id
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_raises_when_id_not_uuid_and_no_trace_id():
    svc = ConversationService()
    session = MagicMock()
    session.execute = AsyncMock()

    with pytest.raises(ValueError, match="not linked to the server"):
        await svc._resolve_message_uuid(session, str(uuid.uuid4()), "client-abc123", None)

    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolves_via_trace_id_when_path_id_is_not_a_uuid():
    svc = ConversationService()
    found_id = uuid.uuid4()
    result = MagicMock()
    result.fetchone.return_value = (found_id,)
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)

    resolved = await svc._resolve_message_uuid(
        session, str(uuid.uuid4()), "client-abc123", "trace-xyz"
    )

    assert resolved == found_id
    session.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_raises_when_trace_id_matches_nothing():
    svc = ConversationService()
    result = MagicMock()
    result.fetchone.return_value = None
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)

    with pytest.raises(ValueError, match="Could not find this AI response"):
        await svc._resolve_message_uuid(session, str(uuid.uuid4()), "client-abc123", "trace-xyz")
