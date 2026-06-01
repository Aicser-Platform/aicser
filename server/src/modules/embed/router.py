from __future__ import annotations

import logging
from typing import Union

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.modules.embed.schemas import (
    EmbedTokenCreateRequest,
    EmbedTokenCreatedResponse,
    EmbedTokenListResponse,
    EmbedTokenResponse,
    EmbedTokenRevokeResponse,
    EmbedTokenVerifyResponse,
)
from src.modules.embed import service as embed_service
from src.modules.pricing.feature_gate import get_user_organization_id
from src.shared.access_control import enforce_permission

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_user_id(current_token: Union[str, dict]) -> str:
    payload = extract_user_payload(current_token) if not isinstance(current_token, dict) else current_token
    user_id = str(payload.get("id") or payload.get("user_id") or payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user_id


@router.post("/tokens", response_model=EmbedTokenCreatedResponse)
async def create_embed_token(
    body: EmbedTokenCreateRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a signed JWT embed token with dashboard/chart/chat scopes."""
    user_id = _require_user_id(current_token)
    await enforce_permission(user_id, "embed:create")
    org_id = await get_user_organization_id(user_id, db)
    try:
        created = await embed_service.create_embed_token(
            user_id=user_id,
            org_id=org_id,
            name=body.name,
            scopes=list(body.scopes),
            resource_id=body.resource_id,
            allowed_domains=body.allowed_domains,
            expires_in_hours=body.expires_in_hours,
        )
        return EmbedTokenCreatedResponse(**created)
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


@router.delete("/tokens/{token_id}", response_model=EmbedTokenRevokeResponse)
async def revoke_embed_token(
    token_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Revoke an embed token by id."""
    user_id = _require_user_id(current_token)
    await enforce_permission(user_id, "embed:manage")
    revoked = await embed_service.revoke_embed_token(user_id, token_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Embed token not found")
    return EmbedTokenRevokeResponse(id=token_id)


@router.get("/tokens/verify", response_model=EmbedTokenVerifyResponse)
async def verify_embed_token(token: str, scope: str | None = None):
    """Verify an embed JWT (used by embed viewers and integrations)."""
    try:
        result = await embed_service.verify_embed_token(token, required_scope=scope)
        return EmbedTokenVerifyResponse(**result)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
