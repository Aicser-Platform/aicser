"""Dashboard comments API — /api/dashboards/{dashboard_id}/comments

Saved, threaded comments that work in view or edit mode, with or without the live socket;
the socket (when connected) only makes other people's changes appear instantly.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.modules.authentication.rbac.guard import user_id_from_payload
from src.modules.dashboards import comments as svc
from src.shared.middleware.rate_limiter import rate_limit

router = APIRouter()


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=svc.MAX_BODY)
    widget_id: Optional[str] = Field(None, max_length=128)
    parent_id: Optional[UUID] = None


class CommentUpdate(BaseModel):
    body: Optional[str] = Field(None, min_length=1, max_length=svc.MAX_BODY)
    resolved: Optional[bool] = None


def _uid(current_token: dict) -> str:
    uid = user_id_from_payload(extract_user_payload(current_token))
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in to comment.")
    return uid


@router.get("")
async def list_comments(
    dashboard_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    current_token: dict = Depends(JWTCookieBearer()),
):
    await svc.authorize(db, _uid(current_token), dashboard_id)
    return {"threads": await svc.list_threads(db, dashboard_id)}


@router.post("", status_code=201)
@rate_limit(requests_per_minute=30, bucket="dashboard_comments")
async def create_comment(
    dashboard_id: UUID,
    payload: CommentCreate,
    db: AsyncSession = Depends(get_async_session),
    current_token: dict = Depends(JWTCookieBearer()),
):
    return await svc.create(
        db, dashboard_id, _uid(current_token), payload.body,
        widget_id=payload.widget_id, parent_id=str(payload.parent_id) if payload.parent_id else None,
    )


@router.patch("/{comment_id}")
@rate_limit(requests_per_minute=30, bucket="dashboard_comments")
async def update_comment(
    dashboard_id: UUID,
    comment_id: UUID,
    payload: CommentUpdate,
    db: AsyncSession = Depends(get_async_session),
    current_token: dict = Depends(JWTCookieBearer()),
):
    uid = _uid(current_token)
    if payload.body is None and payload.resolved is None:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    out = None
    if payload.body is not None:
        out = await svc.edit(db, dashboard_id, str(comment_id), uid, payload.body)
    if payload.resolved is not None:
        out = await svc.set_resolved(db, dashboard_id, str(comment_id), uid, payload.resolved)
    return out


@router.delete("/{comment_id}")
@rate_limit(requests_per_minute=30, bucket="dashboard_comments")
async def delete_comment(
    dashboard_id: UUID,
    comment_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    current_token: dict = Depends(JWTCookieBearer()),
):
    return await svc.delete(db, dashboard_id, str(comment_id), _uid(current_token))
