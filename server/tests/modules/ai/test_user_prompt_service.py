"""Prompt Library CRUD (user_prompts table)."""
import uuid

import pytest
from fastapi import HTTPException

# user_prompts.organization_id has a real FK to organizations.id. SQLAlchemy
# resolves every FK target across the whole unit-of-work on any insert into
# a mapped table (even when this column is None on this particular row), so
# the Organization model must be registered in Base's metadata before this
# module's tests run -- harmless when something else in the suite already
# imported it, required when this file runs in isolation.
import ee.modules.organizations.models  # noqa: F401

from ee.modules.ai.services.user_prompt_service import UserPromptService


@pytest.mark.asyncio
async def test_create_list_update_delete_and_ownership_roundtrip():
    # This suite's convention for `async_session()`-using code is to mock the
    # session entirely (see tests/modules/chats/test_conversation_access.py);
    # this test deliberately hits the real DB instead, for genuine end-to-end
    # confidence in the ORM create/list/update/delete/ownership-check logic.
    # That means it's first to exercise a real async_session commit anywhere
    # in tests/modules/ai/, which surfaces a known pytest-asyncio + asyncpg
    # interaction: the process-wide connection pool's connections are bound
    # to whatever event loop first opened them, and asyncio_default_fixture_
    # loop_scope="function" gives every test function its own loop, so a
    # pooled connection from an earlier test's loop breaks here. Disposing
    # the pool first forces fresh, current-loop connections.
    from src.db.session import async_engine
    await async_engine.dispose()

    owner = str(uuid.uuid4())
    other = str(uuid.uuid4())
    row = await UserPromptService.create(
        owner, None, "My Custom Prompt",
        "Analyze [metric] trends for [region].", "test desc", "data", False,
    )

    prompts = await UserPromptService.list_for_user(owner, None)
    assert len(prompts) == 1
    assert prompts[0]["title"] == "My Custom Prompt"
    assert prompts[0]["is_mine"] is True

    updated = await UserPromptService.update(owner, str(row.id), title="Updated Title")
    assert updated.title == "Updated Title"

    with pytest.raises(HTTPException) as exc:
        await UserPromptService.update(other, str(row.id), title="Hijacked")
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc2:
        await UserPromptService.delete(other, str(row.id))
    assert exc2.value.status_code == 403

    await UserPromptService.delete(owner, str(row.id))
    prompts_after = await UserPromptService.list_for_user(owner, None)
    assert prompts_after == []


@pytest.mark.asyncio
async def test_rejects_empty_title_and_text():
    user_id = str(uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        await UserPromptService.create(user_id, None, "", "some text")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc2:
        await UserPromptService.create(user_id, None, "Title", "")
    assert exc2.value.status_code == 400


@pytest.mark.asyncio
async def test_rejects_invalid_tag():
    user_id = str(uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        await UserPromptService.create(user_id, None, "Title", "text", tag="not-a-real-tag")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_sharing_requires_organization():
    user_id = str(uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        await UserPromptService.create(user_id, None, "Title", "text", is_shared=True)
    assert exc.value.status_code == 400
