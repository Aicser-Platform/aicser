"""Short links: who may open them, what they show, and keeping saved data fresh without live queries.

A link is a random slug held here, so it says nothing about what it opens and can be turned off,
limited or changed without replacing what people already have. Public links go through the same
policy, approval and audit as anything else leaving the organization.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from passlib.context import CryptContext
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import async_session
from src.modules.feed import publish_policy as policy
from src.modules.share_links.models import ShareLink

logger = logging.getLogger(__name__)

SLUG_ALPHABET = string.ascii_letters + string.digits
SLUG_LENGTH = 10  # about 59 bits: unguessable, and short enough to read out
SAVED_DATA_MAX_AGE = timedelta(hours=1)
LIVE_SESSION_MINUTES = 60
KINDS = ("chart", "dashboard")
# Data a viewer sees is kept; how it was fetched stays inside the organization.
PRIVATE_WIDGET_FIELDS = ("chartQuery", "dataSourceId", "query")
# Widgets that show without data.
STATIC_WIDGETS = ("text", "image", "divider", "heading", "spacer")

_passwords = CryptContext(schemes=["bcrypt"], deprecated="auto")
_refreshing: set = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_slug() -> str:
    return "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_LENGTH))


def _close_empty_rows(layout: List[Dict[str, Any]]) -> Dict[str, int]:
    """New top row per widget id, with rows nothing occupies removed."""
    used = sorted({row for item in layout for row in range(int(item.get("y") or 0),
                                                           int(item.get("y") or 0) + int(item.get("h") or 1))})
    new_row = {row: i for i, row in enumerate(used)}
    return {str(item.get("i")): new_row[int(item.get("y") or 0)] for item in layout}


def same_site_path(url: Optional[str]) -> Optional[str]:
    """The viewer is already on the app, whatever address it was reached by: no host to get wrong."""
    if not url:
        return None
    parts = urlsplit(url)
    return f"{parts.path}?{parts.query}" if parts.query else parts.path


def public_snapshot(payload: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """A saved snapshot as it may leave the organization: charts and numbers, no queries, nothing
    meant for its editor (a widget with no data would tell a visitor to pick a data source)."""
    if not payload:
        return None
    visuals = payload.get("visuals") or {}
    widgets = [{k: v for k, v in w.items() if k not in PRIVATE_WIDGET_FIELDS}
               for w in visuals.get("widgets") or []
               if isinstance(w, dict) and (w.get("chartData") or w.get("chartType") in STATIC_WIDGETS)]
    kept = {str(w.get("id")) for w in widgets}
    layout = [item for item in visuals.get("layout") or [] if str(item.get("i")) in kept]
    rows = _close_empty_rows(layout)
    layout = [{**item, "y": rows[str(item.get("i"))]} for item in layout]
    widgets = [{**w, "layout": {**w["layout"], "y": rows[str(w.get("id"))]}}
               if isinstance(w.get("layout"), dict) and str(w.get("id")) in rows else w for w in widgets]
    return {**payload, "visuals": {**visuals, "widgets": widgets, "layout": layout}, "provenance": {}}


def to_dict(link: ShareLink) -> Dict[str, Any]:
    return {
        "id": str(link.id), "slug": link.slug, "kind": link.kind, "resource_id": str(link.resource_id),
        "title": link.title, "access": link.access, "status": link.status, "live_data": bool(link.live_data),
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
        "has_password": bool(link.password_hash), "allowed_domains": list(link.allowed_domains or []),
        "view_count": int(link.view_count or 0),
        "last_viewed_at": link.last_viewed_at.isoformat() if link.last_viewed_at else None,
        "snapshot_at": link.snapshot_at.isoformat() if link.snapshot_at else None,
    }


async def find(db: AsyncSession, kind: str, resource_id: str) -> Optional[ShareLink]:
    return (await db.execute(select(ShareLink).where(
        ShareLink.kind == kind, ShareLink.resource_id == uuid.UUID(str(resource_id))))).scalars().first()


async def _public_state(db: AsyncSession, org_id: Optional[str], user_id: str, title: str) -> str:
    """What the organization's rules make of a public link: active, pending, or refused."""
    await policy.require_outside_sharing(db, org_id)
    rules = await policy.get_policy(db, org_id) if org_id else {}
    ids = await policy.approvers(db, org_id) if org_id else []
    decision, _ = policy.public_decision(
        mode=rules.get("public") or "approval", is_approver=str(user_id) in {str(i) for i in ids},
        other_approvers=policy.approvers_other_than(ids, user_id), has_org=bool(org_id),
        personal_data=policy.personal_data_found(title), second_approver=bool(rules.get("second_approver")))
    if decision == "refused":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=policy.OUTSIDE_SHARING_OFF)
    return "active" if decision == "approved" else "pending"


