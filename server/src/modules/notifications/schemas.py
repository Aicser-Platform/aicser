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
    kind: Literal["alert", "invitation", "ai", "activity"]
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
