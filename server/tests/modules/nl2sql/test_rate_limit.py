import pytest

from src.shared.middleware.rate_limiter import RateLimiter


@pytest.mark.asyncio
async def test_rate_limiter_blocks_after_threshold():
    limiter = RateLimiter(requests_per_minute=2, cost_weight=1.0)
    uid, org = "user-test-1", "org-test"
    ok1, _ = await limiter.check_rate_limit(uid, org)
    ok2, _ = await limiter.check_rate_limit(uid, org)
    ok3, reason = await limiter.check_rate_limit(uid, org)
    assert ok1 and ok2
    assert not ok3
    assert reason
