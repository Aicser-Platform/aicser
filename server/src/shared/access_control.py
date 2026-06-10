"""
CE-safe access control helpers.

Requires authentication on all protected routes. When Enterprise Edition is
enabled, optionally enforces RBAC permission codes via the EE RBACService shim.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional, Union

from fastapi import HTTPException, status

from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)


def extract_user_id(token: Union[str, dict, None]) -> str:
    """Extract canonical user id from JWT payload."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    if isinstance(token, dict):
        uid = token.get("id") or token.get("user_id") or token.get("sub")
        if uid:
            return str(uid)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="User ID not found in token",
    )


def normalize_uuid(raw_id: str) -> str:
    """Return a valid UUID string; derive deterministic UUID for short test ids."""
    try:
        uuid.UUID(str(raw_id))
        return str(raw_id)
    except (ValueError, AttributeError, TypeError):
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"aicser-user-{raw_id}"))


async def enforce_permission(
    user_id: str,
    permission_code: str,
    *,
    organization_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> None:
    """
    Enforce RBAC when EE is enabled; no-op in CE (auth-only deployments).
    """
    if not is_ee_enabled():
        return

    try:
        from src.modules.authentication.rbac.rbac_service import RBACService
    except ImportError:
        logger.debug("RBACService unavailable; skipping permission %s", permission_code)
        return

    allowed = await RBACService.check_permission(
        user_id=user_id,
        permission_code=permission_code,
        organization_id=organization_id,
        project_id=project_id,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: requires '{permission_code}'",
        )


async def check_dashboard_access(
    user_payload: Any,
    dashboard_id: str,
) -> None:
    """Raise HTTPException if user cannot view the dashboard."""
    from src.modules.authentication.rbac_service import has_dashboard_access

    if not await has_dashboard_access(user_payload, dashboard_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to dashboard",
        )
