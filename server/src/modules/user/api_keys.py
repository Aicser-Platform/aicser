"""Platform API keys — long-lived credentials for scripts, integrations and MCP clients.

Keys look like `aicser_<id>_<secret>`. Only a SHA-256 of the secret is stored (the secret
is 32 random bytes, so a fast hash is appropriate); the id makes verification a single
indexed lookup and a constant-time compare. Each key acts as the user who created it,
in the organization it was created in — never with more access than that user has.

Previously keys were stored only in masked form, so no presented key could ever be
verified. Those legacy entries remain listed (as `legacy`) so users know to recreate them.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, DateTime, String, select
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text

from src.db.base import Base

KEY_PREFIX = "aicser"
_KEY_RE = re.compile(rf"^{KEY_PREFIX}_([0-9a-f]{{32}})_([A-Za-z0-9_-]{{20,}})$")
_LAST_USED_WRITE_INTERVAL = timedelta(minutes=5)


class PlatformApiKey(Base):
    """Append-only credential record (revocation sets revoked_at; rows are never reused)."""

    __tablename__ = "platform_api_keys"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True)
    name = Column(String(128), nullable=False)
    display_hint = Column(String(32), nullable=False)
    secret_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp())
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)


@dataclass(frozen=True)
class ApiKeyIdentity:
    key_id: str
    user_id: str
    organization_id: Optional[str]


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


def parse_key(raw: str) -> Optional[tuple]:
    m = _KEY_RE.match((raw or "").strip())
    return (m.group(1), m.group(2)) if m else None


def _public(row: PlatformApiKey) -> Dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "key": row.display_hint,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_used": row.last_used_at.isoformat() if row.last_used_at else None,
        "status": "revoked" if row.revoked_at else "active",
    }


async def create_api_key(user_id: str, organization_id: Optional[str], name: str) -> Dict[str, Any]:
    """Create a key; the full key is returned exactly once."""
    from src.db.session import async_session

    key_uuid = uuid.uuid4()
    secret = secrets.token_urlsafe(32)
    full = f"{KEY_PREFIX}_{key_uuid.hex}_{secret}"
    row = PlatformApiKey(
        id=key_uuid, user_id=_uuid(user_id), organization_id=_uuid(organization_id),
        name=name[:128], display_hint=f"{KEY_PREFIX}_…{secret[-4:]}", secret_hash=_hash(secret),
    )
    async with async_session() as db:
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return {**_public(row), "key": full}


async def list_api_keys(user_id: str) -> List[Dict[str, Any]]:
    from src.db.session import async_session

    async with async_session() as db:
        rows = (await db.execute(
            select(PlatformApiKey).where(PlatformApiKey.user_id == _uuid(user_id)).order_by(PlatformApiKey.created_at.desc())
        )).scalars().all()
    return [_public(r) for r in rows]


async def revoke_api_key(user_id: str, key_id: str) -> bool:
    from src.db.session import async_session

    async with async_session() as db:
        row = (await db.execute(
            select(PlatformApiKey).where(PlatformApiKey.id == _uuid(key_id), PlatformApiKey.user_id == _uuid(user_id))
        )).scalars().first()
        if row is None:
            return False
        if row.revoked_at is None:
            row.revoked_at = datetime.now(timezone.utc)
            await db.commit()
        return True


async def verify_api_key(raw: str) -> Optional[ApiKeyIdentity]:
    """Return the identity for a valid, unrevoked key; None otherwise (never raises)."""
    parsed = parse_key(raw)
    if not parsed:
        return None
    key_hex, secret = parsed
    try:
        from src.db.session import async_session

        async with async_session() as db:
            row = (await db.execute(
                select(PlatformApiKey).where(PlatformApiKey.id == uuid.UUID(hex=key_hex))
            )).scalars().first()
            if row is None or row.revoked_at is not None:
                return None
            if not hmac.compare_digest(row.secret_hash, _hash(secret)):
                return None
            now = datetime.now(timezone.utc)
            if row.last_used_at is None or now - row.last_used_at > _LAST_USED_WRITE_INTERVAL:
                row.last_used_at = now
                await db.commit()
            return ApiKeyIdentity(
                key_id=str(row.id), user_id=str(row.user_id),
                organization_id=str(row.organization_id) if row.organization_id else None,
            )
    except Exception:
        return None
