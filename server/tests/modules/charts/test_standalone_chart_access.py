"""_enforce_standalone_chart_access used to no-op unconditionally in EE mode
(`if is_ee_enabled(): return`) - the top-of-handler require_ee_permission()
check only verifies a GLOBAL role (no project_id, since chart_id -> project_id
isn't known until after the fetch), so any user holding a chart permission in
ANY single project anywhere could GET/PUT/DELETE any chart_id system-wide.
This is the regression suite for the fix: the check is now re-run scoped to
the chart's own project once it's known, and personal (non-project) charts
owned by someone else are never accessible via a role at all.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.charts.router import _enforce_standalone_chart_access


def _chart(user_id=None, project_id=None):
    return SimpleNamespace(id=uuid4(), user_id=user_id, project_id=project_id)


def _db(org_id=None):
    org_result = SimpleNamespace(scalar_one_or_none=lambda: org_id)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=org_result)
    return db


@pytest.mark.asyncio
async def test_owner_always_allowed_ce_and_ee():
    chart = _chart(user_id="u1")
    db = _db()
    # Owner passes regardless of edition - db.execute must not even be needed.
    await _enforce_standalone_chart_access(chart, "u1", db, "chart:view")
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_ce_non_owner_rejected():
    chart = _chart(user_id="someone-else")
    db = _db()
    with patch("src.modules.charts.router.is_ee_enabled", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await _enforce_standalone_chart_access(chart, "u1", db, "chart:view")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_ee_personal_chart_non_owner_rejected_even_with_a_role():
    """No project_id means nothing to scope an RBAC check against - a
    personal chart owned by someone else must never be reachable via role."""
    chart = _chart(user_id="someone-else", project_id=None)
    db = _db()
    with patch("src.modules.charts.router.is_ee_enabled", return_value=True), patch(
        "src.modules.charts.router.require_ee_permission",
        new=AsyncMock(),  # would "pass" if ever (wrongly) called
    ) as mock_perm:
        with pytest.raises(HTTPException) as exc:
            await _enforce_standalone_chart_access(chart, "u1", db, "chart:view")
    assert exc.value.status_code == 403
    mock_perm.assert_not_called()


@pytest.mark.asyncio
async def test_ee_project_chart_scoped_permission_checked():
    """The core fix: the permission check must be re-run scoped to THIS
    chart's actual project, not left as a no-op."""
    project_id = uuid4()
    org_id = uuid4()
    chart = _chart(user_id="owner", project_id=project_id)
    db = _db(org_id=org_id)
    with patch("src.modules.charts.router.is_ee_enabled", return_value=True), patch(
        "src.modules.charts.router.require_ee_permission",
        new=AsyncMock(),
    ) as mock_perm:
        await _enforce_standalone_chart_access(chart, "u1", db, "chart:edit")

    mock_perm.assert_awaited_once_with(
        "u1", "chart:edit", organization_id=str(org_id), project_id=str(project_id)
    )


@pytest.mark.asyncio
async def test_ee_project_chart_permission_denied_propagates():
    """The exact vulnerability this closes: a user with no real standing in
    the chart's project must be rejected, not silently waved through."""
    project_id = uuid4()
    chart = _chart(user_id="owner", project_id=project_id)
    db = _db(org_id=uuid4())

    async def deny(*a, **kw):
        raise HTTPException(status_code=403, detail="Permission required: chart:view")

    with patch("src.modules.charts.router.is_ee_enabled", return_value=True), patch(
        "src.modules.charts.router.require_ee_permission", new=deny
    ):
        with pytest.raises(HTTPException) as exc:
            await _enforce_standalone_chart_access(chart, "u1", db, "chart:view")
    assert exc.value.status_code == 403
