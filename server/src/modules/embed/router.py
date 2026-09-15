from __future__ import annotations

import logging
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.modules.embed.schemas import (
    EmbedTheme,
    EmbedTokenCreateRequest,
    EmbedTokenCreatedResponse,
    EmbedTokenListResponse,
    EmbedTokenResponse,
    EmbedTokenRevokeResponse,
    EmbedTokenUpdateRequest,
    EmbedTokenVerifyResponse,
)
from src.modules.embed import service as embed_service
from src.modules.pricing.feature_gate import get_user_organization_id, org_entitlement
from src.shared.access_control import enforce_permission

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_user_id(current_token: Union[str, dict]) -> str:
    payload = extract_user_payload(current_token) if not isinstance(current_token, dict) else current_token
    user_id = str(payload.get("id") or payload.get("user_id") or payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user_id


async def _require_embed_analytics_entitlement(org_id: Optional[str], db: AsyncSession) -> None:
    """Embed token creation/editing is a paid capability (Pro+) — see
    ee/modules/pricing/plans.py's embed_analytics feature. RBAC's
    embed:create only checks *role* (are you an admin in this org), never
    *plan* (does this org's subscription include embedding at all), so a
    Free-org admin could otherwise mint unlimited embed tokens identical to
    a paid org's."""
    ok, reason = await org_entitlement(org_id, db, "embed_analytics")
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "message": reason or "Embed analytics requires the Pro plan or higher.",
                "feature": "embed_analytics",
                "upgrade_required": True,
                "required_plan": "pro",
            },
        )


async def _enforce_white_label_entitlement(
    theme: Optional[EmbedTheme], org_id: Optional[str], db: AsyncSession
) -> Optional[EmbedTheme]:
    """Removing the Aicser badge (theme.hide_aicser_branding) is Team+ only
    (embed_white_label). A Pro-org client could otherwise set this flag
    directly in the request body regardless of what the Settings UI exposes
    — server-side is the only enforcement that actually counts."""
    if not theme or not theme.hide_aicser_branding:
        return theme
    ok, reason = await org_entitlement(org_id, db, "embed_white_label")
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "message": reason or "Removing Aicser branding from embeds requires the Team plan or higher.",
                "feature": "embed_white_label",
                "upgrade_required": True,
                "required_plan": "team",
            },
        )
    return theme


@router.post("/tokens", response_model=EmbedTokenCreatedResponse)
async def create_embed_token(
    body: EmbedTokenCreateRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a signed JWT embed token with dashboard/chart/chat scopes."""
    user_id = _require_user_id(current_token)
    org_id = await get_user_organization_id(user_id, db)
    # Scoped to org_id — `enforce_permission(user_id, "embed:create")` with no
    # org context checks ALL of the user's role assignments across every org
    # they belong to, so an org_admin in Org A (where embed:create is
    # legitimately theirs) could mint dashboard-embed tokens for Org B too,
    # where they're only a regular member without that permission. Passing
    # org_id scopes the check to the org this token is actually being minted
    # for, matching the per-org RBAC model the role seed data intends.
    await enforce_permission(user_id, "embed:create", organization_id=org_id)
    await _require_embed_analytics_entitlement(org_id, db)
    theme = await _enforce_white_label_entitlement(body.theme, org_id, db)
    try:
        created = await embed_service.create_embed_token(
            user_id=user_id,
            org_id=org_id,
            name=body.name,
            scopes=list(body.scopes),
            resource_id=body.resource_id,
            allowed_domains=body.allowed_domains,
            expires_in_hours=body.expires_in_hours,
            theme=theme.model_dump() if theme else None,
        )
        return EmbedTokenCreatedResponse(**created)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to create embed token: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create embed token") from exc


@router.get("/tokens", response_model=EmbedTokenListResponse)
async def list_embed_tokens(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """List embed tokens for the current user (JWT values are not returned)."""
    user_id = _require_user_id(current_token)
    tokens = await embed_service.list_embed_tokens(user_id)
    return EmbedTokenListResponse(tokens=[EmbedTokenResponse(**t) for t in tokens])


@router.patch("/tokens/{token_id}", response_model=EmbedTokenResponse)
async def update_embed_token_theme(
    token_id: str,
    body: EmbedTokenUpdateRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Theme-only edit — the embed token/URLs stay valid; only the branding changes."""
    user_id = _require_user_id(current_token)
    existing = await embed_service.get_embed_token_record(user_id, token_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Embed token not found")
    org_id = existing.get("org_id")
    # Scoped to the token's own org — same fix as create_embed_token's, for
    # the same reason: an unscoped check matches ANY org this user has
    # embed:create in, not necessarily the org this specific token belongs to.
    await enforce_permission(user_id, "embed:create", organization_id=org_id)
    theme = await _enforce_white_label_entitlement(body.theme, org_id, db)
    updated = await embed_service.update_embed_token_theme(
        user_id, token_id, theme.model_dump() if theme else None
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Embed token not found")
    return EmbedTokenResponse(**updated)


@router.delete("/tokens/{token_id}", response_model=EmbedTokenRevokeResponse)
async def revoke_embed_token(
    token_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Revoke an embed token by id."""
    user_id = _require_user_id(current_token)
    existing = await embed_service.get_embed_token_record(user_id, token_id)
    org_id = existing.get("org_id") if existing else None
    # Scoped to the token's own org — same reasoning as create/update above.
    await enforce_permission(user_id, "embed:manage", organization_id=org_id)
    revoked = await embed_service.revoke_embed_token(user_id, token_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Embed token not found")
    return EmbedTokenRevokeResponse(id=token_id)


@router.get("/tokens/verify", response_model=EmbedTokenVerifyResponse)
async def verify_embed_token(
    token: str,
    scope: str | None = None,
    db: AsyncSession = Depends(get_async_session),
):
    """Verify an embed JWT (used by embed viewers and integrations).

    Also the actual "view" checkpoint for embed billing: every embed page
    load calls this once, so it's where embed_views gets metered and where
    a plan downgrade takes effect immediately (a token minted while on Team
    doesn't keep white-labeling or working at all once the org drops below
    the plan that granted it — enforcement lives at read time, not just at
    token-creation time).
    """
    try:
        result = await embed_service.verify_embed_token(token, required_scope=scope)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    org_id = result.get("org_id")
    if org_id:
        from src.modules.pricing.usage_tracker import track_embed_view

        ok, reason = await org_entitlement(org_id, db, "embed_analytics")
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"message": reason or "Embed analytics requires the Pro plan or higher.", "feature": "embed_analytics"},
            )

        within_limit, usage_reason = await track_embed_view(org_id, db)
        if not within_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"message": usage_reason, "feature": "embed_views_limit", "upgrade_required": True},
            )

        theme = result.get("theme")
        if theme and theme.get("hide_aicser_branding"):
            white_label_ok, _ = await org_entitlement(org_id, db, "embed_white_label")
            if not white_label_ok:
                result["theme"] = {**theme, "hide_aicser_branding": False}

    return EmbedTokenVerifyResponse(**result)
