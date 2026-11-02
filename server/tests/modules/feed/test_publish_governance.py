"""Publishing rules on the real service code: off switch, separation of duties, edits after approval,
take-down, and a dashboard's public access. The database is faked; nothing here touches a real org."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.feed import publish_policy as policy
from src.modules.feed import service_actions as sa
from src.modules.feed.schemas import PublicationStatus, UpdateSnapshotRequest
from src.modules.feed.service_actions import FeedServiceActionMixin


def _svc(db=None):
    svc = FeedServiceActionMixin()
    svc.db = db or AsyncMock()
    return svc


def _post(**kw):
    base = dict(id=uuid4(), visibility="public", status="approved", asset_type="dashboard", asset_id=uuid4(), author_id=uuid4(),
                organization_id=uuid4(), project_id=uuid4(), title="Sales", description="", preview_metadata={}, approved_at=datetime.now(timezone.utc),
                approved_by=uuid4(), current_snapshot_id=None, requires_login=False, snapshot_version=1, expires_at=None, last_activity_at=None)
    return SimpleNamespace(**{**base, **kw})


@pytest.mark.asyncio
async def test_public_off_refuses_even_an_owner():
    svc = _svc()
    with patch.object(policy, "get_policy", AsyncMock(return_value={"public": "off"})), patch.object(policy, "approvers", AsyncMock(return_value=[uuid4()])):
        with pytest.raises(HTTPException) as exc:
            await svc._public_status(uuid4(), uuid4(), True, "Title")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_owner_and_admin_both_approve_but_not_their_own_work():
    author, other = uuid4(), uuid4()
    svc = _svc()
    post = _post(author_id=author)
    svc._get_role_names = AsyncMock(return_value={"org_admin"})
    with patch.object(policy, "approvers", AsyncMock(return_value=[author, other])):
        await svc._assert_can_approve_post(other, post)  # an admin may
        with pytest.raises(HTTPException) as exc:
            await svc._assert_can_approve_post(author, post)
    assert exc.value.status_code == 403
    with patch.object(policy, "approvers", AsyncMock(return_value=[author])):
        await svc._assert_can_approve_post(author, post)  # the only approver may


@pytest.mark.asyncio
async def test_member_cannot_approve_public():
    svc = _svc()
    svc._get_role_names = AsyncMock(return_value={"org_member"})
    with pytest.raises(HTTPException):
        await svc._assert_can_approve_post(uuid4(), _post())


@pytest.mark.asyncio
async def test_new_content_on_approved_public_work_goes_back_to_review():
    post = _post()
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    svc = _svc(db)
    svc.resolve_user_id = MagicMock(return_value=post.author_id)
    svc._get_role_names = AsyncMock(return_value={"org_member"})
    svc._get_approver_ids = AsyncMock(return_value=[uuid4()])
    svc._create_notification = AsyncMock()
    svc._public_status = AsyncMock(return_value=("pending", False, True))
    svc._after_public_status = AsyncMock()
    with patch.object(sa, "enforce_snapshot_update_owner", AsyncMock(return_value=post)), patch.object(sa, "create_feed_snapshot", AsyncMock()):
        res = await svc.update_publication_snapshot(post.id, UpdateSnapshotRequest(snapshot_payload={"rows": 1}), {"id": str(post.author_id)})
    assert post.status == "pending" and post.approved_at is None and post.approved_by is None
    assert res.status == PublicationStatus.pending
    svc._create_notification.assert_awaited_once()


@pytest.mark.asyncio
async def test_take_down_makes_everything_private_and_is_audited():
    org, posts = uuid4(), [_post(), _post()]
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: posts)),
                                        SimpleNamespace(all=lambda: [("d1",)])])
    with patch.object(policy, "audit", AsyncMock()) as audit, patch.object(policy, "get_policy", AsyncMock(return_value={})), \
            patch.object(policy, "set_policy", AsyncMock()) as remember:
        out = await _svc(db).take_down_public(org, uuid4())
    assert remember.await_args.args[2]["last_take_down"]["dashboards"] == ["d1"]
    assert {p.visibility for p in posts} == {"private"} and out["dashboards"] == ["d1"] and len(out["posts"]) == 2
    assert audit.await_args.args[0] == "public_take_down"


@pytest.mark.asyncio
async def test_expired_public_items_end_and_their_dashboard_closes():
    post = _post(expires_at=datetime.now(timezone.utc) - timedelta(hours=1))
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [post])),
                                        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))])
    from src.modules.dashboards import operations as ops

    with patch.object(policy, "audit", AsyncMock()), patch.object(ops, "publish_dashboard", AsyncMock()) as close:
        out = await _svc(db).publishing_housekeeping()
    assert post.visibility == "private" and out == {"expired": 1, "reminded": 0}
    assert close.await_args.args[2] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("state,opened", [("approved", True), ("pending", False)])
async def test_dashboard_opens_only_once_approved(state, opened):
    from src.modules.dashboards import operations as ops
    from src.modules.feed import service as feed_service

    dash = SimpleNamespace(name="D", description="", project_id=None)
    service = MagicMock()
    service.publish_asset = AsyncMock(return_value=SimpleNamespace(status=PublicationStatus(state)))
    with patch.object(ops, "DashboardService", return_value=SimpleNamespace(get_by_id=AsyncMock(return_value=dash))), \
         patch.object(feed_service, "FeedService", return_value=service), patch.object(ops, "publish_dashboard", AsyncMock()) as opener:
        out = await ops.request_public_access(AsyncMock(), uuid4(), {"id": "u"})
    assert out["is_public"] is opened and opener.await_count == (1 if opened else 0)


@pytest.mark.asyncio
async def test_undo_restores_only_what_the_take_down_took():
    svc = _svc()
    with patch.object(policy, "get_policy", AsyncMock(return_value={"public": "approval"})):
        with pytest.raises(HTTPException) as exc:
            await svc.restore_public(uuid4(), uuid4())
    assert exc.value.status_code == 409
