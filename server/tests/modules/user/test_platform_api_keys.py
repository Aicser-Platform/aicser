"""Platform API keys are verifiable: only a hash is stored, the key format carries its id,
revoked or forged keys fail, and the secret is shown exactly once."""

import uuid
from datetime import datetime, timezone

import pytest

from src.modules.user import api_keys as K


class _Session:
    """Minimal async-session stand-in: equality WHERE clauses over an in-memory store."""

    def __init__(self, store):
        self.store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def add(self, row):
        row.created_at = datetime.now(timezone.utc)
        self.store[row.id] = row

    async def commit(self):
        pass

    async def refresh(self, row):
        pass

    async def execute(self, stmt):
        where = stmt.whereclause
        clauses = where.clauses if hasattr(where, "clauses") else [where]
        crit = {c.left.name: c.right.value for c in clauses}
        rows = [r for r in self.store.values() if all(getattr(r, k) == v for k, v in crit.items())]

        class _Scalars:
            def first(self):
                return rows[0] if rows else None

            def all(self):
                return rows

        class _Result:
            def scalars(self):
                return _Scalars()

        return _Result()


@pytest.fixture()
def store(monkeypatch):
    data = {}
    import src.db.session as sess

    monkeypatch.setattr(sess, "async_session", lambda: _Session(data))
    return data


@pytest.mark.asyncio
async def test_create_verify_and_revoke(store):
    uid, oid = str(uuid.uuid4()), str(uuid.uuid4())
    created = await K.create_api_key(uid, oid, "claude desktop")
    full = created["key"]
    assert full.startswith("aicser_") and K.parse_key(full)
    row = next(iter(store.values()))
    secret = K.parse_key(full)[1]
    assert secret not in row.secret_hash and len(row.secret_hash) == 64  # hash only
    ident = await K.verify_api_key(full)
    assert ident and ident.user_id == uid and ident.organization_id == oid
    assert row.last_used_at is not None
    listed = await K.list_api_keys(uid)
    assert listed[0]["key"] != full and listed[0]["status"] == "active"  # secret never listed again
    assert await K.revoke_api_key(uid, created["id"])
    assert await K.verify_api_key(full) is None


@pytest.mark.asyncio
async def test_forged_and_malformed_keys_fail(store):
    created = await K.create_api_key(str(uuid.uuid4()), None, "k")
    key_hex = K.parse_key(created["key"])[0]
    assert await K.verify_api_key(f"aicser_{key_hex}_{'x' * 43}") is None
    assert await K.verify_api_key("aicser_nothex_abc") is None
    assert await K.verify_api_key("") is None


@pytest.mark.asyncio
async def test_cannot_revoke_someone_elses_key(store):
    created = await K.create_api_key(str(uuid.uuid4()), None, "k")
    assert await K.revoke_api_key(str(uuid.uuid4()), created["id"]) is False
