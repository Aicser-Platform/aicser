"""Regression tests for the horizontal-scale-out singleton-lease guard.

Covers the bug this replaced: SERVER_WORKERS > 1 meant every uvicorn worker
process ran lifespan's perpetual startup tasks (Telegram bot polling, trial
jobs, scheduled-email dispatcher), live-confirmed as duplicate log lines.
"""

import asyncio

import pytest


class _FakeRedisClient:
    """Minimal stand-in for the sync redis-py client exposed as
    cache.redis_client, supporting just the .set(nx=, ex=) shape this
    module uses."""

    def __init__(self):
        self.store: dict = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True


def test_first_worker_wins_the_lease_second_worker_defers(monkeypatch):
    from src.core import lifespan as ls

    fake_client = _FakeRedisClient()
    fake_cache = type("FakeCache", (), {"redis_client": fake_client})()
    monkeypatch.setattr(ls, "cache", fake_cache)

    assert ls._try_acquire_singleton_lease("telegram_bot") is True
    # A sibling worker process racing the same startup code must not also win.
    assert ls._try_acquire_singleton_lease("telegram_bot") is False


def test_lease_check_fails_open_when_redis_unavailable(monkeypatch):
    """Single-process/no-redis deployments must keep starting these tasks
    exactly as before this guard existed -- never silently drop them."""
    from src.core import lifespan as ls

    monkeypatch.setattr(ls, "cache", None)
    assert ls._try_acquire_singleton_lease("telegram_bot") is True


def test_lease_check_fails_open_on_redis_error(monkeypatch):
    from src.core import lifespan as ls

    class _BrokenClient:
        def set(self, *a, **k):
            raise ConnectionError("redis down")

    fake_cache = type("FakeCache", (), {"redis_client": _BrokenClient()})()
    monkeypatch.setattr(ls, "cache", fake_cache)
    assert ls._try_acquire_singleton_lease("telegram_bot") is True


async def test_heartbeat_renews_lease_before_it_expires(monkeypatch):
    """The bug a non-renewed long TTL had: a redeployed container's new
    workers all saw the old (now-dead) container's lease as still held and
    the task ran nowhere until the stale key finally expired days later.
    The heartbeat must keep re-extending the TTL for as long as the owning
    process is actually alive."""
    from src.core import lifespan as ls

    fake_client = _FakeRedisClient()
    fake_cache = type("FakeCache", (), {"redis_client": fake_client})()
    monkeypatch.setattr(ls, "cache", fake_cache)
    monkeypatch.setattr(ls, "_SINGLETON_LEASE_RENEW_SECONDS", 0.01)

    assert ls._try_acquire_singleton_lease("trial_jobs") is True
    assert fake_client.store["singleton_lease:trial_jobs"] is not None

    task = asyncio.create_task(ls._singleton_lease_heartbeat("trial_jobs"))
    try:
        await asyncio.sleep(0.05)
        # A sibling worker still must not be able to steal a lease that is
        # being actively renewed by its live owner.
        assert ls._try_acquire_singleton_lease("trial_jobs") is False
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
