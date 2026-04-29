"""HTTP middleware: rate limiting and embed token validation."""
import time
import logging
from datetime import datetime

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from starlette.middleware.base import BaseHTTPMiddleware

from src.core.cache import cache

logger = logging.getLogger(__name__)

_ai_rl_fallback_store: dict = {}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limiting for /ai/* endpoints: 60 requests per 60-second window."""

    WINDOW = 60
    LIMIT = 60

    async def dispatch(self, request: Request, call_next):
        try:
            if not (request.url.path or "").startswith("/ai/"):
                return await call_next(request)

            identifier = request.client.host if request.client else "unknown"
            allowed, remaining, reset_epoch, retry_after = self._check(identifier)

            if not allowed:
                resp = JSONResponse(
                    status_code=429,
                    content={
                        "error": "Rate limit exceeded",
                        "message": "Too many requests. Please try again later.",
                        "retry_after": retry_after,
                        "reset_time": reset_epoch,
                    },
                )
                self._attach_headers(resp, self.LIMIT, 0, reset_epoch, retry_after)
                return resp

            response = await call_next(request)
            self._attach_headers(response, self.LIMIT, remaining or 0, reset_epoch)
            return response
        except Exception:
            return await call_next(request)

    @staticmethod
    def _attach_headers(resp, limit, remaining, reset, retry_after=None):
        resp.headers["X-RateLimit-Limit"] = str(limit)
        resp.headers["X-RateLimit-Remaining"] = str(remaining)
        resp.headers["X-RateLimit-Reset"] = str(reset or 0)
        if retry_after:
            resp.headers["Retry-After"] = str(retry_after)

    def _check(self, identifier: str) -> tuple:
        try:
            rc = cache.redis_client if cache else None
            if rc is None:
                raise RuntimeError("no redis")
            key = f"ai_rl:{identifier}:{int(time.time() // self.WINDOW)}"
            current = rc.incr(key)
            if current == 1:
                rc.expire(key, self.WINDOW)
            ttl = rc.ttl(key)
            allowed = current <= self.LIMIT
            remaining = max(0, self.LIMIT - int(current))
            reset_epoch = int(time.time()) + (ttl if ttl and ttl > 0 else self.WINDOW)
            retry_after = max(1, ttl) if not allowed and ttl else None
            return allowed, remaining, reset_epoch, retry_after
        except Exception:
            now = int(time.time())
            bucket = now // self.WINDOW
            key = f"{identifier}:{bucket}"
            entry = _ai_rl_fallback_store.get(key)
            if not entry:
                _ai_rl_fallback_store.clear()
                entry = {"count": 0, "reset": (bucket + 1) * self.WINDOW}
                _ai_rl_fallback_store[key] = entry
            entry["count"] += 1
            allowed = entry["count"] <= self.LIMIT
            remaining = max(0, self.LIMIT - int(entry["count"]))
            reset_epoch = entry["reset"]
            retry_after = max(1, reset_epoch - now) if not allowed else None
            return allowed, remaining, reset_epoch, retry_after


class EmbedTokenMiddleware(BaseHTTPMiddleware):
    """Validate embed tokens for /embed/dashboards/* routes."""

    async def dispatch(self, request: Request, call_next):
        try:
            if request.url.path.startswith("/embed/dashboards/"):
                token = (
                    request.query_params.get("token")
                    or request.headers.get("x-embed-token")
                )
                if not token:
                    return JSONResponse(
                        status_code=401, content={"detail": "Embed token required"}
                    )

                from src.modules.charts.models import DashboardEmbed
                from src.db.session import get_async_session

                async with get_async_session() as db:
                    res = await db.execute(
                        select(DashboardEmbed).where(
                            DashboardEmbed.embed_token == token,
                            DashboardEmbed.is_active == True,
                        )
                    )
                    embed = res.scalar_one_or_none()
                    if not embed:
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Invalid or inactive embed token"},
                        )

                    if embed.expires_at and isinstance(embed.expires_at, datetime):
                        if embed.expires_at < datetime.utcnow():
                            return JSONResponse(
                                status_code=403,
                                content={"detail": "Embed token expired"},
                            )

                    embed.access_count = (embed.access_count or 0) + 1
                    embed.last_accessed_at = func.now()
                    await db.flush()
                    await db.commit()
                    request.state.embed = embed
        except Exception as e:
            logger.error("Error in embed middleware: %s", e)

        return await call_next(request)
