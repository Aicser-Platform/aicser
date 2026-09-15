"""Regression tests for the two critical cross-tenant/unauthenticated bugs
found in ee/modules/project/router.py:

1. create_project relied on @require_permission("project:create",
   organization_id_param="organization_id") -- but organization_id lives
   inside the ProjectCreate request body, not a flat kwarg, so the decorator
   always resolved organization_id=None and silently fell through to a
   global "does this user have project:create anywhere" check. A member of
   any org could create a project inside any other org by naming its
   organization_id in the body. Fixed by an explicit permission check
   against the org actually named in the body.

2. GET/POST /{project_id}/dashboards had no auth dependency at all --
   reachable with no token, no RBAC check, from any network caller. Fixed
   by adding Depends(get_current_user_id) + @require_permission.

These call the router functions directly (not through a TestClient), same
approach as test_data_rbac_guard.py in this repo -- patch RBACService at
the module ee.modules.project.router imports it from, since that's the
real module executing under EE (the src. namespace is a separate object
via the path-extension shim).
"""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from ee.modules.project.router import create_project, list_dashboards, create_dashboard
from ee.modules.project.schemas import ProjectCreate


@pytest.mark.asyncio
async def test_create_project_rejects_when_caller_lacks_permission_in_named_org():
    """The regression itself: a user with no role in the target org must be
    rejected, not silently allowed through via the broken org_id=None fallback."""
    other_org_id = str(uuid4())
    payload = ProjectCreate(name="Sneaky Project", organization_id=other_org_id)

    with patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=False),
    ) as mock_check:
        with pytest.raises(HTTPException) as exc:
            await create_project(project_data=payload, user_id=str(uuid4()))

    assert exc.value.status_code == 403
    # The critical assertion: organization_id passed to the permission check
    # must be the org actually named in the body, not None.
    assert mock_check.await_args.kwargs["organization_id"] == other_org_id
    assert mock_check.await_args.kwargs["permission_code"] == "project:create"


@pytest.mark.asyncio
async def test_create_project_proceeds_when_caller_has_permission_in_named_org():
    """Sanity check the fix doesn't just block everything -- a caller with
    real permission in the target org must still be able to create."""
    org_id = str(uuid4())
    payload = ProjectCreate(name="Legit Project", organization_id=org_id)
    user_id = str(uuid4())
    fake_project = SimpleNamespace(id=uuid4(), name="Legit Project", organization_id=org_id)

    with patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ), patch(
        "src.modules.pricing.usage_tracker.enforce_project_limit", new=AsyncMock(return_value=None)
    ), patch(
        "ee.modules.project.router.ProjectService.create_project",
        new=AsyncMock(return_value=fake_project),
    ) as mock_create, patch(
        "ee.modules.project.router.ProjectResponse.model_validate",
        return_value=fake_project,
    ):
        result = await create_project(project_data=payload, user_id=user_id)

    assert result is fake_project
    # organization_id passed to the actual creation call must be the
    # resolved org, not a raw/empty client value.
    assert mock_create.await_args.kwargs["organization_id"] == org_id


@pytest.mark.asyncio
async def test_create_project_requires_organization_id():
    payload = ProjectCreate(name="No Org", organization_id="")

    with patch(
        "src.modules.pricing.usage_tracker.resolve_organization_id", new=AsyncMock(return_value=None)
    ):
        with pytest.raises(HTTPException) as exc:
            await create_project(project_data=payload, user_id=str(uuid4()))

    assert exc.value.status_code == 400


def test_list_dashboards_requires_authentication_dependency():
    """The regression itself: these two endpoints must declare a real auth
    dependency, not just be reachable with a project_id path param."""
    sig = inspect.signature(list_dashboards.__wrapped__ if hasattr(list_dashboards, "__wrapped__") else list_dashboards)
    assert "user_id" in sig.parameters, "list_dashboards must require an authenticated user"


def test_create_dashboard_requires_authentication_dependency():
    sig = inspect.signature(create_dashboard.__wrapped__ if hasattr(create_dashboard, "__wrapped__") else create_dashboard)
    assert "user_id" in sig.parameters, "create_dashboard must require an authenticated user"


@pytest.mark.asyncio
async def test_list_dashboards_404s_for_deleted_project():
    """Deleted-project dashboards must not remain listable even to a caller
    who otherwise has RBAC access to the (now soft-deleted) project."""
    project_id = uuid4()

    with patch(
        "src.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ), patch(
        "ee.modules.project.router.ProjectService.get_project", new=AsyncMock(return_value=None)
    ):
        with pytest.raises(HTTPException) as exc:
            await list_dashboards(project_id=project_id, db=AsyncMock(), user_id=str(uuid4()))

    assert exc.value.status_code == 404
