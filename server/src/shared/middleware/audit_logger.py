# AISER EE-ONLY — requires AISER_EDITION=enterprise
"""
Global Audit Logging Middleware.

Records all auth events, data access, AI queries, and admin actions to:
1. Application logs (always)
2. PostgreSQL audit_logs table (when available)
3. Redis stream (for real-time monitoring dashboards)

Audit event categories:
- auth: login, logout, token_refresh, token_invalid
- data: data_source_connect, data_source_query, schema_access
- ai: chat_query, nl2sql, chart_generate, report_generate
- admin: user_create, user_update, org_update, plan_change
- billing: subscription_change, payment_success, payment_failed
- governance: pii_access, policy_violation, data_export
"""
import json
import logging
import time
import os
from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("aiser.audit")

# Paths to audit (method, path_prefix)
_AUDIT_PATTERNS = [
    ("POST", "/chat"),
    ("POST", "/api/ai/analyze"),
    ("POST", "/analyze"),
    ("POST", "/api/queries"),
    ("GET", "/data/sources"),
    ("POST", "/data/sources"),
    ("POST", "/data/sources"),
    ("GET", "/charts/dashboards"),
    ("POST", "/charts/dashboards"),
    ("GET", "/api/dashboards"),
    ("POST", "/api/dashboards"),
    ("GET", "/knowledge"),
    ("POST", "/knowledge"),
    ("GET", "/api/embed"),
    ("POST", "/api/embed"),
    ("POST", "/echarts"),
    ("POST", "/api/users"),
    ("POST", "/auth"),
    ("POST", "/api/semantic"),
    ("POST", "/api/jobs"),
]

_AUDIT_ALWAYS_LOG_STATUS = {401, 403, 429, 500}

AUDIT_ENABLED = os.getenv("AUDIT_LOGGING_ENABLED", "true").lower() in ("true", "1", "yes")
AUDIT_DB_ENABLED = os.getenv("AUDIT_DB_LOGGING_ENABLED", "true").lower() in ("true", "1", "yes")


async def _write_audit_db(event: Dict[str, Any]) -> None:
    """Write audit event to PostgreSQL."""
    try:
        from sqlalchemy import text as sa_text
        from src.db.session import async_session
        import uuid

        async with async_session() as db:
            await db.execute(sa_text("""
                INSERT INTO audit_logs
                    (id, event_type, category, user_id, org_id, resource_type,
                     resource_id, action, ip_address, user_agent, request_id,
                     status_code, duration_ms, metadata, created_at)
                VALUES
                    (:id, :event_type, :category, :user_id, :org_id, :resource_type,
                     :resource_id, :action, :ip, :ua, :req_id,
                     :status, :duration, :metadata, :now)
            """), {
                "id": str(uuid.uuid4()),
                "event_type": event.get("event_type", "api_request"),
                "category": event.get("category", "api"),
                "user_id": event.get("user_id"),
                "org_id": event.get("org_id"),
                "resource_type": event.get("resource_type"),
                "resource_id": event.get("resource_id"),
                "action": event.get("action"),
                "ip": event.get("ip_address"),
                # RELIABILITY: event.get("user_agent", "") only falls back to ""
                # when the key is ABSENT -- every caller so far always sets it
                # (AuditLoggingMiddleware extracts a real header string, "" at
                # worst), so this never crashed in practice. circuit_breaker.py's
                # own log_audit_event() call is the first caller that leaves
                # user_agent as its default None (an explicit key with value
                # None, not a missing one), and None[:255] raised
                # "'NoneType' object is not subscriptable" -- caught by this
                # function's own try/except, so the write silently never
                # happened at all instead of erroring loudly.
                "ua": (event.get("user_agent") or "")[:255],
                "req_id": event.get("request_id"),
                "status": event.get("status_code"),
                "duration": event.get("duration_ms"),
                "metadata": json.dumps(event.get("metadata", {})),
                "now": datetime.utcnow(),
            })
            await db.commit()
    except Exception as e:
        logger.debug(f"Audit DB write failed (non-fatal): {e}")


