"""RateLimiter (charts/queries routers) read plan and credits from organizations columns that
are never updated when an org subscribes, so paying orgs were held to the free plan's credits.
It now delegates to usage_tracker, which reads the subscription and organization_usage."""

from unittest.mock import AsyncMock, patch

import pytest

from src.modules.pricing.rate_limiter import RateLimiter

MOD = "src.modules.pricing.rate_limiter"


@pytest.mark.asyncio
async def test_check_uses_subscription_credit_limit():
    check = AsyncMock(return_value=(False, 30, 30, "AI credit limit reached"))
    with patch(f"{MOD}.check_ai_credit_limit", new=check):
        allowed, message = await RateLimiter(AsyncMock()).check_ai_credits(123, 1)
    assert (allowed, message) == (False, "AI credit limit reached")
    assert check.await_args.args[:2] == ("123", 1)


@pytest.mark.asyncio
async def test_consume_tracks_credits_for_org_and_user():
    track = AsyncMock(return_value=(True, "ok"))
    usage = AsyncMock(return_value=(True, 10, 5000, "ok"))
    with patch(f"{MOD}.track_ai_credits", new=track), patch(f"{MOD}.check_ai_credit_limit", new=usage):
        ok = await RateLimiter(AsyncMock()).consume_credits("org-1", 2, "user-1", metadata={"action": "chart_generation"})
    assert ok is True
    assert track.await_args.args[:2] == ("org-1", 2)
    assert track.await_args.kwargs["user_id"] == "user-1"


@pytest.mark.asyncio
async def test_consume_reports_failure_without_alerting():
    track = AsyncMock(return_value=(False, "AI credit limit exceeded"))
    usage = AsyncMock()
    with patch(f"{MOD}.track_ai_credits", new=track), patch(f"{MOD}.check_ai_credit_limit", new=usage):
        ok = await RateLimiter(AsyncMock()).consume_credits("org-1", 2, "user-1")
    assert ok is False
    usage.assert_not_awaited()


@pytest.mark.asyncio
async def test_project_limit_comes_from_effective_plan():
    db = AsyncMock()
    db.execute.return_value.scalar = lambda: 3
    with patch(f"{MOD}._get_effective_plan_limits", new=AsyncMock(return_value=("team", {"max_projects": -1}))):
        ok, message, current = await RateLimiter(db).check_project_limit("org-1")
    assert (ok, message, current) == (True, "unlimited", 3)
