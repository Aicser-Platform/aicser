"""Delegated agent tokens: short-lived, scoped, revocable per run.

An agent run acts as a named person, never as a service account. When a run needs a
credential outside the server process — the desktop device agent calling back, a
scheduled run resuming later — it gets a delegated token instead of the person's session:

- ``sub`` is the person; ``act`` names the agent and the run it belongs to (RFC 8693 style)
- ``scope`` limits what it can do; ``exp`` is minutes, not days
- revoking the run (or every session of the person) revokes the token

Normal sign-in rejects these tokens (service.decode_access_token).
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

from jose import JWTError, jwt

from src.core.cache import cache
from src.core.config import settings
from src.modules.authentication.service import ALGORITHM, _is_revoked

DEFAULT_TTL_SECONDS = 15 * 60
MAX_TTL_SECONDS = 12 * 60 * 60
_REVOKED_RUN_PREFIX = "auth:revoked_agent_run:"


def mint_delegated_token(
    *,
    user_id: str,
    organization_id: Optional[str],
    run_id: str,
    scopes: Iterable[str],
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    actor: str = "aicser-agent",
) -> str:
    scope_list = sorted({s.strip() for s in scopes if s and s.strip()})
    if not scope_list:
        raise ValueError("A delegated token needs at least one scope")
    ttl = max(60, min(int(ttl_seconds), MAX_TTL_SECONDS))
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "delegated",
        "org": str(organization_id) if organization_id else None,
        "scope": " ".join(scope_list),
        "act": {"sub": actor, "run": str(run_id)},
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_delegated_token(token: str, *, required_scopes: Iterable[str] = ()) -> dict:
    """Raise JWTError unless the token is a live delegated token holding every required scope."""
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("type") != "delegated":
        raise JWTError("Not a delegated agent token")
    run_id = str((payload.get("act") or {}).get("run") or "")
    if not run_id:
        raise JWTError("Delegated token names no run")
    if _is_revoked(payload) or (cache and cache.exists(f"{_REVOKED_RUN_PREFIX}{run_id}")):
        raise JWTError("Token has been revoked")
    held = set(str(payload.get("scope") or "").split())
    missing = [s for s in required_scopes if s not in held]
    if missing:
        raise JWTError(f"Token lacks scope: {', '.join(missing)}")
    return payload


def token_scopes(payload: dict) -> List[str]:
    return str(payload.get("scope") or "").split()


def revoke_run_tokens(run_id: str) -> None:
    """Revoke every delegated token minted for a run (run cancelled, finished or stopped by an admin)."""
    if cache:
        cache.set(f"{_REVOKED_RUN_PREFIX}{run_id}", int(time.time()), ttl=MAX_TTL_SECONDS)
