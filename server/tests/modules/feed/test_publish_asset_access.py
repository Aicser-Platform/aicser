"""_validate_publish_asset used to only check that a dashboard/chart row
existed - not that the publishing user had any view access to it. Combined
with publish_asset() trusting the client-supplied organization_id/project_id
(omitting them skipped the role check entirely and auto-approved public
visibility, service_actions.py's own status_value logic), any authenticated
user could publish ANY dashboard/chart from ANY other org onto the
unauthenticated /feed/public feed just by supplying its UUID.

This is the regression suite for the fix: access is now actually verified,
and the asset's real project_id (not the client's claim) drives the
downstream role/approval checks.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.feed.schemas import AssetType
from src.modules.feed.service_actions import FeedServiceActionMixin


def _mixin(db):
    obj = FeedServiceActionMixin()
    obj.db = db
    return obj


def _db_returning(record):
    result = SimpleNamespace(first=lambda: record)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.mark.asyncio
async def test_dashboard_not_found():
    svc = _mixin(_db_returning(None))
    with pytest.raises(HTTPException) as exc:
        await svc._validate_publish_asset(AssetType.dashboard, uuid4(), uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_dashboard_owner_allowed_returns_project_id():
    project_id = uuid4()
    user_id = uuid4()
    svc = _mixin(_db_returning((project_id, str(user_id))))
    result = await svc._validate_publish_asset(AssetType.dashboard, uuid4(), user_id)
    assert result == project_id


@pytest.mark.asyncio
async def test_dashboard_non_owner_without_view_access_rejected():
    """The exact vulnerability: a user with no view access to someone else's
    dashboard must not be able to publish it."""
    project_id = uuid4()
    svc = _mixin(_db_returning((project_id, "someone-else")))
    with patch(
        "src.modules.authentication.rbac_service.has_dashboard_access",
        new=AsyncMock(return_value=False),
    ):
        with pytest.raises(HTTPException) as exc:
            await svc._validate_publish_asset(AssetType.dashboard, uuid4(), uuid4())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_dashboard_non_owner_with_view_access_allowed():
    project_id = uuid4()
    svc = _mixin(_db_returning((project_id, "someone-else")))
    with patch(
        "src.modules.authentication.rbac_service.has_dashboard_access",
        new=AsyncMock(return_value=True),
    ):
        result = await svc._validate_publish_asset(AssetType.dashboard, uuid4(), uuid4())
    assert result == project_id


@pytest.mark.asyncio
async def test_chart_non_owner_ce_rejected():
    """CE has no project-scoped RBAC to check against - non-owner is always denied."""
    svc = _mixin(_db_returning((uuid4(), "someone-else")))
    with patch("src.modules.feed.service_actions.is_ee_enabled", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await svc._validate_publish_asset(AssetType.chart, uuid4(), uuid4())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_chart_non_owner_personal_chart_rejected():
    """No project_id means nothing to scope an RBAC check against."""
    svc = _mixin(_db_returning((None, "someone-else")))
    with patch("src.modules.feed.service_actions.is_ee_enabled", return_value=True):
        with pytest.raises(HTTPException) as exc:
            await svc._validate_publish_asset(AssetType.chart, uuid4(), uuid4())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_chart_non_owner_ee_project_permission_denied():
    project_id = uuid4()
    svc = _mixin(_db_returning((project_id, "someone-else")))
    with patch("src.modules.feed.service_actions.is_ee_enabled", return_value=True), patch(
        "src.modules.charts.router._enforce_standalone_chart_access",
        new=AsyncMock(side_effect=HTTPException(status_code=403, detail="denied")),
    ):
        with pytest.raises(HTTPException) as exc:
            await svc._validate_publish_asset(AssetType.chart, uuid4(), uuid4())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_chart_non_owner_ee_project_permission_allowed():
    project_id = uuid4()
    svc = _mixin(_db_returning((project_id, "someone-else")))
    with patch("src.modules.feed.service_actions.is_ee_enabled", return_value=True), patch(
        "src.modules.charts.router._enforce_standalone_chart_access",
        new=AsyncMock(return_value=None),
    ):
        result = await svc._validate_publish_asset(AssetType.chart, uuid4(), uuid4())
    assert result == project_id
