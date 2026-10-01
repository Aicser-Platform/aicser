"""Dashboard comments: saved threads on a dashboard or one of its widgets.

Who can do what (the Google Docs / Figma model):
- anyone who can view the dashboard can read, comment, reply and resolve or reopen a thread;
- only the author edits a comment; the author or someone who can edit the dashboard deletes it;
- replying to a resolved thread reopens it; deletes are soft, so replies keep their context.

Every change is published to `comment_events` listeners — the collaboration socket (Enterprise)
registers one to push it live to everyone who has the dashboard open.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.dashboards.models import DashboardComment

logger = logging.getLogger(__name__)

MAX_BODY = 4000
_listeners: List[Callable[[str, str, Dict[str, Any]], Awaitable[None]]] = []


def on_comment_event(listener: Callable[[str, str, Dict[str, Any]], Awaitable[None]]) -> None:
    """Register an async listener(dashboard_id, event, comment) — e.g. the live socket."""
    if listener not in _listeners:
        _listeners.append(listener)


async def _publish(dashboard_id: str, event: str, comment: Dict[str, Any]) -> None:
    for listener in list(_listeners):
        try:
            await listener(dashboard_id, event, comment)
        except Exception as exc:  # live delivery is best-effort; the comment is saved
            logger.debug("comment listener failed: %s", exc)


# ── Access ──────────────────────────────────────────────────────────────────

async def authorize(db: AsyncSession, user_id: str, dashboard_id: UUID, permission: str = "dashboard:view") -> None:
    """Raise 403/404 unless the user holds `permission` in the dashboard's own organization and
    project (public dashboards don't open their comment threads to everyone)."""
    from src.modules.authentication.rbac.guard import require_permission
    from src.modules.dashboards.collaboration_chart_service import dashboard_scope

    scope = await dashboard_scope(db, dashboard_id)
    if scope["organization_id"] or scope["project_id"]:
        await require_permission(user_id, permission, **scope)
        return
    from src.shared.access_control import check_dashboard_access

    await check_dashboard_access({"id": user_id, "user_id": user_id, "sub": user_id}, str(dashboard_id))


async def _can_edit_dashboard(db: AsyncSession, user_id: str, dashboard_id: UUID) -> bool:
    try:
        await authorize(db, user_id, dashboard_id, "dashboard:edit")
        return True
    except HTTPException:
        return False


# ── Shape ───────────────────────────────────────────────────────────────────

def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def serialize(c: DashboardComment) -> Dict[str, Any]:
    deleted = bool(c.is_deleted)
    return {
        "id": str(c.id),
        "dashboard_id": str(c.dashboard_id),
        "widget_id": c.widget_id,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "author": {"id": str(c.author_id), "name": c.author_name or ""},
        "body": "" if deleted else c.body,
        "deleted": deleted,
        "edited_at": _iso(c.edited_at),
        "resolved_at": _iso(c.resolved_at),
        "resolved_by": str(c.resolved_by) if c.resolved_by else None,
        "created_at": _iso(c.created_at),
    }


async def _author_name(db: AsyncSession, user_id: str) -> str:
    try:
        from src.modules.user.models import User

        u = await db.get(User, UUID(str(user_id)))
        if u:
            return str(getattr(u, "first_name", None) or getattr(u, "username", None) or getattr(u, "email", None) or "")
    except Exception:
        pass
    return ""


# ── Operations ──────────────────────────────────────────────────────────────

async def list_threads(db: AsyncSession, dashboard_id: UUID) -> List[Dict[str, Any]]:
    """Threads oldest first, each with its replies; a deleted comment stays only as a
    placeholder when it still has replies."""
    rows = (await db.execute(
        select(DashboardComment).where(DashboardComment.dashboard_id == dashboard_id).order_by(DashboardComment.created_at)
    )).scalars().all()
    replies: Dict[str, List[Dict[str, Any]]] = {}
    for c in rows:
        if c.parent_id and not c.is_deleted:
            replies.setdefault(str(c.parent_id), []).append(serialize(c))
    threads = []
    for c in rows:
        if c.parent_id:
            continue
        kids = replies.get(str(c.id), [])
        if c.is_deleted and not kids:
            continue
        threads.append({**serialize(c), "replies": kids})
    return threads


async def create(db: AsyncSession, dashboard_id: UUID, user_id: str, body: str, *,
                 widget_id: Optional[str] = None, parent_id: Optional[str] = None) -> Dict[str, Any]:
    text = (body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write something first.")
    if len(text) > MAX_BODY:
        raise HTTPException(status_code=400, detail=f"Comments are limited to {MAX_BODY:,} characters.")
    await authorize(db, user_id, dashboard_id)
    parent = None
    if parent_id:
        parent = await db.get(DashboardComment, UUID(str(parent_id)))
        if parent is None or parent.dashboard_id != dashboard_id:
            raise HTTPException(status_code=404, detail="That comment no longer exists.")
        if parent.parent_id:  # threads are one level deep: a reply to a reply joins the thread
            parent = await db.get(DashboardComment, parent.parent_id)
    comment = DashboardComment(
        dashboard_id=dashboard_id,
        widget_id=(parent.widget_id if parent else (str(widget_id)[:128] if widget_id else None)),
        parent_id=parent.id if parent else None,
        author_id=UUID(str(user_id)),
        author_name=(await _author_name(db, user_id))[:255],
        body=text,
    )
    db.add(comment)
    reopened = None
    if parent is not None and parent.resolved_at:
        parent.resolved_at, parent.resolved_by = None, None  # a new reply reopens the discussion
        reopened = parent
    await db.commit()
    await db.refresh(comment)
    out = serialize(comment)
    await _publish(str(dashboard_id), "comment:created", out)
    if reopened is not None:
        await db.refresh(reopened)
        await _publish(str(dashboard_id), "comment:updated", serialize(reopened))
    return out


async def _load(db: AsyncSession, dashboard_id: UUID, comment_id: str) -> DashboardComment:
    try:
        c = await db.get(DashboardComment, UUID(str(comment_id)))
    except ValueError:
        c = None
    if c is None or c.dashboard_id != dashboard_id or c.is_deleted:
        raise HTTPException(status_code=404, detail="That comment no longer exists.")
    return c


async def edit(db: AsyncSession, dashboard_id: UUID, comment_id: str, user_id: str, body: str) -> Dict[str, Any]:
    await authorize(db, user_id, dashboard_id)
    c = await _load(db, dashboard_id, comment_id)
    if str(c.author_id) != str(user_id):
        raise HTTPException(status_code=403, detail="Only the author can edit a comment.")
    text = (body or "").strip()
    if not text or len(text) > MAX_BODY:
        raise HTTPException(status_code=400, detail=f"Comments need 1–{MAX_BODY:,} characters.")
    c.body, c.edited_at = text, datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(c)
    out = serialize(c)
    await _publish(str(dashboard_id), "comment:updated", out)
    return out


async def set_resolved(db: AsyncSession, dashboard_id: UUID, comment_id: str, user_id: str, resolved: bool) -> Dict[str, Any]:
    await authorize(db, user_id, dashboard_id)
    c = await _load(db, dashboard_id, comment_id)
    if c.parent_id:
        c = await _load(db, dashboard_id, str(c.parent_id))  # resolving applies to the thread
    c.resolved_at = datetime.now(timezone.utc) if resolved else None
    c.resolved_by = UUID(str(user_id)) if resolved else None
    await db.commit()
    await db.refresh(c)
    out = serialize(c)
    await _publish(str(dashboard_id), "comment:updated", out)
    return out


async def delete(db: AsyncSession, dashboard_id: UUID, comment_id: str, user_id: str) -> Dict[str, Any]:
    await authorize(db, user_id, dashboard_id)
    c = await _load(db, dashboard_id, comment_id)
    if str(c.author_id) != str(user_id) and not await _can_edit_dashboard(db, user_id, dashboard_id):
        raise HTTPException(status_code=403, detail="Only the author or a dashboard editor can delete a comment.")
    c.is_deleted = True
    await db.commit()
    out = {"id": str(c.id), "parent_id": str(c.parent_id) if c.parent_id else None, "deleted": True}
    await _publish(str(dashboard_id), "comment:deleted", out)
    return out
