"""enforce_publish_owner_edit used to unconditionally return (no-op) - any
authenticated user, anywhere in the system, with zero ownership or role
check, could POST /dashboards/{id}/publish on ANY dashboard and make it
publicly, anonymously readable. This is the regression suite for the fix:
creator, or (EE only) an org owner/admin or holder of dashboard:publish in
that dashboard's own project, may publish; everyone else is rejected.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.dashboards.permissions import enforce_publish_owner_edit


def _make_db(dashboard, org_id=None):
    """Mock AsyncSession.execute(): 1st call returns the dashboard row,
    2nd call (if reached) returns the owning project's organization_id."""
    dashboard_result = SimpleNamespace(scalar_one_or_none=lambda: dashboard)
    org_result = SimpleNamespace(scalar_one_or_none=lambda: org_id)
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[dashboard_result, org_result])
    return db


def _dashboard(created_by=None, project_id=None):
    return SimpleNamespace(id=uuid4(), created_by=created_by, project_id=project_id)


@pytest.mark.asyncio
async def test_unauthenticated_rejected():
    db = _make_db(_dashboard())
    with pytest.raises(HTTPException) as exc:
        await enforce_publish_owner_edit(db, uuid4(), {})
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_dashboard_not_found():
    db = _make_db(None)
    with pytest.raises(HTTPException) as exc:
        await enforce_publish_owner_edit(db, uuid4(), {"id": "u1"})
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_creator_allowed():
    dashboard = _dashboard(created_by="u1")
    db = _make_db(dashboard)
    # Should not raise - creator always allowed, CE or EE.
    await enforce_publish_owner_edit(db, dashboard.id, {"id": "u1"})


@pytest.mark.asyncio
async def test_ce_non_creator_rejected():
    dashboard = _dashboard(created_by="someone-else")
    db = _make_db(dashboard)
    with patch("src.core.edition.is_ee_enabled", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await enforce_publish_owner_edit(db, dashboard.id, {"id": "u1"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ee_non_creator_with_publish_permission_allowed():
    project_id = uuid4()
    org_id = uuid4()
    dashboard = _dashboard(created_by="someone-else", project_id=project_id)
    db = _make_db(dashboard, org_id=org_id)
    with patch("src.core.edition.is_ee_enabled", return_value=True), patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ):
        await enforce_publish_owner_edit(db, dashboard.id, {"id": "u1"})


@pytest.mark.asyncio
async def test_ee_non_creator_org_admin_allowed():
    project_id = uuid4()
    org_id = uuid4()
    dashboard = _dashboard(created_by="someone-else", project_id=project_id)
    db = _make_db(dashboard, org_id=org_id)
    with patch("src.core.edition.is_ee_enabled", return_value=True), patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=False),
    ), patch(
        "src.modules.authentication.rbac_service.has_org_role",
        new=AsyncMock(return_value=True),
    ):
        await enforce_publish_owner_edit(db, dashboard.id, {"id": "u1"})


@pytest.mark.asyncio
async def test_ee_non_creator_no_permission_rejected():
    """The exact vulnerability this fix closes: an unrelated user with no
    ownership, no dashboard:publish grant, and no org admin role must NOT
    be able to publish someone else's dashboard."""
    project_id = uuid4()
    org_id = uuid4()
    dashboard = _dashboard(created_by="someone-else", project_id=project_id)
    db = _make_db(dashboard, org_id=org_id)
    with patch("src.core.edition.is_ee_enabled", return_value=True), patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=False),
    ), patch(
        "src.modules.authentication.rbac_service.has_org_role",
        new=AsyncMock(return_value=False),
    ):
        with pytest.raises(HTTPException) as exc:
            await enforce_publish_owner_edit(db, dashboard.id, {"id": "u1"})
    assert exc.value.status_code == 403
