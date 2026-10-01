"""Saved comment threads on a document (a notebook, a workbook, …) or a spot in it (a cell).

The same rules as dashboard comments (see dashboards/comments.py):
- anyone who can open the document reads, comments, replies and resolves or reopens a thread;
- only the author edits a comment; the author or the document's owner deletes it;
- replying to a resolved thread reopens it; threads are one level deep; deletes are soft, so
  replies keep their context.

Callers check who can open the document first. Threads serialize in the dashboard shape
(``widget_id`` is the spot) so the client reuses one comments panel.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_BODY = 4000


async def author_name(db: AsyncSession, user_id: str) -> str:
    try:
        from src.modules.user.models import User

        u = await db.get(User, UUID(str(user_id)))
        if u:
            return str(getattr(u, "first_name", None) or getattr(u, "username", None) or getattr(u, "email", None) or "")
    except Exception:
        pass
    return ""


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _text(body: str) -> str:
    text = (body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write something first.")
    if len(text) > MAX_BODY:
        raise HTTPException(status_code=400, detail=f"Comments are limited to {MAX_BODY:,} characters.")
    return text


class CommentThreads:
    """Threads stored in ``model``, attached to a document by ``doc_field`` and optionally to a
    spot in it by ``anchor_field``."""

    def __init__(self, model: Any, doc_field: str, anchor_field: str, anchor_max: int = 40):
        self.model, self.doc_field, self.anchor_field, self.anchor_max = model, doc_field, anchor_field, anchor_max

    def serialize(self, c: Any) -> Dict[str, Any]:
        deleted = bool(c.is_deleted)
        return {
            "id": str(c.id),
            self.doc_field: str(getattr(c, self.doc_field)),
            "widget_id": getattr(c, self.anchor_field),
            "parent_id": str(c.parent_id) if c.parent_id else None,
            "author": {"id": str(c.author_id), "name": c.author_name or ""},
            "body": "" if deleted else c.body,
            "deleted": deleted,
            "edited_at": _iso(c.edited_at),
            "resolved_at": _iso(c.resolved_at),
            "resolved_by": str(c.resolved_by) if c.resolved_by else None,
            "created_at": _iso(c.created_at),
        }

    async def list_threads(self, db: AsyncSession, doc_id: Any) -> List[Dict[str, Any]]:
        m = self.model
        rows = (await db.execute(
            select(m).where(getattr(m, self.doc_field) == doc_id).order_by(m.created_at)
        )).scalars().all()
        replies: Dict[str, List[Dict[str, Any]]] = {}
        for c in rows:
            if c.parent_id and not c.is_deleted:
                replies.setdefault(str(c.parent_id), []).append(self.serialize(c))
        threads = []
        for c in rows:
            if c.parent_id:
                continue
            kids = replies.get(str(c.id), [])
            if c.is_deleted and not kids:
                continue
            threads.append({**self.serialize(c), "replies": kids})
        return threads

    async def _load(self, db: AsyncSession, doc_id: Any, comment_id: str) -> Any:
        try:
            c = await db.get(self.model, UUID(str(comment_id)))
        except ValueError:
            c = None
        if c is None or getattr(c, self.doc_field) != doc_id or c.is_deleted:
            raise HTTPException(status_code=404, detail="That comment no longer exists.")
        return c

    async def create(self, db: AsyncSession, doc_id: Any, user_id: str, body: str, *,
                     anchor: Optional[str] = None, parent_id: Optional[str] = None) -> Dict[str, Any]:
        text = _text(body)
        parent = None
        if parent_id:
            parent = await self._load(db, doc_id, parent_id)
            if parent.parent_id:  # a reply to a reply joins the thread
                parent = await self._load(db, doc_id, str(parent.parent_id))
        comment = self.model(**{
            self.doc_field: doc_id,
            self.anchor_field: (getattr(parent, self.anchor_field) if parent
                                else (str(anchor)[: self.anchor_max] if anchor else None)),
            "parent_id": parent.id if parent else None,
            "author_id": UUID(str(user_id)),
            "author_name": (await author_name(db, user_id))[:255],
            "body": text,
        })
        db.add(comment)
        if parent is not None and parent.resolved_at:
            parent.resolved_at, parent.resolved_by = None, None  # a new reply reopens the discussion
        await db.commit()
        await db.refresh(comment)
        return self.serialize(comment)

    async def edit(self, db: AsyncSession, doc_id: Any, comment_id: str, user_id: str, body: str) -> Dict[str, Any]:
        c = await self._load(db, doc_id, comment_id)
        if str(c.author_id) != str(user_id):
            raise HTTPException(status_code=403, detail="Only the author can edit a comment.")
        c.body, c.edited_at = _text(body), datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(c)
        return self.serialize(c)

    async def set_resolved(self, db: AsyncSession, doc_id: Any, comment_id: str, user_id: str,
                           resolved: bool) -> Dict[str, Any]:
        c = await self._load(db, doc_id, comment_id)
        if c.parent_id:
            c = await self._load(db, doc_id, str(c.parent_id))  # resolving applies to the thread
        c.resolved_at = datetime.now(timezone.utc) if resolved else None
        c.resolved_by = UUID(str(user_id)) if resolved else None
        await db.commit()
        await db.refresh(c)
        return self.serialize(c)

    async def delete(self, db: AsyncSession, doc_id: Any, owner_id: Any, comment_id: str,
                     user_id: str) -> Dict[str, Any]:
        c = await self._load(db, doc_id, comment_id)
        if str(c.author_id) != str(user_id) and str(owner_id) != str(user_id):
            raise HTTPException(status_code=403, detail="Only the author or the owner can delete a comment.")
        c.is_deleted = True
        await db.commit()
        return {"id": str(c.id), "parent_id": str(c.parent_id) if c.parent_id else None, "deleted": True}
