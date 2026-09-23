import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import uuid
from types import SimpleNamespace

import pytest  # noqa: E402


def test_router_is_mounted_under_onboarding():
    from src.modules.pipeline.onboarding.router import router

    assert router.prefix == "/onboarding"


def test_every_documented_route_exists():
    from src.modules.pipeline.onboarding.router import router

    routes = {(route.path, tuple(sorted(route.methods))) for route in router.routes}

    assert ("/onboarding/sessions", ("POST",)) in routes
    assert ("/onboarding/sessions", ("GET",)) in routes
    assert ("/onboarding/sessions/{session_id}", ("GET",)) in routes
    assert ("/onboarding/sessions/{session_id}", ("PATCH",)) in routes
    assert ("/onboarding/sessions/{session_id}", ("DELETE",)) in routes
    assert ("/onboarding/sessions/{session_id}/ingest", ("POST",)) in routes
    assert ("/onboarding/sessions/{session_id}/reprofile", ("POST",)) in routes
    assert ("/onboarding/sessions/{session_id}/sheets", ("POST",)) in routes


def test_the_router_is_plan_gated_on_lakehouse():
    from src.modules.pipeline.onboarding.router import router

    assert router.dependencies, "onboarding must carry the lakehouse plan gate"


def test_decisions_request_rejects_an_unknown_policy():
    from pydantic import ValidationError

    from src.modules.pipeline.onboarding.schemas import DecisionsRequest

    with pytest.raises(ValidationError):
        DecisionsRequest(on_fail="explode")


def test_session_response_serialises_uuids_as_strings():
    from src.modules.pipeline.onboarding.schemas import OnboardingSessionResponse

    response = OnboardingSessionResponse(
        id=str(uuid.uuid4()), data_source_id="a1", status="review"
    )

    assert isinstance(response.id, str)
    assert response.decisions == {}


async def test_ingest_marks_the_session_in_flight_before_returning(monkeypatch):
    from src.modules.pipeline.onboarding import router as module

    session = SimpleNamespace(
        id=uuid.uuid4(),
        data_source_id="a1",
        status="review",
        decisions={},
        staging_object_id=None,
        bronze_object_id=None,
        profile_id=None,
        error_message=None,
        created_at=None,
    )
    commits = 0
    enqueued = []

    class FakeDB:
        async def commit(self):
            nonlocal commits
            commits += 1

    async def fake_get_owned(db, session_id, org_id):
        return session

    async def fake_enqueue_job(name, **kwargs):
        enqueued.append((name, kwargs))

    monkeypatch.setattr(module, "_get_owned", fake_get_owned)
    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())
    monkeypatch.setattr(module, "enqueue_job", fake_enqueue_job)

    response = await module.ingest(str(session.id), db=FakeDB(), payload={})

    assert commits == 1
    assert session.status == "ingesting"
    assert response.status == "ingesting"
    assert enqueued == [
        ("ingest_staged_asset", {"session_id": str(session.id)}),
    ]


