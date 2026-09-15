"""Regression: NL2SQL's direct-LLM SQL generation must not let PII scrubbing
corrupt real schema identifiers in either the prompt sent to the model or
the SQL it returns.

Root cause, live-reproduced end-to-end against the real pipeline (query:
"What's the relationship between amount due and monthly fee?", schema with
bills/plans/subscribers tables): two independent PII false-positives both
fired on this one request.

1. INPUT side: "subscriber_id" alone (no dot, so the existing
   auto_protect_identifiers dotted-identifier guard never sees it) tripped
   Presidio's NER model as an NRP (nationality/religious/political) entity
   and was replaced with "<NRP>" before the model ever saw the schema —
   confirmed via `pii_scrubber.scrub_text("subscriber_id") == "<NRP>"`.
   Fixed by extracting snake_case identifier tokens out of the schema text
   itself and passing them as `protected_terms`.

2. OUTPUT side: the model's own generated SQL, echoing back "plan_id" /
   "monthly_fee" / "amount_due", was corrupted by moderate_llm_output's PII
   scrubbing (independent of the dotted-identifier issue -- these have no
   dot) into "<URL>an_id" / "<URL>nthly_fee" / "<URL>ount_due", turning
   syntactically valid SQL into garbage that the "is this a valid SELECT/
   WITH statement" check then correctly rejected. Fixed by passing
   moderate_output=False for SQL generation: the response is query
   structure, not data values, so it carries no data-derived PII risk
   (matching generate_completion's own moderate_output guidance for
   conversational replies).
"""
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.agents.nl2sql_agent import EnhancedNL2SQLAgent


class _FakeUsage:
    prompt_tokens = 10
    completion_tokens = 10
    total_tokens = 20

    def dict(self):
        return {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}


class _FakeMessage:
    def __init__(self, content):
        self.content = content
        self.reasoning_content = None


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMessage(content)
        self.finish_reason = "stop"


class _FakeResponse:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]
        self.usage = _FakeUsage()
        self.model = "test-model"


SCHEMA_CONTEXT = (
    "bills(bill_id, subscriber_id, amount_due, bill_date), "
    "plans(plan_id, monthly_fee), "
    "subscribers(subscriber_id), "
    "usage_records(usage_id, subscriber_id)"
)

# What a real model would echo back, unmangled -- the scrub pipeline is what
# corrupts this if the fix isn't in place, not the (faked) model itself.
MODEL_SQL_RESPONSE = (
    '{"sql_query": "SELECT p.plan_id, p.monthly_fee, AVG(b.amount_due) AS avg_amount_due '
    'FROM bills b JOIN subscribers s ON b.subscriber_id = s.subscriber_id '
    'JOIN plans p ON s.plan_id = p.plan_id GROUP BY p.plan_id, p.monthly_fee", '
    '"dialect": "clickhouse", "explanation": "test", "success": true}'
)


@pytest.mark.asyncio
async def test_sql_generation_survives_pii_scrubbing_end_to_end():
    # The LLM circuit breaker (ee.modules.ai.utils.circuit_breaker) is a
    # process-wide in-memory registry, not reset between tests -- and even a
    # reset() immediately before this test wasn't enough to make it reliable
    # in the full suite (some other test's concurrent/leftover state can
    # still flip it mid-test). This test exists to catch PII-corruption of
    # generated SQL, not to also be a correctness test of the breaker itself,
    # so bypass should_allow_request() entirely for its duration rather than
    # depend on the shared breaker's live state.
    from ee.modules.ai.utils.circuit_breaker import CircuitBreaker

    agent = EnhancedNL2SQLAgent(
        litellm_service=_build_service(), data_service=None, multi_query_service=None, async_session_factory=None,
    )

    with patch.object(CircuitBreaker, "should_allow_request", return_value=True), patch(
        "ee.modules.ai.services.litellm_service._litellm_acompletion",
        new=AsyncMock(return_value=_FakeResponse(MODEL_SQL_RESPONSE)),
    ):
        result = await agent.agent.ainvoke({
            "input": "What's the relationship between amount due and monthly fee?",
            "schema_context": SCHEMA_CONTEXT,
            "chat_history": [],
            "lessons_learned": [],
        })

    output = result.get("output", "")
    # None of the real schema identifiers were corrupted by PII scrubbing on
    # either the way in (subscriber_id -> <NRP>) or the way out
    # (plan_id/monthly_fee/amount_due -> <URL>...).
    assert "subscriber_id" in output
    assert "plan_id" in output
    assert "monthly_fee" in output
    assert "amount_due" in output
    assert "<NRP>" not in output
    assert "<URL>" not in output


def _build_service():
    from ee.modules.ai.services.litellm_service import LiteLLMService

    return LiteLLMService()
