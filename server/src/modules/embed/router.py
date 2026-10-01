from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled
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
    EmbedSessionRequest,
    EmbedSessionResponse,
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


async def _require_resource_access(db: AsyncSession, resource_id: Optional[str], scopes: list, user_id: str) -> None:
    """The token's creator must be able to see what it embeds; otherwise anyone allowed to
    create embeds could publish any dashboard, chart or report by knowing its id."""
    if resource_id and "chart" in scopes:
        await _require_chart_access(db, resource_id, user_id)
    if resource_id and "report" in scopes:
        await _require_report_access(db, resource_id, user_id)
    if resource_id and "dashboard" in scopes:
        from uuid import UUID

        from src.modules.dashboards.operations import verify_dashboard_read_access

        try:
            dashboard_uuid = UUID(str(resource_id))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Dashboard not found") from exc
        await verify_dashboard_read_access(db, dashboard_uuid, current_user={"id": user_id, "sub": user_id})


async def _require_chart_access(db: AsyncSession, chart_id: str, user_id: str) -> None:
    """A chart embeds only if its creator made it, or can view dashboards in its project."""
    from uuid import UUID

    from src.modules.charts.models import Chart

    try:
        chart_uuid = UUID(str(chart_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Chart not found") from exc

    row = (
        await db.execute(
            select(Chart.user_id, Chart.project_id).where(
                Chart.id == chart_uuid,
                Chart.is_deleted.is_(False),
            )
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Chart not found")
    if row.user_id and str(row.user_id) == str(user_id):
        return
    if not row.project_id:
        raise HTTPException(status_code=404, detail="Chart not found")
    await enforce_permission(user_id, "dashboard:view", project_id=str(row.project_id))


async def _require_report_access(db: AsyncSession, report_id: str, user_id: str) -> None:
    """A report ("conversationId:messageId") embeds only from the creator's own conversation."""
    from uuid import UUID

    from sqlalchemy import text

    # Reports live in EE chats; CE has no conversation table to check against.
    if not is_ee_enabled():
        raise HTTPException(status_code=404, detail="Report not found")

    conversation_id = str(report_id).split(":", 1)[0]
    try:
        UUID(conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Report not found") from exc

    try:
        row = (
            await db.execute(
                text(
                    "SELECT user_id FROM conversation "
                    "WHERE CAST(id AS TEXT) = :id AND COALESCE(is_deleted, false) = false"
                ),
                {"id": conversation_id},
            )
        ).mappings().first()
    except Exception as exc:
        # Table missing or EE schema not migrated yet.
        raise HTTPException(status_code=404, detail="Report not found") from exc
    if not row or str(row["user_id"]) != str(user_id):
        raise HTTPException(status_code=404, detail="Report not found")


class EmbedSignRequest(BaseModel):
    """Server-to-server: a host app mints a short-lived embed for one of its customers."""
    # A report's id is "conversationId:messageId" (two UUIDs).
    resource_id: str = Field(..., min_length=1, max_length=80)
    # What to embed; dashboards unless said otherwise (the SDK's original behaviour).
    scope: Literal["dashboard", "chart", "report"] = "dashboard"
    locked_filters: List[Dict[str, Any]] = Field(default_factory=list, max_length=10)
    expires_in_minutes: int = Field(60, ge=5, le=1440)
    allowed_domains: List[str] = Field(default_factory=list, max_length=20)
    download: Literal["none", "image", "data"] = "none"


@router.post("/sign")
async def sign_embed(body: EmbedSignRequest, request: Request, db: AsyncSession = Depends(get_async_session)):
    """Called by the host app's backend with an Aicser API key (Authorization: Bearer aiser_sk_…).
    Returns a token and URL for an iframe; every query made with it is pinned to the locked
    filters (e.g. {"field": "tenant_id", "value": "acme"}) and runs with the key owner's access."""
    from src.modules.user.api_keys import verify_api_key

    auth = request.headers.get("authorization") or ""
    ident = await verify_api_key(auth.split(" ", 1)[1].strip()) if auth.lower().startswith("bearer ") else None
    if ident is None:
        raise HTTPException(status_code=401, detail="A valid Aicser API key is required.")
    org_id = ident.organization_id or await get_user_organization_id(ident.user_id, db)
    await enforce_permission(ident.user_id, "embed:create", organization_id=org_id)
    await _require_embed_analytics_entitlement(org_id, db)
    await _require_resource_access(db, body.resource_id, [body.scope], ident.user_id)
    created = await embed_service.create_embed_token(
        user_id=ident.user_id,
        org_id=org_id,
        name=f"[signed] {body.scope} {body.resource_id}",
        scopes=[body.scope],
        resource_id=body.resource_id,
        allowed_domains=body.allowed_domains,
        expires_in_minutes=body.expires_in_minutes,
        locked_filters=body.locked_filters,
        kind="signed",
        download=body.download,
    )
    return {
        "token": created["token"],
        "url": created["embed_urls"].get(body.scope),
        "expires_at": created["expires_at"],
        "single_use": True,
    }


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
    await _require_resource_access(db, body.resource_id, list(body.scopes), user_id)
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
            download=body.download,
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
    """Verify an embed JWT (for integrations; embed pages open a session with POST /session).

    Metered as a view like a session open, and checked against the plan at read time, so a
    token minted while on Team doesn't keep white-labeling or working once the org drops below
    the plan that granted it."""
    try:
        result = await embed_service.verify_embed_token(token, required_scope=scope, allow_link=True)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    org_id = result.get("org_id")
    if org_id:
        await _meter_embed_open(org_id, db)

        theme = result.get("theme")
        if theme and theme.get("hide_aicser_branding"):
            white_label_ok, _ = await org_entitlement(org_id, db, "embed_white_label")
            if not white_label_ok:
                result["theme"] = {**theme, "hide_aicser_branding": False}

    return EmbedTokenVerifyResponse(**result)


async def _require_embed_plan(org_id: Optional[str], db: AsyncSession) -> None:
    """The org's plan must include embedding (checked at read time, so a downgrade applies on
    the next open)."""
    if not org_id:
        return
    ok, reason = await org_entitlement(org_id, db, "embed_analytics")
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"message": reason or "Embed analytics requires the Pro plan or higher.", "feature": "embed_analytics"},
        )


async def _count_embed_view(org_id: Optional[str], db: AsyncSession) -> None:
    """One metered view per opened embed (not per data request): billing reflects audience."""
    if not org_id:
        return
    from src.modules.pricing.usage_tracker import track_embed_view

    within_limit, usage_reason = await track_embed_view(org_id, db)
    if not within_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"message": usage_reason, "feature": "embed_views_limit", "upgrade_required": True},
        )


async def _meter_embed_open(org_id: Optional[str], db: AsyncSession) -> None:
    await _require_embed_plan(org_id, db)
    await _count_embed_view(org_id, db)


@router.post("/session", response_model=EmbedSessionResponse)
async def open_embed_session(body: EmbedSessionRequest, db: AsyncSession = Depends(get_async_session)):
    """Called by an embed page as it opens: trades the link token for a session token the page
    keeps in memory (never in a URL). Single-use links are consumed here, and the site showing
    the page must be one of the token's allowed sites."""
    try:
        # Plan first: a refusal must not use up a single-use link.
        await _require_embed_plan(embed_service.decode_embed_token(body.token).get("org_id"), db)
        opened = await embed_service.open_embed_session(
            body.token, parent_origin=(body.parent_origin or "").strip(), required_scope=body.scope
        )
    except embed_service.EmbedOriginError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except JWTError as exc:
        message = str(exc)
        if "expired" in message.lower():
            message = "This embed link has expired."
        elif "revoked" in message.lower():
            message = "This embed link was turned off by its owner."
        elif not ("already opened" in message or "scope" in message):
            message = "This embed link isn't valid."  # never echo token-library internals
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=message) from exc

    org_id = opened.get("org_id")
    if opened.get("metered", True):
        await _count_embed_view(org_id, db)
    theme = opened.get("theme")
    if org_id and theme and theme.get("hide_aicser_branding"):
        white_label_ok, _ = await org_entitlement(org_id, db, "embed_white_label")
        if not white_label_ok:
            theme = {**theme, "hide_aicser_branding": False}
    return EmbedSessionResponse(
        token=opened["token"],
        expires_at=opened.get("expires_at"),
        download=opened.get("download") or "none",
        theme=theme,
        single_use=bool(opened.get("single_use")),
        allowed_origins=list(opened.get("allowed_domains") or []),
    )
