"""Shared models for the Activity inbox API (alerts, AI, team, adoption tips)."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class NotificationAction(BaseModel):
    """Optional button in the inbox row: navigate, or run a small inline API (e.g. acknowledge)."""

    label: str
    href: Optional[str] = None
    inline: Optional[Literal["ack_alert"]] = None
    target_id: Optional[str] = None


class NotificationItem(BaseModel):
    id: str
    # "feed" was missing here even though feed_notifications() (inbox_service.py)
    # always constructed items with kind="feed" and the frontend
    # (ActivityInboxBell.tsx's kindAccent/KindIcon/kindLabel) already fully
    # supports it - the mismatch meant NotificationItem(kind="feed", ...)
    # raised a pydantic ValidationError the moment a user had any real feed
    # notification (mention/comment/reaction/share/follow/approval), which
    # propagated out of feed_notifications() uncaught and made build_inbox()
    # fail entirely - the router's outer try/except then swallowed it and
    # returned an EMPTY inbox, silently hiding every other notification
    # (including firing alerts) too, with no error shown to the user.
    kind: Literal["alert", "invitation", "ai", "activity", "feed"]
    title: str
    message: str
    severity: str = "info"
    created_at: Optional[str] = None
    href: str
    actions: List[NotificationAction] = Field(default_factory=list)
    """Tip slug for POST /dismiss (setup nudges); omitted for system-generated rows."""
    dismiss_key: Optional[str] = None


class InboxResponse(BaseModel):
    items: List[NotificationItem] = Field(default_factory=list)
    unread_count: int = 0


class DismissTipRequest(BaseModel):
    dismiss_key: str = Field(..., min_length=1, max_length=128)
