"""Tests for the embed-chat per-visitor rate limiter
(server/ee/modules/embed/chat_rate_limit.py).

Context: analyze_unified's own @rate_limit decorator
(src/shared/middleware/rate_limiter.py) keys its bucket off current_token's
id/organization_id. For the embed-chat endpoint that token is *manufactured*
from the embed-token OWNER's identity (see chat_router.py) -- identical for
every anonymous visitor of one widget. Reusing that decorator as the only
gate would let any number of distinct visitors pool into a single 60/min
budget instead of each getting their own. chat_rate_limit.py keys on
(assistant_id, visitor_id) instead by handing the existing RateLimiter
primitive user_id=visitor_id, org_id=<assistant scope> -- these tests lock
in that two visitors of the same assistant (and the same visitor across two
different assistants) get independent budgets.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from ee.modules.embed import chat_rate_limit
from src.shared.middleware import rate_limiter as rate_limiter_module


@pytest.fixture(autouse=True)
def _isolated_fallback_store(monkeypatch):
    """Force the deterministic in-memory fallback path (no real Redis needed
    in tests -- see RateLimiter.check_rate_limit's `if redis is None` branch)
    and give each test a clean slate so one test's budget can't bleed into
    the next via the module-level _fallback_store dict."""
    monkeypatch.setattr(rate_limiter_module, "_get_redis", lambda: None)
    rate_limiter_module._fallback_store.clear()
    yield
    rate_limiter_module._fallback_store.clear()


@pytest.mark.asyncio
async def test_requests_within_budget_are_allowed():
    assistant_id = str(uuid.uuid4())
    visitor_id = str(uuid.uuid4())
    for _ in range(chat_rate_limit.EMBED_CHAT_REQUESTS_PER_MINUTE):
        await chat_rate_limit.check_embed_rate_limit(assistant_id, visitor_id)  # must not raise


@pytest.mark.asyncio
async def test_exceeding_budget_raises_429_with_retry_after():
    assistant_id = str(uuid.uuid4())
    visitor_id = str(uuid.uuid4())
    for _ in range(chat_rate_limit.EMBED_CHAT_REQUESTS_PER_MINUTE):
        await chat_rate_limit.check_embed_rate_limit(assistant_id, visitor_id)

    with pytest.raises(HTTPException) as exc:
        await chat_rate_limit.check_embed_rate_limit(assistant_id, visitor_id)
    assert exc.value.status_code == 429
    assert exc.value.headers.get("Retry-After") == "60"


@pytest.mark.asyncio
async def test_two_visitors_of_the_same_assistant_get_independent_budgets():
    """The live bug class this module exists to prevent: two anonymous
    visitors of one embed widget must not share a single rate-limit bucket."""
    assistant_id = str(uuid.uuid4())
    visitor_a = str(uuid.uuid4())
    visitor_b = str(uuid.uuid4())

    for _ in range(chat_rate_limit.EMBED_CHAT_REQUESTS_PER_MINUTE):
        await chat_rate_limit.check_embed_rate_limit(assistant_id, visitor_a)
    with pytest.raises(HTTPException):
        await chat_rate_limit.check_embed_rate_limit(assistant_id, visitor_a)

    # Visitor B, same assistant, must still have their own full budget.
    await chat_rate_limit.check_embed_rate_limit(assistant_id, visitor_b)  # must not raise


@pytest.mark.asyncio
async def test_same_visitor_across_different_assistants_gets_independent_budgets():
    visitor_id = str(uuid.uuid4())
    assistant_a = str(uuid.uuid4())
    assistant_b = str(uuid.uuid4())

    for _ in range(chat_rate_limit.EMBED_CHAT_REQUESTS_PER_MINUTE):
        await chat_rate_limit.check_embed_rate_limit(assistant_a, visitor_id)
    with pytest.raises(HTTPException):
        await chat_rate_limit.check_embed_rate_limit(assistant_a, visitor_id)

    # Same visitor id, different assistant -> different bucket.
    await chat_rate_limit.check_embed_rate_limit(assistant_b, visitor_id)  # must not raise


@pytest.mark.asyncio
async def test_embed_chat_limit_is_more_conservative_than_authenticated_default():
    """Documents the deliberate choice (see chat_rate_limit.py's module
    docstring): an anonymous visitor gets a tighter budget than the 60/min
    default analyze_unified applies to a real logged-in user."""
    assert chat_rate_limit.EMBED_CHAT_REQUESTS_PER_MINUTE < 60
