"""Regression tests for LLM circuit breaker behavior."""

import pytest


async def test_open_breaker_rejections_do_not_extend_timeout(monkeypatch):
    """Local (no-Redis) fallback state machine: forced deterministic via a
    monkeypatched _get_async_redis so this test doesn't depend on whether a
    real Redis happens to be reachable in whatever environment runs it."""
    from ee.modules.ai.utils import circuit_breaker as cb

    monkeypatch.setattr(cb, "_get_async_redis", lambda: None)

    now = 1_000.0
    monkeypatch.setattr(cb.time, "time", lambda: now)

    breaker = cb.CircuitBreaker(
        "test_llm",
        cb.CircuitBreakerConfig(
            failure_threshold=1,
            success_threshold=1,
            timeout_seconds=10.0,
            half_open_max_requests=1,
        ),
    )

    await breaker.record_failure("upstream failed")
    assert breaker.state == cb.CircuitState.OPEN

    now = 1_005.0
    assert await breaker.should_allow_request() is False
    assert breaker.stats.last_failure_time == 1_000.0

    now = 1_011.0
    assert await breaker.should_allow_request() is True
    assert breaker.state == cb.CircuitState.HALF_OPEN


async def test_llm_breakers_are_scoped_by_provider(monkeypatch):
    from ee.modules.ai.utils import circuit_breaker as cb
    from ee.modules.ai.utils.circuit_breaker import (
        CircuitBreakerRegistry,
        get_llm_circuit_breaker,
    )

    monkeypatch.setattr(cb, "_get_async_redis", lambda: None)

    registry = CircuitBreakerRegistry()
    await registry.reset_all()

    azure = get_llm_circuit_breaker("azure")
    google = get_llm_circuit_breaker("google")

    assert azure is not google
    assert azure.name == "llm_operations:azure"
    assert google.name == "llm_operations:google"


class _FakeAsyncRedis:
    """Minimal in-process stand-in for redis.asyncio.Redis, shared across
    multiple CircuitBreaker *instances* the way a real Redis server would be
    shared across multiple worker processes -- lets the distributed-state
    test below run without a live Redis server."""

    def __init__(self, store: dict):
        self._store = store

    async def get(self, key):
        return self._store.get(key)

    async def set(self, key, value, ex=None):
        self._store[key] = str(value)

    async def incr(self, key):
        self._store[key] = str(int(self._store.get(key, 0)) + 1)
        return int(self._store[key])

    async def expire(self, key, ttl):
        return True

    async def delete(self, *keys):
        for k in keys:
            self._store.pop(k, None)

    async def aclose(self):
        pass

    def pipeline(self):
        return _FakePipeline(self)


class _FakePipeline:
    def __init__(self, redis: "_FakeAsyncRedis"):
        self._redis = redis
        self._ops = []

    def get(self, key):
        self._ops.append(("get", key))
        return self

    async def execute(self):
        results = []
        for op, key in self._ops:
            if op == "get":
                results.append(await self._redis.get(key))
        return results


async def test_breaker_state_is_shared_across_instances_via_redis(monkeypatch):
    """The point of the Redis backing: two separate CircuitBreaker objects
    (standing in for two uvicorn workers / container replicas) with the same
    name must agree on OPEN/CLOSED state through the shared store, not just
    their own in-memory copy."""
    from ee.modules.ai.utils import circuit_breaker as cb

    shared_store: dict = {}
    monkeypatch.setattr(cb, "_get_async_redis", lambda: _FakeAsyncRedis(shared_store))

    config = cb.CircuitBreakerConfig(failure_threshold=2, success_threshold=1, timeout_seconds=60.0)
    worker_a = cb.CircuitBreaker("shared_provider", config)
    worker_b = cb.CircuitBreaker("shared_provider", config)

    # Worker A alone trips the breaker.
    await worker_a.record_failure("timeout")
    await worker_a.record_failure("timeout")
    assert (await worker_a.get_status())["state"] == "open"

    # Worker B, which never saw a failure locally, must see it too.
    assert (await worker_b.get_status())["state"] == "open"
    assert await worker_b.should_allow_request() is False


async def test_breaker_falls_back_to_local_state_when_redis_errors(monkeypatch):
    from ee.modules.ai.utils import circuit_breaker as cb

    class _BrokenRedis:
        def pipeline(self):
            raise ConnectionError("redis down")

        async def incr(self, key):
            raise ConnectionError("redis down")

        async def get(self, key):
            raise ConnectionError("redis down")

        async def set(self, key, value, ex=None):
            raise ConnectionError("redis down")

        async def aclose(self):
            pass

    monkeypatch.setattr(cb, "_get_async_redis", lambda: _BrokenRedis())

    breaker = cb.CircuitBreaker(
        "degraded_provider",
        cb.CircuitBreakerConfig(failure_threshold=1, success_threshold=1, timeout_seconds=60.0),
    )

    # Should not raise -- falls back to the local in-memory state machine.
    assert await breaker.should_allow_request() is True
    await breaker.record_failure("boom")
    assert breaker.state == cb.CircuitState.OPEN