async def save(db: AsyncSession, *, kind: str, resource_id: str, org_id: Optional[str], user_id: str, title: str,
               access: str, live_data: bool, expires_in_days: Optional[int], password: Optional[str],
               clear_password: bool, allowed_domains: List[str]) -> ShareLink:
    """Creates the link, or changes it: the address stays the same however it is set."""
    link = await find(db, kind, resource_id)
    if link is None:
        link = ShareLink(slug=new_slug(), kind=kind, resource_id=uuid.UUID(str(resource_id)),
                         organization_id=uuid.UUID(str(org_id)) if org_id else None,
                         created_by=uuid.UUID(str(user_id)))
        db.add(link)
    link.title, link.access, link.live_data = title[:300], access, live_data
    link.allowed_domains = [d.strip().lower() for d in allowed_domains if d.strip()]
    link.expires_at = _now() + timedelta(days=expires_in_days) if expires_in_days else None
    if clear_password:
        link.password_hash = None
    elif password:
        link.password_hash = await asyncio.to_thread(_passwords.hash, password)
    link.status = "active" if access == "organization" else await _public_state(db, org_id, user_id, title)
    await db.commit()
    await db.refresh(link)
    await policy.audit("share_link_saved", user_id=user_id, org_id=org_id, resource_type=kind, resource_id=resource_id,
                       metadata={"access": access, "status": link.status, "live_data": live_data})
    if link.status == "pending" and org_id:
        await ask_approvers(db, link, user_id)
    return link


REVIEW_PATH = "/settings?tab=publishing"


def _notice(link: ShareLink, state: str) -> Dict[str, Any]:
    return {"kind": "share_link", "state": state, "link_id": str(link.id), "title": link.title or "A shared link",
            "href": REVIEW_PATH if state == "waiting" else f"/s/{link.slug}"}


async def ask_approvers(db: AsyncSession, link: ShareLink, requester_id: Any, *, reminder: bool = False) -> None:
    """Tell the people who can act, in the app and by email, with a link that goes straight there."""
    from src.core.config import settings as app_settings

    others = [i for i in await policy.approvers(db, link.organization_id) if str(i) != str(requester_id)]
    if not reminder:
        await policy.notify_people(db, others, actor_id=requester_id, metadata=_notice(link, "waiting"))
        await db.commit()
    await policy.email_approvers(db, others, link.title or "A shared link",
                                 f"{app_settings.FRONTEND_URL}{REVIEW_PATH}", reminder=reminder)


async def review_of(db: AsyncSession, link: ShareLink, user_id: str) -> Optional[Dict[str, Any]]:
    """For a waiting link: can this person act, and if not, who can."""
    if link.status != "pending" or not link.organization_id:
        return None
    ids = await policy.approvers(db, link.organization_id)
    rules = await policy.get_policy(db, link.organization_id)
    allowed, reason = policy.may_review(user_id=user_id, requester_id=link.created_by, approver_ids=ids,
                                        second_approver=bool(rules.get("second_approver")))
    return {"can_approve": allowed, "blocked_reason": reason,
            "approvers": await policy.approver_names(db, ids, leave_out=link.created_by)}


