"""Read-only license status API — powers the Settings > License page.
No write/activation endpoint by design (see spec "Activation UX") — the
license key is set via AISER_EDITION_LICENSE_KEY at deploy time only."""
from __future__ import annotations

from typing import Union

from fastapi import APIRouter, Depends

from src.core.licensing.state import state
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission

router = APIRouter()


@router.get("/status")
async def get_license_status(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> dict:
    user_payload = current_token if isinstance(current_token, dict) else {}
    user_id = str(user_payload.get("id") or user_payload.get("user_id") or user_payload.get("sub") or "")
    await require_permission(
        user_id,
        "org:edit",
        organization_id=str(user_payload.get("organization_id") or user_payload.get("org_id") or "") or None,
        project_id=None,
    )

    return {
        "requires_validation": state.requires_validation(),
        "is_valid": state.is_valid,
        "license_id": state.license_id,
        "customer_id": state.customer_id,
        "max_users": state.max_users,
        "features": state.features,
        "expires_at": state.expires_at.isoformat() if state.expires_at else None,
        "last_validated_at": state.last_validated_at.isoformat() if state.last_validated_at else None,
        "last_error": state.last_error,
    }
