"""Sharing routes for Docs and Slides (under /api/office-files):

  GET    /people?q=                      organization members to share with
  GET    /approvals                      shares waiting for this owner / admin
  POST   /approvals/{share_id}/approve   open it
  POST   /approvals/{share_id}/decline   refuse it (with a note)
  POST   /links/{slug}/open              read-only file behind a link (public links: no sign-in)
  GET    /{file_id}/shares               the file's people and link (owner)
  POST   /{file_id}/shares               share with a person, view or edit (owner)
  PUT    /{file_id}/link                 turn the view link on, for the organization or anyone (owner)
  DELETE /{file_id}/shares/{share_id}    stop a share (owner, or an owner / admin of the organization)
  POST   /{file_id}/remote               start a phone remote for presenting (anyone who can open the file)
  PUT    /{file_id}/remote/{session_id}  the slide on screen, for the phone
  GET    /{file_id}/remote/{session_id}  phone presses since `after`, and whether the phone is connected
  DELETE /{file_id}/remote/{session_id}  end the remote
  GET    /remote/{token}                 the phone page's view (token only)
  POST   /remote/{token}/{action}        next | previous from the phone (token only)
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer, get_current_user
from src.modules.data.services.governed_sql import caller_from_token
from src.modules.feed import publish_policy as policy
from src.modules.office_files import remote, sharing
from src.modules.office_files.models import OfficeFile, OfficeFileShare
from src.modules.office_files.schemas import DecisionIn, LinkShareIn, PersonShareIn, RemoteStateIn

router = APIRouter()


def _uuid(value: Optional[str]) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc


async def _file(db: AsyncSession, file_id: str, user_id: str, *, owner: bool) -> tuple:
    from src.modules.office_files.router import load, load_owned

    caller = caller_from_token({"id": user_id})
    if owner:
        return await load_owned(db, file_id, caller), "owner"
    return await load(db, file_id, caller, write=False)


def _me(token: Union[str, dict]) -> str:
    return caller_from_token(token).user_id


# ── People and approvals ──────────────────────────────────────────────────────────────────────────────


@router.get("/people")
async def list_people(q: str = Query("", max_length=100), token: Union[str, dict] = Depends(JWTCookieBearer()),
                      db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    user_id = _me(token)
    org_id = await sharing.organization_of(db, user_id)
    mine = await sharing.user_ids(db, user_id)
    return {"people": [p for p in await sharing.people(db, org_id, q) if p["id"] not in mine],
            "organization": bool(org_id)}


@router.get("/approvals")
async def list_approvals(token: Union[str, dict] = Depends(JWTCookieBearer()),
                         db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Shares waiting in the organization, for its owners and admins (empty for everyone else)."""
    user_id = _me(token)
    org_id = await sharing.organization_of(db, user_id)
    if not await sharing.is_approver(db, org_id, user_id):
        return {"items": [], "approver": False}
    rows = (await db.execute(
        select(OfficeFileShare, OfficeFile).join(OfficeFile, OfficeFile.id == OfficeFileShare.file_id).where(
            OfficeFileShare.organization_id == _uuid(org_id), OfficeFileShare.status == "pending",
            OfficeFile.is_deleted.is_not(True),
        ).order_by(OfficeFileShare.created_at).limit(200))).all()
    who = await sharing.names(db, [s.person_id for s, _ in rows] + [s.requested_by for s, _ in rows])
    items = []
    for share, f in rows:
        items.append({**sharing.share_dict(share, who), "file_id": str(f.id), "kind": f.kind, "title": f.title,
                      "review": await sharing.review_of(db, share, user_id)})
    return {"items": items, "approver": True}


async def _decide(share_id: str, token: Union[str, dict], db: AsyncSession, *, approved: bool, note: str = ""):
    user_id = _me(token)
    org_id = await sharing.organization_of(db, user_id)
    share = await db.get(OfficeFileShare, _uuid(share_id))
    if not share or not org_id or str(share.organization_id) != org_id:
        raise HTTPException(status_code=404, detail="Share not found")
    f = await db.get(OfficeFile, share.file_id)
    if not f or f.is_deleted:
        raise HTTPException(status_code=404, detail="Share not found")
    await sharing.decide(db, share, f, user_id, approved=approved, note=note)
    return {"share": sharing.share_dict(share, await sharing.names(db, [share.person_id, share.requested_by]))}


