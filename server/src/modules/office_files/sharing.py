"""Sharing Docs and Slides: with people (view or edit) and by link (view), each approved by an organization
owner or admin before it opens anything. Built on the publishing rules (feed.publish_policy): the same
approvers, "second approver" option, outside-sharing switch, notices, emails and audit trail."""

from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled
from src.modules.feed import publish_policy as policy
from src.modules.office_files.models import OfficeFile, OfficeFileShare

SLUG_ALPHABET = string.ascii_letters + string.digits
SLUG_LENGTH = 12  # ~71 bits: unguessable
NOUNS = {"document": "document", "presentation": "presentation"}
LIST_PATHS = {"document": "/docs", "presentation": "/slides"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_slug() -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_LENGTH))


async def user_ids(db: AsyncSession, user_id: Any) -> Set[str]:
    """Every id the person goes by (sign-in id, users.id, users.user_id): rows elsewhere use either."""
    ids = {str(user_id)} if user_id else set()
    try:
        row = (await db.execute(text(
            "SELECT id, user_id FROM users WHERE id = CAST(:u AS uuid) OR user_id = CAST(:u AS uuid) LIMIT 1"
        ), {"u": str(user_id)})).first()
    except Exception:  # noqa: BLE001 - not a uuid: only the id itself
        await db.rollback()
        return ids
    if row:
        ids |= {str(v) for v in row if v}
    return ids


async def users_row_id(db: AsyncSession, user_id: Any) -> Optional[uuid.UUID]:
    """users.id for any of a person's ids (shares are stored by it)."""
    try:
        value = (await db.execute(text(
            "SELECT id FROM users WHERE id = CAST(:u AS uuid) OR user_id = CAST(:u AS uuid) LIMIT 1"
        ), {"u": str(user_id)})).scalar()
    except Exception:  # noqa: BLE001
        await db.rollback()
        return None
    return value


async def organization_of(db: AsyncSession, user_id: str) -> Optional[str]:
    """The person's organization (Enterprise); Community has none, so shares need no approval there."""
    if not is_ee_enabled():
        return None
    from src.modules.pricing.feature_gate import get_user_organization_id

    org = await get_user_organization_id(user_id, db)
    return str(org) if org else None


async def is_approver(db: AsyncSession, org_id: Optional[str], user_id: str) -> bool:
    if not org_id:
        return False
    mine = await user_ids(db, user_id)
    return bool(mine & {str(i) for i in await policy.approvers(db, org_id)})


async def starting_status(db: AsyncSession, org_id: Optional[str], user_id: str, *, public: bool) -> str:
    """A new share is ``active`` when an owner or admin makes it (unless the organization asks for a second
    approver and has one), else ``pending``. Public links also need outside sharing to be allowed."""
    if public:
        await policy.require_outside_sharing(db, org_id)
    if not org_id:
        return "active"
    ids = await policy.approvers(db, org_id)
    mine = await user_ids(db, user_id)
    if not mine & {str(i) for i in ids}:
        return "pending"
    rules = await policy.get_policy(db, org_id)
    others = [i for i in ids if str(i) not in mine]
    return "pending" if rules.get("second_approver") and others else "active"


async def names(db: AsyncSession, ids: Iterable[Any]) -> Dict[str, Dict[str, Optional[str]]]:
    """users.id → {name, email} for showing who a share is with and who asked."""
    wanted = [str(i) for i in ids if i]
    if not wanted:
        return {}
    rows = (await db.execute(text("""
        SELECT id, user_id, COALESCE(NULLIF(trim(concat(first_name, ' ', last_name)), ''), username, email), email
        FROM users WHERE id = ANY(CAST(:ids AS uuid[])) OR user_id = ANY(CAST(:ids AS uuid[]))
    """), {"ids": wanted})).all()
    out: Dict[str, Dict[str, Optional[str]]] = {}
    for row in rows:
        for key in (row[0], row[1]):
            if key:
                out[str(key)] = {"name": row[2], "email": row[3]}
    return out


async def people(db: AsyncSession, org_id: Optional[str], q: str = "", limit: int = 20) -> List[Dict[str, Any]]:
    """Members of the organization to share with (none in Community: no organizations)."""
    if not org_id:
        return []
    like = f"%{q.strip().lower()}%"
    rows = (await db.execute(text("""
        SELECT DISTINCT u.id, COALESCE(NULLIF(trim(concat(u.first_name, ' ', u.last_name)), ''), u.username, u.email), u.email
        FROM users u JOIN user_roles ur ON (ur.user_id = u.id OR ur.user_id = u.user_id)
        WHERE ur.organization_id = CAST(:org AS uuid) AND ur.is_active AND NOT ur.is_deleted
          AND (:q = '%%' OR lower(coalesce(u.email, '')) LIKE :q OR lower(concat(u.first_name, ' ', u.last_name)) LIKE :q
               OR lower(coalesce(u.username, '')) LIKE :q)
        ORDER BY 2 LIMIT :limit
    """), {"org": org_id, "q": like, "limit": limit})).all()
    return [{"id": str(r[0]), "name": r[1], "email": r[2]} for r in rows]


