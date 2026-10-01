"""Collaboration sockets: identity from the token only, rooms only for people with access,
nothing broadcast unless it was saved."""

import asyncio

from ee.modules.collaboration import socketio_manager as S


class FakeSio:
    def __init__(self):
        self.sessions, self.emits, self.rooms = {}, [], []

    async def get_session(self, sid):
        return self.sessions.get(sid, {})

    async def save_session(self, sid, data):
        self.sessions[sid] = data

    async def enter_room(self, sid, room):
        self.rooms.append((sid, room))

    async def emit(self, event, data=None, **kw):
        self.emits.append((event, data, kw))


def _setup(monkeypatch, allowed=True, persisted=None):
    fake = FakeSio()
    monkeypatch.setattr(S, "sio", fake)
    S.active_rooms.clear(); S.sid_rooms.clear()
    import src.modules.dashboards.collaboration_chart_service as C

    async def can_join(user, dash):
        return allowed

    async def persist(*a, **k):
        return persisted

    monkeypatch.setattr(C, "can_join_dashboard", can_join)
    monkeypatch.setattr(C, "persist_widget_update", persist)
    fake.sessions["s1"] = {"user": {"user_id": "me", "username": "Me"}}
    return fake


def test_client_cannot_change_who_it_is(monkeypatch):
    fake = _setup(monkeypatch)
    asyncio.run(S.join_dashboard.__wrapped__("s1", {"dashboard_id": "d1", "user": {"user_id": "admin", "name": "Me too"}})
                if hasattr(S.join_dashboard, "__wrapped__") else S.join_dashboard("s1", {"dashboard_id": "d1", "user": {"user_id": "admin", "name": "Me too"}}))
    user = fake.sessions["s1"]["user"]
    assert user["user_id"] == "me" and user["name"] == "Me too"


def test_no_room_without_access(monkeypatch):
    fake = _setup(monkeypatch, allowed=False)
    asyncio.run(S.join_dashboard("s1", {"dashboard_id": "d1"}))
    assert fake.rooms == [] and fake.emits[0][0] == "collab:denied"


def test_events_need_the_room_and_a_successful_save(monkeypatch):
    fake = _setup(monkeypatch, allowed=True, persisted=None)
    asyncio.run(S.update_widget("s1", {"dashboard_id": "d1", "widget_id": "w", "changes": {}}))
    assert fake.emits == []  # not joined
    asyncio.run(S.join_dashboard("s1", {"dashboard_id": "d1"}))
    fake.emits.clear()
    asyncio.run(S.update_widget("s1", {"dashboard_id": "d1", "widget_id": "w", "changes": {}}))
    assert fake.emits == []  # joined, but the save was refused
    asyncio.run(S.cursor_move("s1", {"dashboard_id": "other", "x": 1, "y": 2}))
    assert fake.emits == []  # another dashboard's room
