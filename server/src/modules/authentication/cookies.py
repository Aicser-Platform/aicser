"""Shared auth_token httpOnly cookie helpers."""

from __future__ import annotations

import logging
import os

from fastapi import Response

logger = logging.getLogger(__name__)

AUTH_COOKIE_NAME = "auth_token"
AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days

_warned_insecure_production = False


def auth_cookie_secure() -> bool:
    """
    Whether auth_token cookie uses Secure flag.

    Set COOKIE_SECURE=true only behind HTTPS. Default is false so local
    Docker / HTTP-served stacks still receive the session cookie.

    CORRECTNESS: a prior pass here forced Secure=true whenever
    ENVIRONMENT=production, reasoning that production implies HTTPS. That
    doesn't hold for this self-host EE stack: ENVIRONMENT=production is set
    to mean "the real deployed stack" (as opposed to a dev container), not
    "served over TLS" -- deploy/docker-compose.ee.yml's own defaults
    (FRONTEND_URL=http://localhost:3001, NEXT_PUBLIC_API_URL=http://
    localhost:8001) are plain HTTP. Forcing Secure broke login entirely for
    that default configuration: browsers silently refuse to store or send a
    Secure-flagged cookie over a non-HTTPS origin, so every request looked
    unauthenticated. Reverted to trusting the operator's own COOKIE_SECURE
    setting (the only thing that actually knows whether TLS is terminated
    somewhere in front of this deployment); a startup-time warning below
    covers the "forgot to set it" case without breaking anyone.
    """
    explicit = os.getenv("COOKIE_SECURE", "").strip().lower()
    if explicit in ("1", "true", "yes"):
        return True
    if explicit in ("0", "false", "no"):
        return False

    global _warned_insecure_production
    if not _warned_insecure_production:
        try:
            from src.core.production import is_production

            if is_production():
                logger.warning(
                    "COOKIE_SECURE is not set in a production environment -- the session "
                    "cookie is being sent without the Secure flag. If this deployment is "
                    "reachable over HTTPS (directly or via a reverse proxy), set "
                    "COOKIE_SECURE=true. If it's served over plain HTTP (e.g. localhost-only "
                    "self-host), this is expected and safe to ignore."
                )
        except Exception:
            pass
        _warned_insecure_production = True

    return False


def set_auth_token_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=auth_cookie_secure(),
        samesite="lax",
        max_age=AUTH_COOKIE_MAX_AGE,
        path="/",
    )


def clear_auth_token_cookie(response: Response) -> None:
    # Must match set_auth_token_cookie attributes or Secure cookies survive logout.
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path="/",
        secure=auth_cookie_secure(),
        httponly=True,
        samesite="lax",
    )
