"""Workbook history keeps one point per person per session, never for an unchanged document."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from src.modules.workbooks import router as R

ME = str(uuid.uuid4())


class FakeDB:
    def __init__(self):
        self.points = []

    async def execute(self, stmt):
        if stmt.is_select:
            last = max(self.points, key=lambda p: p.updated_at) if self.points else None
            return SimpleNamespace(scalar_one_or_none=lambda: last)
        return None

    def add(self, obj):
        self.points.append(obj)

    async def flush(self):
        pass


@pytest.mark.asyncio
async def test_sessions_and_unchanged_documents():
    db = FakeDB()
    wb = SimpleNamespace(id=uuid.uuid4(), title="Plan", version=1, doc=b"v1", ranges=[])
    await R._snapshot(db, wb, ME, reason="created")
    wb.doc = b"v2"
    await R._snapshot(db, wb, ME)
    wb.doc = b"v3"
    await R._snapshot(db, wb, ME)
    await R._snapshot(db, wb, ME)  # nothing changed
    assert [p.reason for p in db.points] == ["created", "save"] and db.points[1].doc == b"v3"
    db.points[-1].updated_at = datetime.now(timezone.utc) - R.SESSION_GAP - timedelta(seconds=1)
    wb.doc = b"v4"
    await R._snapshot(db, wb, ME)
    assert len(db.points) == 3
