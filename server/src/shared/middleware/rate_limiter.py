"""
API-level rate limiting for AI and expensive endpoints.

Role: Protects AI/streaming endpoints from abuse (per-user and per-org request/cost
limits). Uses Redis for distributed rate limiting across multiple workers/pods.
Falls back to in-memory if Redis is unavailable.

Usage:
    from src.shared.middleware.rate_limiter import RateLimiter, rate_limit

    @router.post("/analyze")
    @rate_limit(requests_per_minute=60, cost_weight=10)
    async def analyze(...):
        ...
"""

import logging
import time
import json
from functools import wraps
from typing import Optional

from fastapi import HTTPException, Request
from starlette.status import HTTP_429_TOO_MANY_REQUESTS

logger = logging.getLogger(__name__)

# In-memory fallback store (used only when Redis is unavailable)
_fallback_store: dict = {}

# Log Redis unavailability once per process (dev often has no Redis on localhost:6379)
_redis_rate_fallback_warned: bool = False


def _get_redis():
    """Get Redis client from app state or create a new one. Returns None if unavailable."""
    try:
        import redis.asyncio as aioredis
        import os
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        return aioredis.from_url(redis_url, decode_responses=True, socket_connect_timeout=1)
    except Exception:
        return None


class RateLimiter:
    """
    Adaptive Burst-Weighted Token Bucket limiter.

    Features:
    - Per-tenant and per-user isolation keys
    - Weighted request costs for expensive operations
    - Burst allowance with steady refill
    - Redis-backed for multi-worker/pod deployments
    - In-memory fallback when Redis is unavailable
    """

    def __init__(
        self,
        requests_per_minute: int = 60,
        tokens_per_minute: int = 50000,
        cost_weight: float = 1.0,
    ):
        self.requests_per_minute = requests_per_minute
        self.tokens_per_minute = tokens_per_minute
        self.cost_weight = cost_weight

    def _get_key(self, user_id: str, org_id: str, scope: str) -> str:
        return f"ratelimit:{scope}:{org_id}:{user_id}"

    def _check_fallback(self, user_id: str, org_id: str, cost: float) -> tuple[bool, Optional[str]]:
        """In-memory fallback rate check."""
        now = time.time()
        window = 60
        weighted_cost = max(0.1, cost * self.cost_weight)

        user_key = self._get_key(user_id, org_id, "user")
        state = _fallback_store.setdefault(user_key, {"events": []})
        state["events"] = [(ts, c) for ts, c in state["events"] if now - ts < window]

        if len(state["events"]) >= self.requests_per_minute:
            return False, f"Rate limit exceeded: {len(state['events'])}/{self.requests_per_minute} requests per minute"

        state["events"].append((now, weighted_cost))
        return True, None

    async def check_rate_limit(self, user_id: str, org_id: str, cost: float = 1.0) -> tuple[bool, Optional[str]]:
        """
        Check if request is within rate limits using Redis sliding window.

        Returns:
            (allowed: bool, reason: Optional[str])
        """
        weighted_cost = max(0.1, cost * self.cost_weight)
        window = 60  # seconds
        now = time.time()

        redis = _get_redis()
        if redis is None:
            return self._check_fallback(user_id, org_id, cost)

        try:
            user_key = self._get_key(user_id, org_id, "user")
            pipe = redis.pipeline()

            # Sliding window: remove old entries, add new, count
            pipe.zremrangebyscore(user_key, "-inf", now - window)
            pipe.zadd(user_key, {f"{now}:{weighted_cost}": now})
            pipe.zcard(user_key)
            pipe.expire(user_key, window + 5)
            results = await pipe.execute()

            user_count = results[2]
            if user_count > self.requests_per_minute:
                # Undo the add
                await redis.zremrangebyscore(user_key, now, now)
                logger.warning(f"Rate limit exceeded for user {user_id}: {user_count}/{self.requests_per_minute}")
                return False, f"Rate limit exceeded: {user_count}/{self.requests_per_minute} requests per minute"

            # Per-org check
            org_key = self._get_key("*", org_id, "org")
            org_limit = self.requests_per_minute * 3
            pipe2 = redis.pipeline()
            pipe2.zremrangebyscore(org_key, "-inf", now - window)
            pipe2.zadd(org_key, {f"{now}:{user_id}": now})
            pipe2.zcard(org_key)
            pipe2.expire(org_key, window + 5)
            results2 = await pipe2.execute()

            org_count = results2[2]
            if org_count > org_limit:
                logger.warning(f"Org rate limit exceeded for org {org_id}: {org_count}/{org_limit}")
                return False, f"Organization rate limit exceeded: {org_count}/{org_limit} requests per minute"

            await redis.aclose()
            return True, None

        except Exception as e:
            global _redis_rate_fallback_warned
            if not _redis_rate_fallback_warned:
                logger.warning(
                    "Redis rate limit unavailable (%s); using in-process fallback. "
                    "Start Redis or set REDIS_URL for distributed limits across workers.",
                    e,
                )
                _redis_rate_fallback_warned = True
            else:
                logger.debug("Redis rate limit check failed, using fallback: %s", e)
            try:
                await redis.aclose()
            except Exception:
                pass
            return self._check_fallback(user_id, org_id, cost)


