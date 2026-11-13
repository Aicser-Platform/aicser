"""Phone remote for presenting slides on the web. The desktop app serves a page on the computer's LAN address;
on the web the server sits between the two, so the phone works on any network: it opens a token-guarded page
(no sign-in), its Previous / Next presses are queued here and the presenting browser polls them, and the
browser posts the current slide (number, title, speaker notes) for the phone to show."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.office_files.models import OfficeRemoteSession
from src.modules.office_files.sharing import now

SESSION_HOURS = 4
KEEP_COMMANDS = 20
# The phone polls about once a second; it counts as connected while it keeps doing so.
CONNECTED_FOR = timedelta(seconds=8)
ACTIONS = ("next", "previous")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def start(db: AsyncSession, file_id: Any, user_id: Any) -> Dict[str, Any]:
    """A new remote for this slide show; the token is returned once (only its hash is stored)."""
    await db.execute(delete(OfficeRemoteSession).where(OfficeRemoteSession.expires_at < now()))
    token = secrets.token_urlsafe(32)
    session = OfficeRemoteSession(file_id=file_id, user_id=user_id, token_hash=token_hash(token),
                                  expires_at=now() + timedelta(hours=SESSION_HOURS))
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {"session_id": str(session.id), "token": token, "path": f"/remote/{token}",
            "expires_at": session.expires_at.isoformat()}


async def owned(db: AsyncSession, session_id: str, file_id: Any, user_ids: set) -> OfficeRemoteSession:
    session = await db.get(OfficeRemoteSession, _uuid(session_id))
    if not session or session.file_id != file_id or str(session.user_id) not in user_ids or session.expires_at < now():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This remote has ended.")
    return session


async def by_token(db: AsyncSession, token: str) -> OfficeRemoteSession:
    if not token or len(token) > 100:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This remote has ended.")
    session = (await db.execute(select(OfficeRemoteSession).where(
        OfficeRemoteSession.token_hash == token_hash(token)))).scalars().first()
    if not session or session.expires_at < now():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This remote has ended.")
    return session


def clean_state(state: Dict[str, Any]) -> Dict[str, Any]:
    """Only what the phone shows, kept small."""
    def num(key: str) -> int:
        try:
            return max(0, min(10_000, int(state.get(key) or 0)))
        except (TypeError, ValueError):
            return 0

    return {"index": num("index"), "total": num("total"),
            "title": str(state.get("title") or "")[:300], "notes": str(state.get("notes") or "")[:20_000]}


def commands_after(session: OfficeRemoteSession, after: int) -> List[Dict[str, Any]]:
    return [c for c in (session.commands or []) if int(c.get("seq", 0)) > after]


def connected(session: OfficeRemoteSession) -> bool:
    return bool(session.phone_seen_at and now() - session.phone_seen_at < CONNECTED_FOR)


async def press(db: AsyncSession, session: OfficeRemoteSession, action: str) -> None:
    if action not in ACTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown action.")
    session.seq = int(session.seq or 0) + 1
    session.commands = [*(session.commands or []), {"seq": session.seq, "action": action}][-KEEP_COMMANDS:]
    session.phone_seen_at = now()
    await db.commit()


def phone_view(session: OfficeRemoteSession) -> Dict[str, Any]:
    return {**clean_state(session.state or {}), "expires_at": session.expires_at.isoformat()}


def _uuid(value: Optional[str]):
    import uuid

    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This remote has ended.") from exc