async def test_create_commits_before_it_enqueues_profiling(monkeypatch):
    """Regression test: create_session no longer commits, so the create
    handler must commit itself before enqueueing "profile_staged_asset" --
    the ARQ worker looks the session up by id through a different DB
    connection and will not find it if the job runs first.
    """
    from src.modules.pipeline.onboarding import router as module

    session_id = uuid.uuid4()
    source = SimpleNamespace(
        id="asset-1",
        file_path="orgs/org-1/staging/asset-1/upload.csv",
        original_filename="sales.csv",
    )
    session = SimpleNamespace(
        id=session_id,
        data_source_id="asset-1",
        status="profiling",
        decisions={},
        staging_object_id=None,
        bronze_object_id=None,
        profile_id=None,
        error_message=None,
        created_at=None,
    )
    calls = []

    class FakeResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class FakeDB:
        def __init__(self):
            # First execute() is the source lookup, second is the
            # open-session conflict check.
            self._responses = [FakeResult(source), FakeResult(None)]

        async def execute(self, _statement):
            return self._responses.pop(0)

        async def commit(self):
            calls.append("commit")

    async def fake_require_source_access(db, payload, data_source_id):
        return None

    async def fake_create_session(db, **kwargs):
        calls.append("create_session")
        return session

    async def fake_enqueue_job(name, **kwargs):
        calls.append(("enqueue", name, kwargs))

    monkeypatch.setattr(module, "require_source_access", fake_require_source_access)
    monkeypatch.setattr(module, "create_session", fake_create_session)
    monkeypatch.setattr(module, "enqueue_job", fake_enqueue_job)
    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())
    monkeypatch.setattr(module, "_actor_id", lambda payload: None)

    body = SimpleNamespace(data_source_id="asset-1", filename=None)

    response = await module.create(body, db=FakeDB(), payload={})

    assert calls == [
        "create_session",
        "commit",
        ("enqueue", "profile_staged_asset", {"session_id": str(session_id)}),
    ]
    assert response.status == "profiling"


async def test_sheets_commits_before_it_enqueues_profiling_for_each_session(
    monkeypatch,
):
    """Mirrors test_create_commits_before_it_enqueues_profiling: the ARQ
    worker looks each session up through a different DB connection, so every
    returned session must be durable before any job for it is enqueued."""
    from src.modules.pipeline.onboarding import router as module

    def _row(sheet_name):
        return SimpleNamespace(
            id=uuid.uuid4(),
            data_source_id="a1",
            status="profiling",
            decisions={"sheet_name": sheet_name},
            staging_object_id=None,
            bronze_object_id=None,
            profile_id=None,
            error_message=None,
            created_at=None,
        )

    origin = _row("First")
    sibling = _row("Second")
    calls = []

    class FakeDB:
        async def commit(self):
            calls.append("commit")

    async def fake_get_owned(db, session_id, org_id):
        return origin

    async def fake_select_sheets(db, session_id, sheet_names):
        calls.append(("select_sheets", sheet_names))
        return [origin, sibling]

    async def fake_enqueue_job(name, **kwargs):
        calls.append(("enqueue", name, kwargs))

    monkeypatch.setattr(module, "_get_owned", fake_get_owned)
    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())
    monkeypatch.setattr(module, "select_sheets", fake_select_sheets)
    monkeypatch.setattr(module, "enqueue_job", fake_enqueue_job)

    body = SimpleNamespace(sheet_names=["First", "Second"])
    response = await module.sheets(str(origin.id), body, db=FakeDB(), payload={})

    assert calls == [
        ("select_sheets", ["First", "Second"]),
        "commit",
        ("enqueue", "profile_staged_asset", {"session_id": str(origin.id)}),
        ("enqueue", "profile_staged_asset", {"session_id": str(sibling.id)}),
    ]
    assert len(response) == 2


async def test_sheets_maps_an_unknown_sheet_to_a_409(monkeypatch):
    from fastapi import HTTPException

    from src.modules.pipeline.onboarding import router as module

    origin = SimpleNamespace(id=uuid.uuid4())

    async def fake_get_owned(db, session_id, org_id):
        return origin

    async def fake_select_sheets(db, session_id, sheet_names):
        raise ValueError("unknown sheet(s): ['Ghost']")

    monkeypatch.setattr(module, "_get_owned", fake_get_owned)
    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())
    monkeypatch.setattr(module, "select_sheets", fake_select_sheets)

    body = SimpleNamespace(sheet_names=["Ghost"])
    with pytest.raises(HTTPException) as exc_info:
        await module.sheets(str(origin.id), body, db=object(), payload={})

    assert exc_info.value.status_code == 409


def test_the_preview_route_exists():
    from src.modules.pipeline.onboarding.router import router

    routes = {(r.path, tuple(sorted(r.methods))) for r in router.routes}

    assert ("/onboarding/sessions/{session_id}/preview", ("GET",)) in routes
