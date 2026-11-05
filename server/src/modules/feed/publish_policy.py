"""Who may put work in front of people outside the organization, in one place.

The organization chooses (organizations.settings["publishing"]):
- public: "off" (nobody), "approval" (the default) or "members" (publish directly).
- expiry_days: public items end after this many days (empty keeps them up).
- second_approver: owners and admins need someone else's approval too (off by default).

Owners and admins are equal approvers, and they are the ones the organization trusts with this, so
their own work goes out directly and the audit log records that it was self-approved. An organization
that needs four eyes turns on second_approver: then nobody approves their own work while another
approver exists. An organization with one approver can always publish, or it could never publish.
Everyone else goes to an approver; possibly personal data always goes to a person first.

may_review is the one rule for who can act on a waiting item. The screens ask it before showing a
button and the server asks it again before acting, so the two can't disagree.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

MODES = ("off", "approval", "members")
DEFAULT_POLICY: Dict[str, Any] = {"public": "approval", "expiry_days": None, "second_approver": False}
APPROVER_ROLES = ("org_owner", "org_admin")


async def get_policy(db: AsyncSession, org_id: Optional[Any]) -> Dict[str, Any]:
    if not org_id:
        return dict(DEFAULT_POLICY)
    try:
        row = (await db.execute(text("SELECT settings FROM organizations WHERE id = :id"), {"id": str(org_id)})).first()
    except Exception as exc:  # noqa: BLE001 - Community has no organizations table
        logger.debug("Publishing policy unavailable: %s", exc)
        await db.rollback()
        return dict(DEFAULT_POLICY)
    settings = row[0] if row else None
    settings = json.loads(settings) if isinstance(settings, str) else (settings or {})
    saved = settings.get("publishing") if isinstance(settings, dict) else None
    return {**DEFAULT_POLICY, **(saved or {})}


async def set_policy(db: AsyncSession, org_id: Any, policy: Dict[str, Any]) -> Dict[str, Any]:
    await db.execute(text(
        "UPDATE organizations SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{publishing}', CAST(:p AS jsonb)) WHERE id = :id"
    ), {"p": json.dumps(policy), "id": str(org_id)})
    return policy


OUTSIDE_SHARING_OFF = "Sharing outside the organization is turned off. An owner or admin can change this in Settings › Publishing."


async def outside_sharing_off(db: AsyncSession, org_id: Optional[Any]) -> bool:
    """Whether the organization turned off everything that reaches people outside it: public links,
    embeds, embedded assistants and data shares. Checked when a link is made and every time one is
    opened, so turning it off also stops links that already exist."""
    return bool(org_id) and (await get_policy(db, org_id)).get("public") == "off"


async def require_outside_sharing(db: AsyncSession, org_id: Optional[Any]) -> None:
    if await outside_sharing_off(db, org_id):
        raise HTTPException(status_code=403, detail={"message": OUTSIDE_SHARING_OFF, "code": "outside_sharing_off"})


async def require_embed_publisher(db: AsyncSession, org_id: Optional[Any], user_id: Any) -> None:
    """An embed token puts work on a website with no review step of its own, so under "approval" only
    those who could approve it may make one. Everyone else has Share, which asks for approval."""
    await require_outside_sharing(db, org_id)
    if not org_id or (await get_policy(db, org_id)).get("public") != "approval":
        return
    if str(user_id) not in {str(i) for i in await approvers(db, org_id)}:
        raise HTTPException(status_code=403, detail={
            "message": "Your organization asks an owner or admin to approve public sharing. Use Share to request it.",
            "code": "embed_needs_approval"})


def personal_data_found(*texts: Any) -> bool:
    """Whether text about to leave the organization looks personal (False when clean or the check is unavailable)."""
    joined = "\n".join(str(t) for t in texts if t)[:20_000]
    if not joined.strip():
        return False
    try:
        from src.modules.data.services.pii_scrubber import PiiScrubber

        return PiiScrubber().scrub_text(joined) != joined
    except Exception as exc:  # noqa: BLE001 - the check is an extra safeguard, not the gate
        logger.info("Personal-data check skipped: %s", exc)
        return False


def public_decision(*, mode: str, is_approver: bool, other_approvers: int, has_org: bool, personal_data: bool,
                    second_approver: bool = False) -> Tuple[str, bool]:
    """("approved" | "pending" | "refused", self_approved) for putting something in public."""
    if not has_org:
        return "approved", False
    if mode == "off":
        return "refused", False
    if is_approver:
        return ("pending", False) if second_approver and other_approvers else ("approved", True)
    if personal_data or mode != "members":
        return "pending", False
    return "approved", False


def may_review(*, user_id: Any, requester_id: Any, approver_ids: List[Any], second_approver: bool) -> Tuple[bool, Optional[str]]:
    """(allowed, why not) for approving or declining a waiting item."""
    if str(user_id) not in {str(i) for i in approver_ids}:
        return False, "not_approver"
    own = str(user_id) == str(requester_id)
    if own and second_approver and approvers_other_than(approver_ids, user_id):
        return False, "own_work"
    return True, None


async def audit(event: str, *, user_id: Any, org_id: Any, resource_type: str, resource_id: Any, metadata: Optional[Dict[str, Any]] = None) -> None:
    from src.shared.middleware.audit_logger import log_audit_event

    try:
        await log_audit_event(event, category="publishing", user_id=str(user_id) if user_id else None, org_id=str(org_id) if org_id else None,
                              resource_type=resource_type, resource_id=str(resource_id), action=event, metadata=metadata or {})
    except Exception as exc:  # noqa: BLE001 - never blocks publishing, but must be visible
        logger.warning("Publishing audit event %s not written: %s", event, exc)


async def email_approvers(db: AsyncSession, approver_ids: List[UUID], title: str, url: str, *, reminder: bool = False) -> None:
    if not approver_ids:
        return
    from src.shared.transactional_email import send_transactional_email

    try:
        rows = (await db.execute(text(
            "SELECT email FROM users WHERE (id = ANY(CAST(:ids AS uuid[])) OR user_id = ANY(CAST(:ids AS uuid[]))) AND email IS NOT NULL"
        ), {"ids": [str(i) for i in approver_ids]})).all()
        subject = f"{'Reminder: ' if reminder else ''}Approval needed: {title}"
        await send_transactional_email([r[0] for r in rows], subject, f"{title} is waiting for your approval before it can be published.\n\n{url}")
    except Exception as exc:  # noqa: BLE001 - the in-app request still stands
        logger.warning("Approval email not sent: %s", exc)


async def approvers(db: AsyncSession, org_id: Any) -> List[UUID]:
    """The organization's owners and admins: equal approvers for anything public."""
    try:
        rows = (await db.execute(text(
            "SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id "
            "WHERE ur.organization_id = :org AND r.name = ANY(:names) AND ur.is_active AND NOT ur.is_deleted"
        ), {"org": str(org_id), "names": list(APPROVER_ROLES)})).all()
    except Exception as exc:  # noqa: BLE001 - Community has no roles
        logger.debug("Approvers unavailable: %s", exc)
        await db.rollback()
        return []
    return [r[0] for r in rows]


