"""A run where every model call failed (bad key, outage, open breaker) must not be billed."""

from ee.modules.ai.observability.request_context import (
    ai_never_answered,
    record_llm_outcome,
    record_llm_usage,
    start_ai_request_context,
)


def test_every_call_failed_means_no_ai_work():
    start_ai_request_context("r1")
    record_llm_outcome(False)
    record_llm_outcome(False)
    assert ai_never_answered()


def test_one_answer_is_billable():
    start_ai_request_context("r2")
    record_llm_outcome(False)  # first model rejected the key
    record_llm_outcome(True)  # fallback answered
    assert not ai_never_answered()


def test_tokens_used_is_billable_even_without_an_outcome_record():
    start_ai_request_context("r3")
    record_llm_outcome(False)
    record_llm_usage("gemini/x", 10, 5, 15)
    assert not ai_never_answered()


def test_deterministic_answer_with_no_model_call_is_unchanged():
    # Never called a model: pricing for rule-based answers stays as it was.
    start_ai_request_context("r4")
    assert not ai_never_answered()
