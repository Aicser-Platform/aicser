"""Shared auth_token httpOnly cookie helpers."""

from __future__ import annotations

import os

from fastapi import Response

AUTH_COOKIE_NAME = "auth_token"
AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days


def auth_cookie_secure() -> bool:
    """
    Whether auth_token cookie uses Secure flag.

    Set COOKIE_SECURE=true only behind HTTPS (production). Default is false so
    local Docker / HTTP dev stacks still receive the session cookie.
    """
    explicit = os.getenv("COOKIE_SECURE", "").strip().lower()
    if explicit in ("1", "true", "yes"):
        return True
    if explicit in ("0", "false", "no"):
        return False
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
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