def approvers_other_than(ids: List[Any], user_id: Any) -> int:
    return len([i for i in ids if str(i) != str(user_id)])


async def approver_names(db: AsyncSession, approver_ids: List[Any], *, leave_out: Any = None) -> List[str]:
    """Who can act, so a person waiting knows who to ask."""
    ids = [str(i) for i in approver_ids if str(i) != str(leave_out)]
    if not ids:
        return []
    rows = (await db.execute(text("""
        SELECT COALESCE(NULLIF(trim(concat(first_name, ' ', last_name)), ''), username, email) FROM users
        WHERE id = ANY(CAST(:ids AS uuid[])) OR user_id = ANY(CAST(:ids AS uuid[]))
    """), {"ids": ids})).all()
    return sorted({r[0] for r in rows if r[0]})


async def notify_people(db: AsyncSession, user_ids: List[Any], *, actor_id: Any, metadata: Dict[str, Any]) -> None:
    """An in-app notice in the bell. Sign-in ids and users.id both occur, so they are resolved here.
    Caller commits; a missing notice must never undo the decision it reports."""
    try:
        ids = [str(i) for i in user_ids if i and str(i) != str(actor_id)]
        if not ids:
            return
        actor = (await db.execute(text(
            "SELECT id FROM users WHERE id = CAST(:a AS uuid) OR user_id = CAST(:a AS uuid) LIMIT 1"), {"a": str(actor_id)})).scalar()
        await db.execute(text("""
            INSERT INTO feed_notifications (recipient_id, actor_id, type, metadata, is_read)
            SELECT id, :actor, 'approval', CAST(:meta AS jsonb), false FROM users
            WHERE id = ANY(CAST(:ids AS uuid[])) OR user_id = ANY(CAST(:ids AS uuid[]))
        """), {"actor": actor, "meta": json.dumps(metadata), "ids": ids})
    except Exception as exc:  # noqa: BLE001
        logger.warning("Approval notice not written: %s", exc)