async def log_audit_event(
    event_type: str,
    category: str = "api",
    user_id: Optional[str] = None,
    org_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    action: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    request_id: Optional[str] = None,
    status_code: Optional[int] = None,
    duration_ms: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Log an audit event. Non-blocking and non-fatal."""
    if not AUDIT_ENABLED:
        return

    # The auth token that reaches the middleware rarely carries an explicit
    # organization_id claim — org membership is resolved from the DB
    # (UserRole) everywhere else in the app, e.g. get_user_organization_id()
    # used by the actual data/chart/chat endpoints. Without the same fallback
    # here, every audit row reads org=None even for a user who very much has
    # an org, defeating the point of an org-scoped audit trail. This function
    # already only runs inside a background asyncio task (see dispatch()
    # below), so the extra DB lookup never adds latency to the real response.
    if user_id and not org_id:
        try:
            from src.db.session import async_session
            from src.modules.pricing.feature_gate import get_user_organization_id

            async with async_session() as audit_db:
                org_id = await get_user_organization_id(user_id, audit_db)
        except Exception:
            pass

    event = {
        "event_type": event_type,
        "category": category,
        "user_id": user_id,
        "org_id": org_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "ip_address": ip_address,
        "user_agent": user_agent,
        "request_id": request_id,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "metadata": metadata or {},
        "timestamp": datetime.utcnow().isoformat(),
    }

    # Always log to application logger
    logger.info(
        f"AUDIT [{category.upper()}] {event_type} user={user_id} org={org_id} "
        f"action={action} resource={resource_type}:{resource_id} status={status_code}"
    )

    # Write to DB asynchronously
    if AUDIT_DB_ENABLED:
        try:
            import asyncio
            asyncio.create_task(_write_audit_db(event))
        except RuntimeError:
            pass  # No event loop (test context)


class AuditLoggingMiddleware(BaseHTTPMiddleware):
    """
    Starlette middleware that logs API requests matching audit patterns.
    Extracts user context from JWT token if present.
    """

    def _should_audit(self, method: str, path: str, status: int) -> bool:
        if status in _AUDIT_ALWAYS_LOG_STATUS:
            return True
        for m, prefix in _AUDIT_PATTERNS:
            if method.upper() == m.upper() and path.startswith(prefix):
                return True
        return False

    def _extract_resource(self, path: str) -> tuple:
        """Extract resource_type and resource_id from URL path."""
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 2:
            return parts[-2] if len(parts) > 1 else parts[0], parts[-1]
        return path, None

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        request_id = request.headers.get("X-Request-ID") or request.headers.get("X-Correlation-ID")
        ip = request.client.host if request.client else "unknown"
        ua = request.headers.get("User-Agent", "")[:255]
        method = request.method
        path = request.url.path

        response = await call_next(request)
        duration_ms = int((time.time() - start) * 1000)
        status = response.status_code

        if not self._should_audit(method, path, status):
            return response

        # Extract user from auth state (set by JWTCookieBearer). Mirrors
        # JWTCookieBearer.__call__'s own token-source AND decode precedence
        # exactly (auth_bearer.py), both of which used to diverge here:
        #
        # 1. Source: Authorization header first, falling back to the
        #    auth_token cookie. Header-only used to be checked here — any
        #    request the actual endpoint authenticated via the cookie alone
        #    (no Authorization header, e.g. a plain browser navigation/fetch)
        #    still passed auth and returned 200, but was logged user=None.
        #
        # 2. Decode: the app's default JWT format (create_access_token/
        #    decode_access_token — HS256 + SECRET_KEY, sub/email/exp/iat/jti)
        #    is NOT what extract_user_id_from_token decodes — that function
        #    is the Supabase-JWKS / dev-unverified-fallback path, a different
        #    token shape entirely. It silently returns {} for a standard CE
        #    token (confirmed live), which is falsy, so user_id stayed None
        #    even when a token WAS present and the endpoint's own auth
        #    (which tries decode_access_token FIRST) accepted it just fine.
        #    Trying decode_access_token first, then falling back to
        #    extract_user_id_from_token for Supabase/Keycloak/dev tokens,
        #    matches what the endpoint itself actually does.
        user_id = None
        org_id = None
        try:
            token = None
            auth = request.headers.get("Authorization", "")
            if auth.lower().startswith("bearer "):
                header_token = auth.split(None, 1)[1].strip()
                if len(header_token) > 10 and header_token not in ("test-token",):
                    token = header_token
            if not token:
                cookie_token = request.cookies.get("auth_token")
                if cookie_token and cookie_token.strip() not in ("", "null"):
                    token = cookie_token.strip()
            if token:
                payload = None
                try:
                    from src.modules.authentication.service import decode_access_token

                    ce_payload = decode_access_token(token)
                    if ce_payload.get("sub"):
                        payload = ce_payload
                except Exception:
                    payload = None
                if not payload:
                    from src.modules.authentication.deps.auth_bearer import extract_user_id_from_token

                    payload = extract_user_id_from_token(token)
                if payload:
                    user_id = payload.get("id") or payload.get("user_id") or payload.get("sub")
                    org_id = payload.get("organization_id")
        except Exception:
            pass

        resource_type, resource_id = self._extract_resource(path)

        # Categorize the event
        category = "api"
        if "/auth" in path or "/login" in path:
            category = "auth"
        elif "/data" in path or "/sources" in path:
            category = "data"
        elif "/chat" in path or "/analyze" in path or "/echarts" in path or "/nl2sql" in path:
            category = "ai"
        elif "/admin" in path or "/users" in path or "/api/organizations" in path:
            category = "admin"
        elif "/billing" in path or "/subscriptions" in path:
            category = "billing"
        elif "/semantic" in path or "/governance" in path or "/knowledge" in path:
            category = "governance"
        elif "/embed" in path:
            category = "governance"

        try:
            import asyncio
            asyncio.create_task(log_audit_event(
                event_type=f"{method.lower()}_{resource_type}",
                category=category,
                user_id=user_id,
                org_id=org_id,
                resource_type=resource_type,
                resource_id=resource_id,
                action=f"{method} {path}",
                ip_address=ip,
                user_agent=ua,
                request_id=request_id,
                status_code=status,
                duration_ms=duration_ms,
                metadata={"path": path, "method": method},
            ))
        except Exception:
            pass

        return response
