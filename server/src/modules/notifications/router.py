"""
Activity inbox API — team, alerts, AI issues, and adoption tips.

Read/unread uses `activity_inbox_last_viewed_at` in user_settings (same table as other preferences).
Dismissed setup tips use `activity_inbox_dismissed_tips` (JSON list of keys).
"""

from __future__ import annotations

import logging
from typing import Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer, current_user_payload
from src.modules.authentication.helpers import extract_user_payload
from src.modules.notifications.inbox_service import build_inbox
from src.modules.notifications.preferences import load_notification_prefs_merged
from src.modules.notifications.inbox_state import (
    add_dismissed_tip_key,
    compute_unread_count,
    get_dismissed_tip_keys,
    get_last_viewed_at,
    set_last_viewed_now,
)
from src.modules.notifications.schemas import DismissTipRequest, InboxResponse
from src.modules.pricing.feature_gate import get_user_organization_id

logger = logging.getLogger(__name__)

router = APIRouter()


class MarkViewedResponse(BaseModel):
    ok: bool = True


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=8, max_length=100)


@router.get("/push/key")
async def push_key():
    """The public key browsers subscribe with; empty when push isn't set up on this server."""
    from src.modules.notifications import push

    return {"key": push.public_key()}


@router.post("/push/subscribe", status_code=201)
async def push_subscribe(body: PushSubscriptionIn, payload: dict = Depends(current_user_payload)):
    from src.modules.notifications import push

    user_id = str((payload or {}).get("id") or (payload or {}).get("sub") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in first.")
    from src.shared.outbound import safe_destination

    # The address comes from the browser; the server posts to it, so only public https is taken.
    if not await safe_destination(body.endpoint, https_only=True):
        raise HTTPException(status_code=422, detail="That push address isn't allowed.")
    await push.subscribe(user_id, body.endpoint, body.p256dh, body.auth)
    return {"subscribed": True}


@router.post("/push/unsubscribe")
async def push_unsubscribe(body: PushSubscriptionIn, payload: dict = Depends(current_user_payload)):
    from src.modules.notifications import push

    await push.unsubscribe(str((payload or {}).get("id") or (payload or {}).get("sub") or ""), body.endpoint)
    return {"subscribed": False}


@router.get("/inbox", response_model=InboxResponse)
async def get_activity_inbox(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Unified **Activity** feed for end users: collaboration, monitoring, AI follow-ups,
    and contextual next steps—similar in role to notification centers in Tableau Cloud or Power BI.
    """
    payload = extract_user_payload(current_token) if not isinstance(current_token, dict) else current_token
    user_id = str(payload.get("id") or payload.get("user_id") or payload.get("sub") or "").strip()
    email = str(payload.get("email") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    org_id = await get_user_organization_id(user_id, db)
    if not org_id and payload.get("organization_id"):
        org_id = str(payload.get("organization_id"))

    try:
        dismissed = await get_dismissed_tip_keys(user_id)
        last_viewed = await get_last_viewed_at(user_id)
        prefs = await load_notification_prefs_merged(user_id)
        items = await build_inbox(
            db,
            org_id=org_id,
            user_id=user_id,
            email=email,
            dismissed_tips=dismissed,
            prefs=prefs,
            user_payload=payload,
        )
        unread = compute_unread_count(items, last_viewed, dismissed)
    except Exception as e:
        logger.exception("activity inbox failed: %s", e)
        return InboxResponse(items=[], unread_count=0)

    return InboxResponse(items=items, unread_count=unread)


@router.post("/mark-viewed", response_model=MarkViewedResponse)
async def mark_activity_inbox_viewed(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Call when the user opens the Activity panel; stores timestamp in user_settings."""
    payload = extract_user_payload(current_token) if not isinstance(current_token, dict) else current_token
    user_id = str(payload.get("id") or payload.get("user_id") or payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        await set_last_viewed_now(user_id)
    except Exception as e:
        logger.warning("mark-viewed failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Could not update activity. Please try again."},
        ) from e
    return MarkViewedResponse()


@router.post("/dismiss-tip", response_model=MarkViewedResponse)
async def dismiss_activity_tip(
    body: DismissTipRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Persist dismissal of a setup / adoption tip (user_settings JSON list)."""
    payload = extract_user_payload(current_token) if not isinstance(current_token, dict) else current_token
    user_id = str(payload.get("id") or payload.get("user_id") or payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        await add_dismissed_tip_key(user_id, body.dismiss_key.strip())
    except Exception as e:
        logger.warning("dismiss-tip failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Could not save your preference. Please try again."},
        ) from e
    return MarkViewedResponse()
