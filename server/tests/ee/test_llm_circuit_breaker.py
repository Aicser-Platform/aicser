"""Regression tests for LLM circuit breaker behavior."""


def test_open_breaker_rejections_do_not_extend_timeout(monkeypatch):
    from ee.modules.ai.utils import circuit_breaker as cb

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

    breaker.record_failure("upstream failed")
    assert breaker.state == cb.CircuitState.OPEN

    now = 1_005.0
    assert breaker.should_allow_request() is False
    assert breaker.stats.last_failure_time == 1_000.0

    now = 1_011.0
    assert breaker.should_allow_request() is True
    assert breaker.state == cb.CircuitState.HALF_OPEN


def test_llm_breakers_are_scoped_by_provider():
    from ee.modules.ai.utils.circuit_breaker import (
        CircuitBreakerRegistry,
        get_llm_circuit_breaker,
    )

    registry = CircuitBreakerRegistry()
    registry.reset_all()

    azure = get_llm_circuit_breaker("azure")
    google = get_llm_circuit_breaker("google")

    assert azure is not google
    assert azure.name == "llm_operations:azure"
    assert google.name == "llm_operations:google"
