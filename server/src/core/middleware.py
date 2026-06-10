"""HTTP middleware: rate limiting and embed token validation."""
import time
import logging
from datetime import datetime
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from starlette.middleware.base import BaseHTTPMiddleware

from src.core.cache import cache

logger = logging.getLogger(__name__)

_ai_rl_fallback_store: dict = {}


# ---------------------------------------------------------------------------
# Path helpers — kept at module level so tests can import them directly.
# ---------------------------------------------------------------------------

def _embed_protected_path(path: str) -> bool:
    """Return True when the request path requires embed token validation."""
    if path.startswith("/embed/dashboards/") or path.startswith("/embed/dashboard/"):
        return True
    if path.startswith("/charts/dashboards/") and path.rstrip("/").endswith("/embed"):
        return True
    return False


def _extract_dashboard_id_from_embed_path(path: str) -> Optional[str]:
    """Extract the dashboard UUID/slug from an embed URL path.

    Returns *None* if the ID segment cannot be located — callers treat this
    as a fail-safe signal to tighten (not loosen) access control.
    """
    parts = [p for p in path.split("/") if p]
    for i, part in enumerate(parts):
        if part == "dashboards" and i + 1 < len(parts):
            candidate = parts[i + 1]
            if candidate != "embed":
                return candidate
        if part == "dashboard" and i + 1 < len(parts):
            return parts[i + 1]
    return None


class ApiRouteRateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limits for auth, query execution, and file uploads."""

    # (path suffix or exact path, limit per window, window seconds)
    RULES: tuple[tuple[str, int, int], ...] = (
        ("/auth/login", 15, 60),
        ("/auth/register", 10, 60),
        ("/data/query/execute", 40, 60),
        ("/data/upload", 25, 60),
        ("/knowledge/upload", 25, 60),
    )

    async def dispatch(self, request: Request, call_next):
        path = (request.url.path or "").rstrip("/")
        rule = self._match_rule(path)
        if not rule:
            return await call_next(request)

        _prefix, limit, window = rule
        identifier = request.client.host if request.client else "unknown"
        allowed, remaining, reset_epoch, retry_after = self._check(
            f"api:{_prefix}:{identifier}", limit, window
        )

        if not allowed:
            resp = JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limit_exceeded",
                    "message": "Too many requests. Please try again later.",
                    "retry_after": retry_after,
                    "reset_time": reset_epoch,
                },
            )
            RateLimitMiddleware._attach_headers(resp, limit, 0, reset_epoch, retry_after)
            return resp

        response = await call_next(request)
        RateLimitMiddleware._attach_headers(response, limit, remaining or 0, reset_epoch)
        return response

    @classmethod
    def _match_rule(cls, path: str) -> Optional[tuple[str, int, int]]:
        for prefix, limit, window in cls.RULES:
            p = prefix.rstrip("/")
            if path == p or path.endswith(p):
                return prefix, limit, window
        return None

    def _check(self, key: str, limit: int, window: int) -> tuple:
        try:
            rc = cache.redis_client if cache else None
            if rc is None:
                raise RuntimeError("no redis")
            bucket = int(time.time() // window)
            redis_key = f"api_rl:{key}:{bucket}"
            current = rc.incr(redis_key)
            if current == 1:
                rc.expire(redis_key, window)
            ttl = rc.ttl(redis_key)
            allowed = current <= limit
            remaining = max(0, limit - int(current))
            reset_epoch = int(time.time()) + (ttl if ttl and ttl > 0 else window)
            retry_after = max(1, ttl) if not allowed and ttl else None
            return allowed, remaining, reset_epoch, retry_after
        except Exception:
            now = int(time.time())
            bucket = now // window
            store_key = f"{key}:{bucket}"
            entry = _ai_rl_fallback_store.get(store_key)
            if not entry:
                entry = {"count": 0, "reset": (bucket + 1) * window}
                _ai_rl_fallback_store[store_key] = entry
            entry["count"] += 1
            allowed = entry["count"] <= limit
            remaining = max(0, limit - int(entry["count"]))
            reset_epoch = entry["reset"]
            retry_after = max(1, reset_epoch - now) if not allowed else None
            return allowed, remaining, reset_epoch, retry_after


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limiting for /ai/* endpoints: 60 requests per 60-second window."""

    WINDOW = 60
    LIMIT = 60

    async def dispatch(self, request: Request, call_next):
        try:
            path = request.url.path or ""
            if not path.startswith("/ai/"):
                return await call_next(request)

            # Discovery chips are Redis-cached server-side; don't compete with analyze in the IP bucket.
            if path.rstrip("/") == "/ai/chat/discover":
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


def _normalize_host(value: str) -> str:
    value = (value or "").strip().lower()
    if value.startswith("http://") or value.startswith("https://"):
        try:
            from urllib.parse import urlparse
            return (urlparse(value).hostname or "").lower()
        except Exception:
            return value
    return value.split("/")[0].split(":")[0]


def _check_embed_domain(request: Request, allowed_domains: list) -> Optional[JSONResponse]:
    if not allowed_domains:
        return None
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    host = _normalize_host(origin)
    if not host:
        return None
    allowed = {_normalize_host(d) for d in allowed_domains if d}
    if host not in allowed and not any(host.endswith(f".{d}") for d in allowed if d):
        logger.warning("Embed domain mismatch: host=%s allowed=%s", host, allowed)
        return JSONResponse(status_code=403, content={"detail": "Embed origin not allowed"})
    return None