def share_dict(share: OfficeFileShare, who: Dict[str, Dict[str, Optional[str]]]) -> Dict[str, Any]:
    person = who.get(str(share.person_id)) if share.person_id else None
    requester = who.get(str(share.requested_by)) or {}
    return {
        "id": str(share.id),
        "target": share.target,
        "role": share.role,
        "status": share.status,
        "person_id": str(share.person_id) if share.person_id else None,
        "person_name": (person or {}).get("name"),
        "person_email": (person or {}).get("email"),
        "slug": share.slug,
        "link_access": share.link_access,
        "requested_by_name": requester.get("name"),
        "note": share.note,
        "view_count": int(share.view_count or 0),
        "updated_at": share.updated_at.isoformat() if share.updated_at else None,
    }


async def my_role(db: AsyncSession, f: OfficeFile, ids: Set[str]) -> Optional[str]:
    """owner | edit | view | None for a person (by all their ids), from active shares only."""
    if str(f.user_id) in ids:
        return "owner"
    rows = (await db.execute(select(OfficeFileShare.role).where(
        OfficeFileShare.file_id == f.id, OfficeFileShare.target == "person", OfficeFileShare.status == "active",
        OfficeFileShare.person_id.in_([uuid.UUID(i) for i in ids if _is_uuid(i)]),
    ))).scalars().all()
    if "edit" in rows:
        return "edit"
    return "view" if rows else None


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def _notice(share: OfficeFileShare, f: OfficeFile, state: str) -> Dict[str, Any]:
    what = "link" if share.target == "link" else f"{share.role} access"
    base = LIST_PATHS.get(f.kind, "/docs")
    href = f"{base}?review=1" if state == "waiting" else f"{base}/{f.id}"
    return {"kind": "office_share", "state": state, "share_id": str(share.id), "title": f.title,
            "what": what, "href": href}


async def after_request(db: AsyncSession, share: OfficeFileShare, f: OfficeFile, requester_id: str) -> None:
    """Tell the approvers about a waiting share (bell + email), or the person it is shared with that it's open."""
    org_id = str(share.organization_id) if share.organization_id else None
    await policy.audit("office_share_requested", user_id=requester_id, org_id=org_id, resource_type=f.kind,
                       resource_id=str(f.id), metadata={"target": share.target, "role": share.role,
                                                        "status": share.status, "access": share.link_access})
    if share.status == "pending" and org_id:
        mine = await user_ids(db, requester_id)
        others = [i for i in await policy.approvers(db, org_id) if str(i) not in mine]
        await policy.notify_people(db, others, actor_id=requester_id, metadata=_notice(share, f, "waiting"))
        await db.commit()
        from src.core.config import settings as app_settings

        await policy.email_approvers(db, others, f"{f.title} ({'link' if share.target == 'link' else 'sharing'})",
                                     f"{app_settings.FRONTEND_URL}{LIST_PATHS.get(f.kind, '/docs')}?review=1")
    elif share.status == "active" and share.person_id:
        await policy.notify_people(db, [share.person_id], actor_id=requester_id, metadata=_notice(share, f, "shared"))
        await db.commit()


async def review_of(db: AsyncSession, share: OfficeFileShare, user_id: str) -> Dict[str, Any]:
    """Can this person approve or decline the waiting share, and if not, why."""
    if share.status != "pending" or not share.organization_id:
        return {"can_approve": False, "blocked_reason": "not_waiting"}
    ids = await policy.approvers(db, share.organization_id)
    rules = await policy.get_policy(db, share.organization_id)
    mine = await user_ids(db, user_id)
    theirs = await user_ids(db, share.requested_by)
    me = next((str(i) for i in ids if str(i) in mine), user_id)
    requester = next((str(i) for i in ids if str(i) in theirs), str(share.requested_by))
    allowed, reason = policy.may_review(user_id=me, requester_id=requester, approver_ids=ids,
                                        second_approver=bool(rules.get("second_approver")))
    return {"can_approve": allowed, "blocked_reason": reason}


async def decide(db: AsyncSession, share: OfficeFileShare, f: OfficeFile, user_id: str, *, approved: bool,
                 note: str = "") -> None:
    review = await review_of(db, share, user_id)
    if review["blocked_reason"] == "not_waiting":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This share is no longer waiting for approval.")
    if not review["can_approve"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=(
            "Your organization asks someone else to approve your own shares."
            if review["blocked_reason"] == "own_work" else "Only organization owners and admins can do this."))
    if approved and share.target == "link" and share.link_access == "public":
        await policy.require_outside_sharing(db, str(share.organization_id))
    share.status = "active" if approved else "declined"
    share.decided_by = await users_row_id(db, user_id)
    share.decided_at = now()
    share.note = note[:300] or None
    org_id = str(share.organization_id)
    await policy.notify_people(db, [share.requested_by], actor_id=user_id,
                               metadata={**_notice(share, f, "approved" if approved else "declined"), "note": note[:300]})
    if approved and share.person_id:
        await policy.notify_people(db, [share.person_id], actor_id=share.requested_by,
                                   metadata=_notice(share, f, "shared"))
    await db.commit()
    await policy.audit("office_share_approved" if approved else "office_share_declined", user_id=user_id,
                       org_id=org_id, resource_type=f.kind, resource_id=str(f.id),
                       metadata={"target": share.target, "role": share.role, "note": note[:300]})
