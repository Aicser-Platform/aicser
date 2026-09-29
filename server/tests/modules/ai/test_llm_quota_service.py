"""AI concurrency: per-org and per-user caps, short queueing instead of instant failure,
atomic counters, and health probes that never consume tenant slots."""

import asyncio

import pytest

from ee.modules.ai.services import llm_quota_service as q


class _MemCache:
    def __init__(self):
        self.d = {}

    def increment(self, key, amount=1):
        self.d[key] = self.d.get(key, 0) + amount
        return self.d[key]

    def expire(self, key, ttl):
        return True

    def delete(self, key):
        self.d.pop(key, None)
        return True

    def get(self, key, default=None):
        return self.d.get(key, default)


@pytest.fixture()
def mem(monkeypatch):
    import src.core.cache as cache_mod

    c = _MemCache()
    monkeypatch.setattr(cache_mod, "cache", c)
    monkeypatch.setattr(q, "_DEFAULT_ORG_CONCURRENCY", 3)
    monkeypatch.setattr(q, "_DEFAULT_USER_CONCURRENCY", 2)
    return c


@pytest.mark.asyncio
async def test_user_cap_protects_colleagues(mem):
    assert (await q.acquire_org_llm_slot("org", "alice", wait_s=0))[0]
    assert (await q.acquire_org_llm_slot("org", "alice", wait_s=0))[0]
    ok, reason = await q.acquire_org_llm_slot("org", "alice", wait_s=0)
    assert not ok and "user" in reason
    # Alice being capped leaves room for Bob, and the failed attempt didn't leak an org slot.
    assert (await q.acquire_org_llm_slot("org", "bob", wait_s=0))[0]
    assert mem.d["llm_org_slots:org"] == 3


@pytest.mark.asyncio
async def test_waits_for_a_slot_instead_of_failing(mem):
    for u in ("a", "b", "c"):
        assert (await q.acquire_org_llm_slot("org", u, wait_s=0))[0]

    async def free_later():
        await asyncio.sleep(0.2)
        await q.release_org_llm_slot("org", "a")

    asyncio.create_task(free_later())
    ok, _ = await q.acquire_org_llm_slot("org", "d", wait_s=2)
    assert ok


@pytest.mark.asyncio
async def test_org_full_reports_org_limit(mem):
    for u in ("a", "b", "c"):
        await q.acquire_org_llm_slot("org", u, wait_s=0)
    ok, reason = await q.acquire_org_llm_slot("org", "d", wait_s=0)
    assert not ok and "Organization" in reason


@pytest.mark.asyncio
async def test_health_probes_are_exempt(mem):
    for u in ("a", "b", "c"):
        await q.acquire_org_llm_slot("org", u, wait_s=0)
    with q.quota_exempt():
        assert (await q.acquire_org_llm_slot("org", "probe", wait_s=0))[0]
        await q.release_org_llm_slot("org", "probe")
    assert mem.d["llm_org_slots:org"] == 3


@pytest.mark.asyncio
async def test_release_frees_both_counters(mem):
    await q.acquire_org_llm_slot("org", "a", wait_s=0)
    await q.release_org_llm_slot("org", "a")
    assert "llm_org_slots:org" not in mem.d and "llm_user_slots:a" not in mem.d


@pytest.mark.asyncio
async def test_background_work_keeps_headroom_for_people(mem, monkeypatch):
    from src.core.work_priority import background_work

    monkeypatch.setattr(q, "_DEFAULT_ORG_CONCURRENCY", 4)
    monkeypatch.setattr(q, "_DEFAULT_USER_CONCURRENCY", 4)
    monkeypatch.setattr(q, "_BACKGROUND_SHARE", 0.5)
    with background_work():
        assert (await q.acquire_org_llm_slot("o", None, wait_s=0))[0]
        assert (await q.acquire_org_llm_slot("o", None, wait_s=0))[0]
        ok, reason = await q.acquire_org_llm_slot("o", None, wait_s=0)
        assert not ok and "share" in reason  # background capped at half the org's slots
    # Interactive users still get the remaining half.
    assert (await q.acquire_org_llm_slot("o", "u1", wait_s=0))[0]
    assert (await q.acquire_org_llm_slot("o", "u2", wait_s=0))[0]
    with background_work():
        await q.release_org_llm_slot("o", None)
        assert (await q.acquire_org_llm_slot("o", None, wait_s=0))[0]  # freed slot is reusable
        ok, reason = await q.acquire_org_llm_slot("o", None, wait_s=0)
        assert not ok  # share and org are both full again
