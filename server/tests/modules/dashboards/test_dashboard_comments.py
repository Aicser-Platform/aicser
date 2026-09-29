"""Dashboard comments: threads, who may edit/delete, resolve/reopen, live events."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from src.modules.dashboards import comments as svc
from src.modules.dashboards.models import DashboardComment

DASH = uuid.uuid4()
ALICE, BOB = str(uuid.uuid4()), str(uuid.uuid4())


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class FakeSession:
    """Just enough of AsyncSession for the service: get/add/commit/refresh/execute."""

    def __init__(self):
        self.rows = {}
        self._clock = datetime(2026, 9, 28, tzinfo=timezone.utc)

    async def get(self, model, key):
        return self.rows.get(key) if model is DashboardComment else None

    def add(self, obj):
        if obj.id is None:
            obj.id = uuid.uuid4()
        if obj.is_deleted is None:
            obj.is_deleted = False
        self._clock += timedelta(seconds=1)
        obj.created_at = self._clock
        self.rows[obj.id] = obj

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass

    async def execute(self, _query):
        return _Result(sorted(self.rows.values(), key=lambda c: c.created_at))


@pytest.fixture
def db(monkeypatch):
    async def allow(_db, user_id, _dashboard_id, permission="dashboard:view"):
        if permission == "dashboard:edit" and user_id != ALICE:  # Alice edits, Bob only views
            raise HTTPException(status_code=403, detail="no")

    async def name(_db, user_id):
        return "Alice" if user_id == ALICE else "Bob"

    monkeypatch.setattr(svc, "authorize", allow)
    monkeypatch.setattr(svc, "_author_name", name)
    return FakeSession()


@pytest.fixture
def events(monkeypatch):
    seen = []

    async def listener(dashboard_id, event, comment):
        seen.append((event, comment))

    monkeypatch.setattr(svc, "_listeners", [listener])
    return seen


async def test_thread_with_replies_and_live_events(db, events):
    root = await svc.create(db, DASH, ALICE, "  Revenue dips in March?  ", widget_id="widget-1")
    reply = await svc.create(db, DASH, BOB, "Seasonal — see last year", parent_id=root["id"])
    nested = await svc.create(db, DASH, ALICE, "Thanks", parent_id=reply["id"])

    assert root["body"] == "Revenue dips in March?" and root["author"]["name"] == "Alice"
    assert reply["parent_id"] == root["id"] and reply["widget_id"] == "widget-1"
    assert nested["parent_id"] == root["id"]  # a reply to a reply joins the thread
    threads = await svc.list_threads(db, DASH)
    assert len(threads) == 1 and [r["body"] for r in threads[0]["replies"]] == ["Seasonal — see last year", "Thanks"]
    assert [e for e, _ in events] == ["comment:created"] * 3


async def test_body_limits(db, events):
    with pytest.raises(HTTPException) as e:
        await svc.create(db, DASH, ALICE, "   ")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        await svc.create(db, DASH, ALICE, "x" * (svc.MAX_BODY + 1))


async def test_only_author_edits(db, events):
    c = await svc.create(db, DASH, BOB, "draft")
    with pytest.raises(HTTPException) as e:
        await svc.edit(db, DASH, c["id"], ALICE, "hijack")
    assert e.value.status_code == 403
    out = await svc.edit(db, DASH, c["id"], BOB, "final")
    assert out["body"] == "final" and out["edited_at"]


async def test_delete_by_author_or_editor_only(db, events):
    alices = await svc.create(db, DASH, ALICE, "mine")
    with pytest.raises(HTTPException) as e:
        await svc.delete(db, DASH, alices["id"], BOB)  # viewer can't delete someone else's
    assert e.value.status_code == 403
    bobs = await svc.create(db, DASH, BOB, "off-topic")
    await svc.delete(db, DASH, bobs["id"], ALICE)  # dashboard editor moderates
    await svc.delete(db, DASH, alices["id"], ALICE)
    assert await svc.list_threads(db, DASH) == []
    assert events[-1][0] == "comment:deleted"


async def test_deleted_root_with_replies_stays_as_placeholder(db, events):
    root = await svc.create(db, DASH, ALICE, "question")
    await svc.create(db, DASH, BOB, "answer", parent_id=root["id"])
    await svc.delete(db, DASH, root["id"], ALICE)
    [thread] = await svc.list_threads(db, DASH)
    assert thread["deleted"] and thread["body"] == "" and len(thread["replies"]) == 1


async def test_resolve_applies_to_thread_and_reply_reopens(db, events):
    root = await svc.create(db, DASH, ALICE, "fix the axis")
    reply = await svc.create(db, DASH, BOB, "done", parent_id=root["id"])
    out = await svc.set_resolved(db, DASH, reply["id"], BOB, True)  # resolving a reply resolves its thread
    assert out["id"] == root["id"] and out["resolved_at"] and out["resolved_by"] == BOB
    await svc.create(db, DASH, ALICE, "one more thing", parent_id=root["id"])
    [thread] = [t for t in await svc.list_threads(db, DASH) if t["id"] == root["id"]]
    assert thread["resolved_at"] is None
    assert events[-1][0] == "comment:updated" and events[-1][1]["id"] == root["id"]


async def test_comment_from_another_dashboard_is_not_found(db, events):
    c = await svc.create(db, DASH, ALICE, "here")
    with pytest.raises(HTTPException) as e:
        await svc.edit(db, uuid.uuid4(), c["id"], ALICE, "there")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        await svc.create(db, uuid.uuid4(), ALICE, "reply", parent_id=c["id"])


async def test_listener_failure_does_not_lose_comment(db, monkeypatch):
    async def broken(*_a):
        raise RuntimeError("socket down")

    monkeypatch.setattr(svc, "_listeners", [broken])
    c = await svc.create(db, DASH, ALICE, "still saved")
    assert (await svc.list_threads(db, DASH))[0]["id"] == c["id"]