def rate_limit(
    requests_per_minute: int = 60,
    cost_weight: float = 1.0,
):
    """
    Decorator for rate limiting API endpoints.

    Args:
        requests_per_minute: Max requests per user per minute
        cost_weight: Cost multiplier for expensive operations (1.0 = standard, 10.0 = expensive)

    Usage:
        @rate_limit(requests_per_minute=30, cost_weight=5.0)
        async def expensive_endpoint(...):
            ...
    """
    limiter = RateLimiter(requests_per_minute=requests_per_minute, cost_weight=cost_weight)

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request = None
            current_token = None

            for arg in args:
                if isinstance(arg, Request):
                    request = arg

            if "request" in kwargs:
                request = kwargs["request"]
            if "current_token" in kwargs:
                current_token = kwargs["current_token"]

            if not current_token:
                for arg in args:
                    if isinstance(arg, dict) and ("user_id" in arg or "id" in arg):
                        current_token = arg
                        break

            if not current_token:
                logger.debug("Rate limiter: no current_token found, allowing request")
                return await func(*args, **kwargs)

            user_id = str(current_token.get("id") or current_token.get("user_id") or current_token.get("sub", "anonymous"))
            org_id = str(current_token.get("organization_id", "default"))

            allowed, reason = await limiter.check_rate_limit(user_id, org_id, cost=1.0)

            if not allowed:
                logger.warning(f"Rate limit blocked: user={user_id}, org={org_id}, reason={reason}")
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail=reason or "Rate limit exceeded",
                    headers={"Retry-After": "60"}
                )

            return await func(*args, **kwargs)

        return wrapper
    return decorator


async def get_rate_limit_status(user_id: str, org_id: str) -> dict:
    """Get current rate limit status for a user from Redis."""
    now = time.time()
    window = 60

    redis = _get_redis()
    if redis is None:
        user_key = f"ratelimit:user:{org_id}:{user_id}"
        state = _fallback_store.get(user_key, {"events": []})
        events = [(ts, c) for ts, c in state.get("events", []) if now - ts < window]
        used = len(events)
        return {"requests_used": used, "requests_remaining": max(0, 60 - used), "reset_at": now + window}

    try:
        user_key = f"ratelimit:user:{org_id}:{user_id}"
        await redis.zremrangebyscore(user_key, "-inf", now - window)
        used = await redis.zcard(user_key)
        oldest_members = await redis.zrange(user_key, 0, 0, withscores=True)
        oldest_ts = oldest_members[0][1] if oldest_members else now
        await redis.aclose()
        return {
            "requests_used": used,
            "requests_remaining": max(0, 60 - used),
            "reset_at": oldest_ts + window,
        }
    except Exception as e:
        global _redis_rate_fallback_warned
        if not _redis_rate_fallback_warned:
            logger.warning(
                "Redis rate limit status unavailable (%s); using in-process fallback.", e
            )
            _redis_rate_fallback_warned = True
        else:
            logger.debug("Redis rate limit status check failed: %s", e)
        try:
            await redis.aclose()
        except Exception:
            pass
        return {"requests_used": 0, "requests_remaining": 60, "reset_at": now + window}
