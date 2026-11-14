"""Docs and Slides sharing: approval rules, who may open what, links, phone remote, and route order."""

import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.modules.office_files import remote as RM
from src.modules.office_files import sharing as S

ME, ADMIN, OTHER = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
ORG = str(uuid.uuid4())


@pytest.fixture
def org(monkeypatch):
    """An organization with one admin (ADMIN), where each person goes by one id."""
    state = {"rules": {}, "outside": True}

    async def ids(_db, user_id):
        return {str(user_id)}

    async def approvers(_db, _org):
        return [uuid.UUID(ADMIN)]

    async def get_policy(_db, _org):
        return state["rules"]

    async def require_outside(_db, _org):
        if not state["outside"]:
            raise HTTPException(status_code=403, detail="off")

    monkeypatch.setattr(S, "user_ids", ids)
    monkeypatch.setattr(S.policy, "approvers", approvers)
    monkeypatch.setattr(S.policy, "get_policy", get_policy)
    monkeypatch.setattr(S.policy, "require_outside_sharing", require_outside)
    return state


@pytest.mark.asyncio
async def test_members_wait_for_approval_and_admins_share_at_once(org):
    assert await S.starting_status(None, ORG, ME, public=False) == "pending"
    assert await S.starting_status(None, ORG, ADMIN, public=False) == "active"
    assert await S.starting_status(None, None, ME, public=False) == "active"  # Community: no organization


@pytest.mark.asyncio
async def test_a_second_approver_rule_makes_admins_wait_too(org, monkeypatch):
    org["rules"] = {"second_approver": True}

    async def two(_db, _org):
        return [uuid.UUID(ADMIN), uuid.UUID(OTHER)]

    monkeypatch.setattr(S.policy, "approvers", two)
    assert await S.starting_status(None, ORG, ADMIN, public=False) == "pending"


@pytest.mark.asyncio
async def test_public_links_need_outside_sharing(org):
    org["outside"] = False
    with pytest.raises(HTTPException):
        await S.starting_status(None, ORG, ADMIN, public=True)
    assert await S.starting_status(None, ORG, ADMIN, public=False) == "active"


@pytest.mark.asyncio
async def test_approving_needs_an_admin_and_a_waiting_share(org, monkeypatch):
    async def quiet(*_a, **_k):
        return None

    monkeypatch.setattr(S.policy, "notify_people", quiet)
    monkeypatch.setattr(S.policy, "audit", quiet)

    async def row_id(_db, user_id):
        return uuid.UUID(str(user_id))

    monkeypatch.setattr(S, "users_row_id", row_id)

    class DB:
        async def commit(self):
            pass

    share = SimpleNamespace(status="pending", organization_id=uuid.UUID(ORG), requested_by=uuid.UUID(ME),
                            target="person", role="edit", person_id=uuid.UUID(OTHER), link_access=None,
                            id=uuid.uuid4(), decided_by=None, decided_at=None, note=None)
    f = SimpleNamespace(id=uuid.uuid4(), kind="document", title="Plan")
    with pytest.raises(HTTPException) as err:
        await S.decide(DB(), share, f, ME, approved=True)
    assert err.value.status_code == 403 and share.status == "pending"
    await S.decide(DB(), share, f, ADMIN, approved=True)
    assert share.status == "active" and share.decided_by == uuid.UUID(ADMIN)
    with pytest.raises(HTTPException) as err:
        await S.decide(DB(), share, f, ADMIN, approved=False)
    assert err.value.status_code == 409


@pytest.mark.asyncio
async def test_roles_come_from_ownership_or_active_person_shares():
    f = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.UUID(ME))

    class DB:
        def __init__(self, roles):
            self.roles = roles

        async def execute(self, _stmt):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.roles))

    assert await S.my_role(DB([]), f, {ME}) == "owner"
    assert await S.my_role(DB(["view", "edit"]), f, {OTHER}) == "edit"
    assert await S.my_role(DB(["view"]), f, {OTHER}) == "view"
    assert await S.my_role(DB([]), f, {OTHER}) is None


def test_slugs_and_remote_tokens_are_unguessable():
    assert len({S.new_slug() for _ in range(200)}) == 200 and len(S.new_slug()) == 12
    assert RM.token_hash("abc") != "abc" and len(RM.token_hash("abc")) == 64


@pytest.mark.asyncio
async def test_the_phone_queues_presses_and_shows_only_the_slide():
    class DB:
        async def commit(self):
            pass

    session = SimpleNamespace(seq=0, commands=[], phone_seen_at=None, expires_at=S.now() + timedelta(hours=1),
                              state={"index": 2, "total": 5, "title": "Q3", "notes": "Say hi", "secret": "x"})
    for _ in range(RM.KEEP_COMMANDS + 3):
        await RM.press(DB(), session, "next")
    await RM.press(DB(), session, "previous")
    assert len(session.commands) == RM.KEEP_COMMANDS and session.commands[-1] == {"seq": 24, "action": "previous"}
    assert RM.commands_after(session, 23) == [{"seq": 24, "action": "previous"}]
    assert RM.connected(session)
    view = RM.phone_view(session)
    assert view["title"] == "Q3" and view["notes"] == "Say hi" and "secret" not in view
    with pytest.raises(HTTPException):
        await RM.press(DB(), session, "delete")


def test_fixed_paths_are_matched_before_a_file_id():
    """`/people`, `/approvals`, `/links/…` and `/remote/…` must not be read as a file id."""
    from fastapi import FastAPI
    from starlette.routing import Match

    from src.modules.office_files.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/office-files")

    def endpoint(method, path):
        scope = {"type": "http", "method": method, "path": path, "root_path": "", "query_string": b"", "headers": []}
        routes = list(app.router.routes)
        while routes:
            route = routes.pop(0)
            if hasattr(route, "_match"):  # an included router (FastAPI keeps them nested)
                match, _child, inner, _ctx = route._match(scope)
                if match == Match.FULL:
                    while hasattr(inner, "_match"):  # nested again (this router includes the sharing one)
                        inner = inner._match(scope)[2]
                    return inner.endpoint.__name__
                continue
            match, _child = route.matches(scope)
            if match == Match.FULL:
                return route.endpoint.__name__
        return None

    assert endpoint("GET", "/api/office-files/people") == "list_people"
    assert endpoint("GET", "/api/office-files/approvals") == "list_approvals"
    assert endpoint("GET", "/api/office-files/remote/tok") == "phone_view"
    assert endpoint("POST", "/api/office-files/links/abc/open") == "open_link"
    assert endpoint("GET", f"/api/office-files/{uuid.uuid4()}") == "get_file"
