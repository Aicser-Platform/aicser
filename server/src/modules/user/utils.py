"""Shared helpers for the user module."""


def mask_key(key: str, visible_tail: int = 4) -> str:
    """Return masked key for API responses. Never log or return full keys."""
    if not key or len(key) <= visible_tail:
        return "••••"
    return "••••••••••••" + key[-visible_tail:]
