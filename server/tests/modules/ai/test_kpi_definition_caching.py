"""KPI definitions (org-scoped, change rarely) were re-queried from Postgres
on every single conversational/NL2SQL turn - a real, avoidable cost at
multi-tenant scale. Confirms the raw per-org fetch is now cached, and that
saving/deleting a definition invalidates the cache immediately rather than
serving stale data for the TTL window."""

import pytest

from ee.modules.ai.services import kpi_memory_service


class _FakeCache:
    def __init__(self):
        self.store: dict = {}

    def get(self, key, default=None):
        return self.store.get(key, default)

    def set(self, key, value, ttl=None):
        if value is None:
            self.store.pop(key, None)
        else:
            self.store[key] = value
        return True


class _FakeSession:
    """Counts how many times the raw SQL fetch actually runs."""

    def __init__(self, rows):
        self._rows = rows
        self.execute_count = 0

    async def execute(self, *args, **kwargs):
        self.execute_count += 1

        class _Result:
            def __init__(self, rows):
                self._rows = rows

            def fetchall(self):
                return self._rows

        return _Result(self._rows)


@pytest.mark.asyncio
async def test_raw_fetch_is_cached_across_calls(monkeypatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr("src.core.cache.cache", fake_cache)

    session = _FakeSession([("mrr", "MRR", "recurring revenue", "SUM(amount)", [], [], 3)])

    first = await kpi_memory_service._fetch_raw_org_definitions(session, "org-1")
    second = await kpi_memory_service._fetch_raw_org_definitions(session, "org-1")

    assert first == second
    assert session.execute_count == 1, "second call should hit the cache, not Postgres again"


@pytest.mark.asyncio
async def test_different_orgs_do_not_share_a_cache_entry(monkeypatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr("src.core.cache.cache", fake_cache)

    session_a = _FakeSession([("mrr", "MRR", "", "SUM(amount)", [], [], 1)])
    session_b = _FakeSession([("churn", "Churn", "", "COUNT(*)", [], [], 1)])

    result_a = await kpi_memory_service._fetch_raw_org_definitions(session_a, "org-a")
    result_b = await kpi_memory_service._fetch_raw_org_definitions(session_b, "org-b")

    assert result_a[0]["kpi_slug"] == "mrr"
    assert result_b[0]["kpi_slug"] == "churn"
    assert session_a.execute_count == 1
    assert session_b.execute_count == 1


def test_invalidate_clears_cached_entry(monkeypatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr("src.core.cache.cache", fake_cache)
    fake_cache.set("kpi_defs:org-1", [{"kpi_slug": "mrr"}], ttl=600)

    kpi_memory_service.invalidate_org_kpi_cache("org-1")

    assert fake_cache.get("kpi_defs:org-1") is None


@pytest.mark.asyncio
async def test_save_kpi_definition_invalidates_cache(monkeypatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr("src.core.cache.cache", fake_cache)
    fake_cache.set("kpi_defs:org-1", [{"kpi_slug": "stale"}], ttl=600)

    async def fake_upsert(*args, **kwargs):
        return True

    monkeypatch.setattr(kpi_memory_service, "_upsert_definition", fake_upsert)

    class _FakeSession2:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(
        "src.db.session.async_session", lambda: _FakeSession2()
    )

    ok = await kpi_memory_service.save_kpi_definition(
        organization_id="org-1",
        kpi_slug="mrr",
        kpi_name="MRR",
        sql_expression="SUM(amount)",
        trigger_keywords=["mrr"],
    )
    assert ok is True
    assert fake_cache.get("kpi_defs:org-1") is None
