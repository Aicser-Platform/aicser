"""FastAPI dependency enforcing license validity on EE routes.

The entire enforcement surface for this feature — applied to the existing
include_router(...) calls inside router.py's `if is_ee_enabled():` block, not
the ~100 other is_ee_enabled() call sites elsewhere in the codebase.
"""
from fastapi import HTTPException, status

from src.core.licensing.state import state


async def require_valid_license() -> None:
    if not state.requires_validation():
        return
    if not state.is_valid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No valid Enterprise license for this instance.",
        )