@router.post("/approvals/{share_id}/approve")
async def approve(share_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                  db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    return await _decide(share_id, token, db, approved=True)


@router.post("/approvals/{share_id}/decline")
async def decline(share_id: str, body: DecisionIn, token: Union[str, dict] = Depends(JWTCookieBearer()),
                  db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    return await _decide(share_id, token, db, approved=False, note=body.note)


# ── Links ─────────────────────────────────────────────────────────────────────────────────────────────


@router.post("/links/{slug}/open")
async def open_link(slug: str, request: Request, db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """The file behind a view link. Nothing about it shows until the link is approved and the viewer may see it."""
    share = (await db.execute(select(OfficeFileShare).where(
        OfficeFileShare.slug == slug[:24], OfficeFileShare.target == "link"))).scalars().first()
    if not share or share.status in ("off", "declined"):
        raise HTTPException(status_code=404, detail="This link isn't available.")
    if share.status == "pending":
        raise HTTPException(status_code=403, detail="This link is waiting for approval.")
    f = await db.get(OfficeFile, share.file_id)
    if not f or f.is_deleted:
        raise HTTPException(status_code=404, detail="This link isn't available.")
    org_id = str(share.organization_id) if share.organization_id else None
    if share.link_access == "public":
        await policy.require_outside_sharing(db, org_id)
    else:
        try:
            viewer: Optional[Dict[str, Any]] = await get_current_user(request)
        except HTTPException:
            viewer = None
        if not viewer:
            raise HTTPException(status_code=401, detail="sign_in_required")
        viewer_id = str(viewer.get("id") or viewer.get("sub") or viewer.get("user_id") or "")
        if org_id and await sharing.organization_of(db, viewer_id) != org_id:
            raise HTTPException(status_code=403, detail="This link is only for people in the organization.")
    await db.execute(update(OfficeFileShare).where(OfficeFileShare.id == share.id).values(
        view_count=OfficeFileShare.view_count + 1))
    await db.commit()
    return {"kind": f.kind, "title": f.title, "body": f.body or {}, "access": share.link_access,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None}


# ── Phone remote (token only: the phone isn't signed in) ──────────────────────────────────────────────


@router.get("/remote/{token}")
async def phone_view(token: str, db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    session = await remote.by_token(db, token)
    session.phone_seen_at = sharing.now()
    await db.commit()
    return remote.phone_view(session)


@router.post("/remote/{token}/{action}")
async def phone_press(token: str, action: str, db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    session = await remote.by_token(db, token)
    await remote.press(db, session, action)
    return remote.phone_view(session)


# ── One file's shares ─────────────────────────────────────────────────────────────────────────────────


async def _shares(db: AsyncSession, f: OfficeFile) -> Dict[str, Any]:
    rows = (await db.execute(select(OfficeFileShare).where(
        OfficeFileShare.file_id == f.id, OfficeFileShare.status.in_(("pending", "active", "declined")),
    ).order_by(OfficeFileShare.created_at))).scalars().all()
    who = await sharing.names(db, [s.person_id for s in rows] + [s.requested_by for s in rows])
    people = [sharing.share_dict(s, who) for s in rows if s.target == "person"]
    link = next((sharing.share_dict(s, who) for s in rows if s.target == "link"), None)
    return {"people": people, "link": link}


@router.get("/{file_id}/shares")
async def get_shares(file_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                     db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    f, _ = await _file(db, file_id, _me(token), owner=True)
    return await _shares(db, f)


@router.post("/{file_id}/shares", status_code=201)
async def share_with_person(file_id: str, body: PersonShareIn, token: Union[str, dict] = Depends(JWTCookieBearer()),
                            db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Share with one member of the organization. Changing someone's access asks for approval again."""
    user_id = _me(token)
    f, _ = await _file(db, file_id, user_id, owner=True)
    org_id = await sharing.organization_of(db, user_id)
    person = await sharing.users_row_id(db, body.person_id)
    if not person or str(person) in await sharing.user_ids(db, user_id):
        raise HTTPException(status_code=400, detail="Choose someone else in your organization.")
    if org_id and str(person) not in {p["id"] for p in await sharing.people(db, org_id, "", limit=10_000)}:
        raise HTTPException(status_code=400, detail="You can only share with people in your organization.")
    share = (await db.execute(select(OfficeFileShare).where(
        OfficeFileShare.file_id == f.id, OfficeFileShare.target == "person",
        OfficeFileShare.person_id == person))).scalars().first()
    if share and share.status in ("pending", "active") and share.role == body.role:
        return await _shares(db, f)
    if share is None:
        share = OfficeFileShare(file_id=f.id, target="person", person_id=person,
                                organization_id=_uuid(org_id) if org_id else None,
                                requested_by=await sharing.users_row_id(db, user_id) or _uuid(user_id))
        db.add(share)
    share.role = body.role
    share.status = await sharing.starting_status(db, org_id, user_id, public=False)
    share.decided_by = share.decided_at = share.note = None
    await db.commit()
    await db.refresh(share)
    await sharing.after_request(db, share, f, user_id)
    return await _shares(db, f)


@router.put("/{file_id}/link")
async def set_link(file_id: str, body: LinkShareIn, token: Union[str, dict] = Depends(JWTCookieBearer()),
                   db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Turn on the file's view link (the address stays the same when its access changes)."""
    user_id = _me(token)
    f, _ = await _file(db, file_id, user_id, owner=True)
    org_id = await sharing.organization_of(db, user_id)
    share = (await db.execute(select(OfficeFileShare).where(
        OfficeFileShare.file_id == f.id, OfficeFileShare.target == "link"))).scalars().first()
    if share and share.status in ("pending", "active") and share.link_access == body.access:
        return await _shares(db, f)
    if share is None:
        share = OfficeFileShare(file_id=f.id, target="link", role="view", slug=sharing.new_slug(),
                                organization_id=_uuid(org_id) if org_id else None,
                                requested_by=await sharing.users_row_id(db, user_id) or _uuid(user_id))
        db.add(share)
    share.link_access = body.access
    share.status = await sharing.starting_status(db, org_id, user_id, public=body.access == "public")
    share.decided_by = share.decided_at = share.note = None
    await db.commit()
    await db.refresh(share)
    await sharing.after_request(db, share, f, user_id)
    return await _shares(db, f)


@router.delete("/{file_id}/shares/{share_id}")
async def stop_share(file_id: str, share_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                     db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Stop a person's access or the link. Owners and admins of the organization may stop any share in it."""
    user_id = _me(token)
    share = await db.get(OfficeFileShare, _uuid(share_id))
    f = await db.get(OfficeFile, _uuid(file_id))
    if not share or not f or share.file_id != f.id:
        raise HTTPException(status_code=404, detail="Share not found")
    owner = str(f.user_id) in await sharing.user_ids(db, user_id)
    org_id = str(share.organization_id) if share.organization_id else None
    if not owner and not await sharing.is_approver(db, org_id, user_id):
        raise HTTPException(status_code=404, detail="Share not found")
    share.status = "off"
    await db.commit()
    await policy.audit("office_share_stopped", user_id=user_id, org_id=org_id, resource_type=f.kind,
                       resource_id=str(f.id), metadata={"target": share.target})
    return await _shares(db, f)


# ── Phone remote (presenter side) ─────────────────────────────────────────────────────────────────────


@router.post("/{file_id}/remote", status_code=201)
async def start_remote(file_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                       db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    user_id = _me(token)
    f, _ = await _file(db, file_id, user_id, owner=False)
    if f.kind != "presentation":
        raise HTTPException(status_code=400, detail="Only presentations have a phone remote.")
    return await remote.start(db, f.id, await sharing.users_row_id(db, user_id) or _uuid(user_id))


@router.put("/{file_id}/remote/{session_id}")
async def remote_state(file_id: str, session_id: str, body: RemoteStateIn,
                       token: Union[str, dict] = Depends(JWTCookieBearer()),
                       db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    user_id = _me(token)
    session = await remote.owned(db, session_id, _uuid(file_id), await sharing.user_ids(db, user_id))
    session.state = remote.clean_state(body.model_dump())
    await db.commit()
    return {"connected": remote.connected(session)}


@router.get("/{file_id}/remote/{session_id}")
async def remote_commands(file_id: str, session_id: str, after: int = Query(0, ge=0),
                          token: Union[str, dict] = Depends(JWTCookieBearer()),
                          db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    user_id = _me(token)
    session = await remote.owned(db, session_id, _uuid(file_id), await sharing.user_ids(db, user_id))
    return {"commands": remote.commands_after(session, after), "connected": remote.connected(session)}


@router.delete("/{file_id}/remote/{session_id}", status_code=204)
async def end_remote(file_id: str, session_id: str, token: Union[str, dict] = Depends(JWTCookieBearer()),
                     db: AsyncSession = Depends(get_async_session)) -> None:
    user_id = _me(token)
    session = await remote.owned(db, session_id, _uuid(file_id), await sharing.user_ids(db, user_id))
    await db.delete(session)
    await db.commit()