async def decide(db: AsyncSession, link: ShareLink, user_id: str, *, approved: bool, note: str = "") -> None:
    """Approve or decline a waiting link, and tell whoever asked."""
    org_id = str(link.organization_id)
    review = await review_of(db, link, user_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This link is no longer waiting for approval.")
    if not review["can_approve"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=("Your organization asks someone else to approve your own links."
                                    if review["blocked_reason"] == "own_work" else "Only organization owners and admins can do this."))
    if approved:
        await policy.require_outside_sharing(db, org_id)
    link.status = "active" if approved else "off"
    await policy.notify_people(db, [link.created_by], actor_id=user_id,
                               metadata={**_notice(link, "approved" if approved else "declined"), "note": note[:300]})
    await db.commit()
    await policy.audit("share_link_approved" if approved else "share_link_declined", user_id=user_id, org_id=org_id,
                       resource_type=link.kind, resource_id=str(link.resource_id), metadata={"note": note[:300]})


async def remind_waiting(db: AsyncSession) -> int:
    """Cron: a link waiting a day gets one reminder."""
    rows = (await db.execute(select(ShareLink).where(
        ShareLink.status == "pending", ShareLink.reminded_at.is_(None),
        ShareLink.updated_at <= _now() - timedelta(hours=24)))).scalars().all()
    for link in rows:
        link.reminded_at = _now()
        await ask_approvers(db, link, link.created_by, reminder=True)
    await db.commit()
    return len(rows)


async def _build_snapshot(db: AsyncSession, link: ShareLink) -> Optional[Dict[str, Any]]:
    from src.modules.feed.snapshot_utils import build_snapshot_payload_from_live_asset

    return await build_snapshot_payload_from_live_asset(
        db, link.kind, link.resource_id, link.created_by, title=link.title or "")


async def _refresh_in_background(link_id: uuid.UUID) -> None:
    """The viewer already has the saved data; the next one gets the fresher copy."""
    if link_id in _refreshing:
        return
    _refreshing.add(link_id)
    try:
        async with async_session() as db:
            link = await db.get(ShareLink, link_id)
            payload = await _build_snapshot(db, link) if link else None
            if payload:
                link.snapshot, link.snapshot_at = payload, _now()
                await db.commit()
    except Exception as exc:  # noqa: BLE001 - the saved copy keeps showing
        logger.warning("Share link %s not refreshed: %s", link_id, exc)
    finally:
        _refreshing.discard(link_id)


def _refuse(detail: str, code: int = status.HTTP_404_NOT_FOUND) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


async def open_link(db: AsyncSession, slug: str, *, password: Optional[str], parent_origin: str,
                    viewer: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """What a person opening this link gets, or why not. Nothing about the item shows until allowed."""
    from src.modules.embed import service as embed_service

    link = (await db.execute(select(ShareLink).where(ShareLink.slug == slug))).scalars().first()
    if link is None or link.status == "off":
        raise _refuse("This link isn't available.")
    if link.status == "pending":
        raise _refuse("This link is waiting for approval.", status.HTTP_403_FORBIDDEN)
    if link.expires_at and link.expires_at < _now():
        raise _refuse("This link has expired.", status.HTTP_410_GONE)
    org_id = str(link.organization_id) if link.organization_id else None
    if link.access == "public":
        await policy.require_outside_sharing(db, org_id)
    else:
        if not viewer:
            raise _refuse("sign_in_required", status.HTTP_401_UNAUTHORIZED)
        from src.modules.pricing.feature_gate import get_user_organization_id

        viewer_org = await get_user_organization_id(str(viewer.get("id") or viewer.get("sub")), db)
        if not org_id or str(viewer_org) != org_id:
            raise _refuse("This link is only for people in the organization.", status.HTTP_403_FORBIDDEN)
    if link.allowed_domains and parent_origin and not embed_service.origin_allowed(parent_origin, link.allowed_domains):
        raise _refuse("This link can't be shown on this site.", status.HTTP_403_FORBIDDEN)
    if link.password_hash:
        if not password:
            raise _refuse("password_required", status.HTTP_401_UNAUTHORIZED)
        if not await asyncio.to_thread(_passwords.verify, password, link.password_hash):
            raise _refuse("wrong_password", status.HTTP_401_UNAUTHORIZED)

    await db.execute(update(ShareLink).where(ShareLink.id == link.id).values(
        view_count=ShareLink.view_count + 1, last_viewed_at=_now()))
    await db.commit()
    await db.refresh(link)
    base = {"kind": link.kind, "title": link.title, "access": link.access}
    if link.live_data:
        created = await embed_service.create_embed_token(
            user_id=str(link.created_by), org_id=org_id, name=f"Share link {link.slug}", scopes=[link.kind],
            resource_id=str(link.resource_id), expires_in_minutes=LIVE_SESSION_MINUTES, kind="signed")
        return {**base, "live_url": same_site_path(created["embed_urls"].get(link.kind))}
    if not link.snapshot:
        link.snapshot = await _build_snapshot(db, link)
        link.snapshot_at = _now()
        await db.commit()
    elif link.snapshot_at and _now() - link.snapshot_at > SAVED_DATA_MAX_AGE:
        asyncio.create_task(_refresh_in_background(link.id))
    if not link.snapshot:
        raise _refuse("This item has nothing to show yet.")
    return {**base, "snapshot": public_snapshot(link.snapshot),
            "updated_at": link.snapshot_at.isoformat() if link.snapshot_at else None}


async def take_down(db: AsyncSession, org_id: Any) -> List[str]:
    """Public links stop with everything else public. Returns them for Undo."""
    rows = (await db.execute(select(ShareLink).where(
        ShareLink.organization_id == org_id, ShareLink.access == "public", ShareLink.status == "active"))).scalars().all()
    for link in rows:
        link.status = "off"
    return [str(link.id) for link in rows]


async def restore(db: AsyncSession, org_id: Any, ids: List[str]) -> None:
    if ids:
        await db.execute(update(ShareLink).where(
            ShareLink.organization_id == org_id, ShareLink.id.in_([uuid.UUID(i) for i in ids])).values(status="active"))
