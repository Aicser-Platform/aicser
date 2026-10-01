"""The runner's call-back: only the calls a notebook makes, only with this run's key, only
while the run is running — and then as the notebook's owner."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from ee.modules.notebook_runs import service as S

SECRET = "s3cret-key-for-this-run-only"
OWNER = uuid.uuid4()


def test_allowlist():
    assert S.allowed("POST", "/data/query/execute")
    assert S.allowed("POST", f"/api/models/{uuid.uuid4()}/predict")
    assert S.allowed("GET", "/api/ai-decisions/definitions")
    assert not S.allowed("GET", "/data/query/execute")
    assert not S.allowed("DELETE", "/api/models")
    assert not S.allowed("POST", "/api/users/me")
    assert not S.allowed("POST", "/api/models/../users")
    assert not S.allowed("POST", f"/api/models/{uuid.uuid4()}/delete")


class _Session:
    def __init__(self, run):
        self.run = run

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, model, key):
        return self.run if self.run and self.run.id == key else None


def _run(**kw):
    base = dict(id=uuid.uuid4(), status="running", secret_hash=S._hash(SECRET), owner_id=OWNER,
                started_at=datetime.now(timezone.utc))
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture
def calls(monkeypatch):
    made = []

    async def as_owner(owner, method, path, body, base):
        made.append((owner, method, path))
        return SimpleNamespace(status_code=200, json=lambda: {"ok": True}, text="")

    monkeypatch.setattr(S, "as_owner", as_owner)
    return made


@pytest.mark.asyncio
async def test_calls_go_through_as_the_owner(monkeypatch, calls):
    run = _run()
    monkeypatch.setattr(S, "async_session", lambda: _Session(run))
    assert await S.proxy(str(run.id), SECRET, "POST", "/data/query/execute", "{}") == (200, {"ok": True})
    assert calls == [(str(OWNER), "POST", "/data/query/execute")]


@pytest.mark.asyncio
@pytest.mark.parametrize("run_kw, secret, method, path", [
    ({}, "wrong", "POST", "/data/query/execute"),
    ({"status": "ok"}, SECRET, "POST", "/data/query/execute"),
    ({"secret_hash": None}, SECRET, "POST", "/data/query/execute"),
    ({"started_at": datetime.now(timezone.utc) - timedelta(hours=2)}, SECRET, "POST", "/data/query/execute"),
    ({}, SECRET, "POST", "/api/users/me"),
    ({}, SECRET, "GET", "/data/sources?project_id=x"),
])
async def test_refused(monkeypatch, calls, run_kw, secret, method, path):
    run = _run(**run_kw)
    monkeypatch.setattr(S, "async_session", lambda: _Session(run))
    code, _ = await S.proxy(str(run.id), secret, method, path, None)
    assert code == 403 and calls == []
