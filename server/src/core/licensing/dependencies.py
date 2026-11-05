"""FastAPI dependency enforcing license validity on EE routes.

The entire enforcement surface for this feature — applied to the existing
include_router(...) calls inside router.py's `if is_ee_enabled():` block, not
the ~100 other is_ee_enabled() call sites elsewhere in the codebase.
"""
from fastapi import HTTPException, Request, status

from src.core.licensing.state import state

READ_METHODS = ("GET", "HEAD", "OPTIONS")


async def require_valid_license(request: Request) -> None:
    """Refuse EE routes without a license. An instance whose license has ended stays readable,
    so people can still see and export their work; it just can't change anything."""
    if not state.requires_validation() or state.usable():
        return
    if state.license_id and request.method in READ_METHODS:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This license has ended, so Aicser is read-only." if state.license_id
        else "No valid Enterprise license for this instance.",
    )
