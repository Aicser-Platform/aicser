"""Regression tests for the NL2SQL generation cache's eligibility gate.

_is_nl2sql_cache_eligible decides whether a call is a "plain" standalone
first attempt safe to read/write nl2sql_cache_service against. Anything
that changes the effective prompt beyond "this question, this schema" must
disqualify it -- a blind cache hit in those cases could silently replay a
stale or contextually-wrong SQL.
"""

from ee.modules.ai.nodes.nl2sql_node import _is_nl2sql_cache_eligible


def _eligible(**overrides):
    base = dict(
        last_sql_error=None,
        lessons_learned=None,
        conversation_history=None,
        decomposition_context="",
        few_shot_context="",
        delegation_context=None,
    )
    base.update(overrides)
    return _is_nl2sql_cache_eligible(**base)


def test_a_plain_first_attempt_is_eligible():
    assert _eligible() is True


def test_a_retry_with_a_prior_sql_error_is_ineligible():
    assert _eligible(last_sql_error="Hallucination detected: Table 'x' does not exist") is False


def test_lessons_learned_feedback_is_ineligible():
    assert _eligible(lessons_learned=["avoid casting revenue to int"]) is False


def test_conversation_history_is_ineligible():
    """A follow-up question ('now break it down by region') can reference
    prior turns the cache key has no visibility into."""
    assert _eligible(conversation_history=[{"role": "user", "content": "and last month?"}]) is False


def test_decomposition_context_is_ineligible():
    assert _eligible(decomposition_context="Join hint from schema analysis: orders.customer_id") is False


def test_few_shot_context_is_ineligible():
    assert _eligible(few_shot_context="Example Q/SQL pairs...") is False


def test_delegation_context_is_ineligible():
    assert _eligible(delegation_context={"delegated_from": "supervisor"}) is False


def test_empty_string_and_empty_list_are_still_eligible():
    """Falsy-but-present values (the common '' / [] defaults threaded through
    the call site) must not be mistaken for real context."""
    assert _eligible(decomposition_context="", few_shot_context="", conversation_history=[], lessons_learned=[]) is True
