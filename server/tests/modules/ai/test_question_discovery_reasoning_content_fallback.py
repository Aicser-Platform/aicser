"""Regression test for a live-observed failure: a reasoning-tier model
returned an empty `content` field (all output landed in `reasoning_content`
instead), which generate_smart_discovery_with_llm previously never checked —
logged as "Message object has no content/text/message" followed by "could
not extract JSON from response", silently falling back to generic
schema-only suggestions instead of the LLM-generated ones.

Fix: when `content` is empty, fall back to `reasoning_content` (already
present in the same response dict) before giving up. Also bumped max_tokens
600 -> 1200 so a reasoning trace has room to complete before the JSON answer.
"""

from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.utils.question_discovery import QuestionDiscoveryService

_SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "revenue", "type": "numeric"},
                {"name": "region", "type": "varchar"},
                {"name": "order_date", "type": "timestamp"},
            ],
        }
    ]
}


@pytest.mark.asyncio
async def test_recovers_questions_from_reasoning_content_when_content_is_empty():
    litellm_service = AsyncMock()
    litellm_service.generate_completion = AsyncMock(
        return_value={
            "success": True,
            "content": None,
            "reasoning_content": (
                'We need to produce NL2SQL-ready questions.\n'
                '{"questions": ["Show revenue by region", "Revenue trend over order_date"]}'
            ),
        }
    )

    out = await QuestionDiscoveryService().generate_smart_discovery_with_llm(
        litellm_service=litellm_service,
        schema=_SCHEMA,
        count=2,
    )

    assert out
    joined = " ".join(out).lower()
    assert "revenue" in joined
    # max_tokens was bumped to give reasoning models real headroom.
    _, kwargs = litellm_service.generate_completion.call_args
    assert kwargs["max_tokens"] == 1200


@pytest.mark.asyncio
async def test_falls_back_to_static_suggestions_when_both_content_and_reasoning_are_empty():
    litellm_service = AsyncMock()
    litellm_service.generate_completion = AsyncMock(
        return_value={"success": True, "content": None, "reasoning_content": None}
    )

    out = await QuestionDiscoveryService().generate_smart_discovery_with_llm(
        litellm_service=litellm_service,
        schema=_SCHEMA,
        count=2,
    )

    # Fails open to the service's own static/template discovery, never raises.
    assert isinstance(out, list)
