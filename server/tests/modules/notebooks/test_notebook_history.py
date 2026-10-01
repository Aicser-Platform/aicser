"""Notebook history: one point per person per working session, the starting point kept on its
own, output-only changes not recorded, restores always recorded."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from src.modules.notebooks import router as R

ME, OTHER = str(uuid.uuid4()), str(uuid.uuid4())


class FakeDB:
    def __init__(self):
        self.points = []

    async def execute(self, stmt):
        if stmt.is_select:
            last = max(self.points, key=lambda p: p.updated_at) if self.points else None
            return SimpleNamespace(scalar_one_or_none=lambda: last)
        return None  # pruning

    def add(self, obj):
        self.points.append(obj)

    async def flush(self):
        pass


def nb(source, title="T", version=1):
    return SimpleNamespace(id=uuid.uuid4(), title=title, version=version,
                           cells=[{"id": "a", "type": "python", "source": source, "output": {"kind": "text", "text": "1"}}])


@pytest.mark.asyncio
async def test_a_session_of_saves_is_one_point_and_the_start_stays_separate():
    db, n = FakeDB(), nb("x = 1")
    await R._snapshot(db, n, ME, reason="created")
    for src in ("x = 2", "x = 3"):
        n.cells[0]["source"] = src
        await R._snapshot(db, n, ME)
    assert [p.reason for p in db.points] == ["created", "save"]
    assert db.points[0].cells[0]["source"] == "x = 1" and db.points[1].cells[0]["source"] == "x = 3"
    assert "output" not in db.points[1].cells[0]  # history keeps code, not results


@pytest.mark.asyncio
async def test_new_point_after_a_break_or_by_someone_else_and_none_for_output_only_changes():
    db, n = FakeDB(), nb("x = 1")
    await R._snapshot(db, n, ME)
    db.points[-1].updated_at = datetime.now(timezone.utc) - R.SESSION_GAP - timedelta(minutes=1)
    n.cells[0]["source"] = "x = 2"
    await R._snapshot(db, n, ME)
    n.cells[0]["source"] = "x = 3"
    await R._snapshot(db, n, OTHER)
    n.cells[0]["output"] = {"kind": "text", "text": "changed"}
    await R._snapshot(db, n, OTHER)
    assert len(db.points) == 3


@pytest.mark.asyncio
async def test_restores_are_always_their_own_point():
    db, n = FakeDB(), nb("x = 1")
    await R._snapshot(db, n, ME)
    n.cells[0]["source"] = "x = 0"
    await R._snapshot(db, n, ME, reason="restore")
    n.cells[0]["source"] = "x = 5"
    await R._snapshot(db, n, ME)
    assert [p.reason for p in db.points] == ["save", "restore", "save"]
