"""Notebook comments follow the dashboard rules: replies join one thread and reopen it, only the
author edits, the author or the owner deletes, deletes keep replies' context."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.modules.notebooks import comments as C

OWNER, ANA, BO = (str(uuid.uuid4()) for _ in range(3))


class FakeDB:
    def __init__(self):
        self.rows = {}

    async def get(self, model, key):
        return self.rows.get(key)

    def add(self, obj):
        obj.id = obj.id or uuid.uuid4()
        obj.is_deleted = bool(obj.is_deleted)
        self.rows[obj.id] = obj

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass

    async def execute(self, stmt):
        rows = sorted(self.rows.values(), key=lambda r: r.created_at or 0)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))


@pytest.fixture(autouse=True)
def _names(monkeypatch):
    async def name(db, uid):
        return {ANA: "Ana", BO: "Bo"}.get(uid, "Owner")

    from src.shared import comment_threads

    monkeypatch.setattr(comment_threads, "author_name", name)


NB = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.UUID(OWNER))


@pytest.mark.asyncio
async def test_threads_replies_resolve_and_reopen():
    db = FakeDB()
    top = await C.create(db, NB, ANA, "Why LIMIT 100?", cell_id="c1")
    assert top["widget_id"] == "c1" and top["author"]["name"] == "Ana"
    await C.set_resolved(db, NB, top["id"], BO, True)
    reply = await C.create(db, NB, BO, "Sample only", parent_id=top["id"])
    assert reply["parent_id"] == top["id"] and reply["widget_id"] == "c1"
    threads = await C.list_threads(db, NB)
    assert len(threads) == 1 and threads[0]["resolved_at"] is None and len(threads[0]["replies"]) == 1


@pytest.mark.asyncio
async def test_only_author_edits_and_owner_may_delete():
    db = FakeDB()
    c = await C.create(db, NB, ANA, "note")
    with pytest.raises(HTTPException) as e:
        await C.edit(db, NB, c["id"], BO, "hijack")
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        await C.delete(db, NB, c["id"], BO)
    await C.create(db, NB, BO, "reply", parent_id=c["id"])
    assert (await C.delete(db, NB, c["id"], OWNER))["deleted"] is True
    threads = await C.list_threads(db, NB)
    assert threads[0]["deleted"] and threads[0]["body"] == "" and len(threads[0]["replies"]) == 1
