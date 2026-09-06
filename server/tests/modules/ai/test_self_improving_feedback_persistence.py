"""Regression tests for the self-improving feedback / prompt-tuning
persistence fix.

Root cause: SelfImprovingFeedbackService used to be re-instantiated fresh
(`SelfImprovingFeedbackService(None)`) on every single call site in
response_finalizer_node.py, so nothing it recorded ever survived past that
one call -- a feedback loop that never closed. prompt_tuning_service.py had
zero callers anywhere in the codebase, fully-built but never wired up. Both
fixed by: a Redis-backed (via src.core.cache, same graceful in-memory
fallback that wrapper already provides) process-wide singleton for the
feedback service, and prompt_tuning_service.py's first real caller reading
from that same persisted history.
"""

import pytest

from ee.modules.ai.services.self_improving_feedback import SelfImprovingFeedbackService


class _FakeCache:
    """Dict-backed stand-in matching src.core.cache.RedisCache's public
    get/set signature -- swapped in via monkeypatch so tests never touch a
    real Redis connection."""

    def __init__(self):
        self.store = {}

    def get(self, key, default=None):
        return self.store.get(key, default)

    def set(self, key, value, ttl=None):
        self.store[key] = value
        return True


@pytest.fixture
def fake_cache(monkeypatch):
    fc = _FakeCache()
    monkeypatch.setattr("src.core.cache.cache", fc)
    return fc


def test_record_agent_result_persists_across_new_instances(fake_cache):
    """The exact bug: a fresh instance used to know nothing about a prior
    instance's recordings. A second instance loading from the same cache
    must see what the first one wrote."""
    first = SelfImprovingFeedbackService(load_persisted=True)
    first.record_agent_result(agent_id="analytics_diagnostic", success=True, execution_time_ms=120, confidence=0.9)

    second = SelfImprovingFeedbackService(load_persisted=True)
    perf = second.get_agent_performance("analytics_diagnostic")
    assert perf["total_executions"] == 1
    assert perf["success_count"] == 1


def test_metrics_accumulate_across_multiple_writes(fake_cache):
    svc_a = SelfImprovingFeedbackService(load_persisted=True)
    svc_a.record_agent_result(agent_id="analytics_predictive", success=True, execution_time_ms=100, confidence=0.8)

    svc_b = SelfImprovingFeedbackService(load_persisted=True)
    svc_b.record_agent_result(agent_id="analytics_predictive", success=False, execution_time_ms=200, confidence=0.3, error="validation error")

    svc_c = SelfImprovingFeedbackService(load_persisted=True)
    perf = svc_c.get_agent_performance("analytics_predictive")
    assert perf["total_executions"] == 2
    assert perf["success_count"] == 1
    assert perf["failure_count"] == 1
    patterns = {p["error_type"]: p["count"] for p in svc_c.get_error_patterns()}
    assert patterns.get("validation_error") == 1


def test_user_feedback_also_persists(fake_cache):
    first = SelfImprovingFeedbackService(load_persisted=True)
    first.record_user_feedback(query="show revenue", result_satisfactory=True, agent_id="analytics_standard")

    second = SelfImprovingFeedbackService(load_persisted=True)
    insights = second.get_learning_insights()
    assert insights["total_feedback"] == 1
    assert insights["user_satisfaction_rate"] == 100.0


def test_load_persisted_false_stays_empty_even_with_cached_data(fake_cache):
    """An ephemeral instance (load_persisted=False, the default) must not
    silently pick up another instance's history -- e.g. a test or one-off
    analysis script that deliberately wants a clean slate."""
    seeded = SelfImprovingFeedbackService(load_persisted=True)
    seeded.record_agent_result(agent_id="analytics_diagnostic", success=True, execution_time_ms=50, confidence=0.9)

    fresh = SelfImprovingFeedbackService()  # load_persisted defaults False
    assert fresh.get_agent_performance("analytics_diagnostic")["total_executions"] == 0


def test_missing_or_corrupt_cache_entry_fails_open(monkeypatch):
    """No cache configured at all (cache is None, matching a Redis-down
    deployment) must never break agent execution -- same fail-open
    contract the rest of this service already has."""
    monkeypatch.setattr("src.core.cache.cache", None)
    svc = SelfImprovingFeedbackService(load_persisted=True)
    svc.record_agent_result(agent_id="analytics_diagnostic", success=True, execution_time_ms=10, confidence=0.9)
    assert svc.get_agent_performance("analytics_diagnostic")["total_executions"] == 1


def test_singleton_factory_returns_the_same_instance(fake_cache):
    from ee.modules.ai.services import self_improving_feedback as mod

    mod._shared_instance = None  # isolate from any prior test's singleton
    a = mod.get_self_improving_feedback_service()
    b = mod.get_self_improving_feedback_service()
    assert a is b
    mod._shared_instance = None


def test_prompt_tuning_service_reads_the_persisted_history(fake_cache):
    from ee.modules.ai.services.prompt_tuning_service import PromptTuningService

    feedback = SelfImprovingFeedbackService(load_persisted=True)
    for _ in range(3):
        feedback.record_agent_result(
            agent_id="analytics_diagnostic", success=False, execution_time_ms=100,
            confidence=0.2, error="validation error: missing field",
        )
    tuning = PromptTuningService(feedback, enabled=True)
    analysis = tuning.analyze_prompt_performance("analytics_diagnostic")
    assert analysis["enabled"] is True
    assert "validation_error" in analysis["common_errors"]
    assert any("format" in r.lower() for r in analysis["recommendations"])


def test_prompt_tuning_service_disabled_is_a_pure_passthrough():
    from ee.modules.ai.services.prompt_tuning_service import PromptTuningService

    tuning = PromptTuningService(SelfImprovingFeedbackService(), enabled=False)
    assert tuning.get_optimized_prompt("analytics_diagnostic", "base prompt") == "base prompt"
    assert tuning.analyze_prompt_performance("analytics_diagnostic") == {
        "enabled": False, "message": "Prompt tuning is disabled",
    }