class EmbedTokenMiddleware(BaseHTTPMiddleware):
    """Validate embed tokens for legacy DB tokens and JWT embed routes.

    Security invariants
    -------------------
    * Any exception during validation is treated as a *denial*, never a pass-through.
    * JWT embed tokens with a ``resource_id`` claim are always bound to the dashboard
      extracted from the URL.  If the URL cannot be parsed (``dashboard_id`` is None)
      the request is rejected when ``resource_id`` is present — fail-safe.
    * Legacy DB embed tokens are additionally filtered by ``dashboard_id`` so a token
      for dashboard A cannot be replayed against dashboard B.
    """

    async def dispatch(self, request: Request, call_next):
        if not _embed_protected_path(request.url.path):
            return await call_next(request)

        # --- token extraction ---
        token = (
            request.query_params.get("token")
            or request.headers.get("x-embed-token")
        )
        if not token:
            return JSONResponse(
                status_code=401, content={"detail": "Embed token required"}
            )

        # Wrap *all* validation in a try/except that returns 403 on any failure.
        # Never fall through to call_next on an exception.
        try:
            dashboard_id = _extract_dashboard_id_from_embed_path(request.url.path)

            # Prefer signed JWT embed tokens; legacy DB tokens optional via env.
            import os
            jwt_only = os.getenv("EMBED_JWT_ONLY", "true").strip().lower() in ("1", "true", "yes")
            if jwt_only and not token.startswith("eyJ"):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Legacy embed tokens disabled; use JWT embed tokens"},
                )

            if token.startswith("eyJ"):
                return await self._validate_jwt_token(
                    request, call_next, token, dashboard_id
                )

            return await self._validate_db_token(
                request, call_next, token, dashboard_id
            )

        except Exception as exc:
            logger.error("EmbedTokenMiddleware: unexpected error during validation: %s", exc)
            return JSONResponse(
                status_code=403,
                content={"detail": "Embed token validation failed"},
            )

    # ------------------------------------------------------------------
    # JWT path
    # ------------------------------------------------------------------
    async def _validate_jwt_token(
        self, request: Request, call_next, token: str, dashboard_id: Optional[str]
    ):
        try:
            from src.modules.embed import service as embed_service

            verified = await embed_service.verify_embed_token(
                token, required_scope="dashboard"
            )
            resource_id = verified.get("resource_id")

            # Binding check — fail-safe:
            # • If resource_id is set, dashboard_id must match.
            # • If dashboard_id could NOT be parsed from the URL and resource_id is
            #   set, we cannot verify the binding → reject.
            if resource_id:
                if not dashboard_id:
                    logger.warning(
                        "JWT embed token has resource_id=%s but dashboard_id could not "
                        "be parsed from path %r — rejecting (fail-safe).",
                        resource_id, request.url.path,
                    )
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Embed token binding could not be verified"},
                    )
                if str(resource_id) != str(dashboard_id):
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Embed token not valid for this dashboard"},
                    )

            domain_err = _check_embed_domain(request, verified.get("allowed_domains") or [])
            if domain_err:
                return domain_err

            request.state.embed_jwt = verified
            return await call_next(request)

        except Exception as exc:  # JWTError and anything else
            logger.warning("JWT embed token rejected: %s", exc)
            return JSONResponse(
                status_code=403,
                content={"detail": "Invalid embed token"},
            )

    # ------------------------------------------------------------------
    # Legacy DB token path
    # ------------------------------------------------------------------
    async def _validate_db_token(
        self, request: Request, call_next, token: str, dashboard_id: Optional[str]
    ):
        from src.modules.charts.models import DashboardEmbed
        from src.db.session import get_async_session

        async with get_async_session() as db:
            query = select(DashboardEmbed).where(
                DashboardEmbed.embed_token == token,
                DashboardEmbed.is_active == True,  # noqa: E712
            )
            # Always filter by dashboard_id when we have one.
            if dashboard_id:
                query = query.where(DashboardEmbed.dashboard_id == dashboard_id)
            res = await db.execute(query)
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

        return await call_next(request)


class LegacyDashboardDeprecationMiddleware(BaseHTTPMiddleware):
    """Add Deprecation/Link headers to legacy /charts/dashboards/* responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path or ""
        if path.startswith("/charts/dashboards"):
            try:
                from src.modules.charts.deprecation import apply_dashboard_deprecation

                apply_dashboard_deprecation(response)
            except Exception as exc:
                logger.debug("Failed to apply dashboard deprecation headers: %s", exc)
        return response


# ---------------------------------------------------------------------------
# Prometheus HTTP metrics
# ---------------------------------------------------------------------------

try:
    from prometheus_client import Counter as _PromCounter, Histogram as _PromHistogram

    _HTTP_REQUESTS_TOTAL = _PromCounter(
        "http_requests_total",
        "Total HTTP requests",
        ["method", "path", "status"],
    )
    _HTTP_REQUEST_DURATION_SECONDS = _PromHistogram(
        "http_request_duration_seconds",
        "HTTP request latency in seconds",
        ["method", "path"],
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
    )
    _PROMETHEUS_METRICS_ENABLED = True
except ImportError:
    _PROMETHEUS_METRICS_ENABLED = False

_METRICS_SKIP_PATHS = frozenset({"/metrics", "/health"})


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    if route is not None and getattr(route, "path", None):
        return route.path
    return request.url.path


class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not _PROMETHEUS_METRICS_ENABLED or request.url.path in _METRICS_SKIP_PATHS:
            return await call_next(request)

        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start

        method = request.method
        path = _route_template(request)
        status = str(response.status_code)

        _HTTP_REQUESTS_TOTAL.labels(method=method, path=path, status=status).inc()
        _HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path=path).observe(duration)
        return response
