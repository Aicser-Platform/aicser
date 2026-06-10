"""Tests for /api/dashboards router (ORM attribute access)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest


def test_serialize_dashboard_merges_legacy_list_config():
    from src.modules.dashboards.router import _serialize_dashboard

    dashboard_id = uuid4()
    project_id = uuid4()
    dashboard = SimpleNamespace(
        id=dashboard_id,
        project_id=project_id,
        name="Revenue Dashboard",
        description=None,
        config=[None, {"theme": "light", "pages_meta": {}, "global_filters": []}],
        created_at=None,
        updated_at=None,
    )

    serialized = _serialize_dashboard(dashboard)

    assert serialized["id"] == dashboard_id
    assert serialized["project_id"] == project_id
    assert serialized["title"] == "Revenue Dashboard"
    assert serialized["config"] == {
        "theme": "light",
        "pages_meta": {},
        "global_filters": [],
    }


@pytest.mark.asyncio
async def test_delete_dashboard_reads_project_id_from_orm():
    """Regression: dashboard from get_by_id is an ORM object, not a dict."""
    from src.modules.dashboards.router import delete_dashboard

    dashboard_id = uuid4()
    project_id = uuid4()
    dashboard = SimpleNamespace(project_id=project_id, id=dashboard_id)

    mock_service = MagicMock()
    mock_service.get_by_id = AsyncMock(return_value=dashboard)
    mock_service.delete = AsyncMock()

    mock_user = {"id": str(uuid4())}

    with (
        patch("src.modules.dashboards.router.DashboardService", return_value=mock_service),
        patch("src.modules.dashboards.router.user_id_from_payload", return_value=uuid4()),
        patch("src.modules.dashboards.router.extract_user_payload", return_value=mock_user),
        patch("src.modules.dashboards.router.require_permission", new_callable=AsyncMock) as mock_perm,
        patch("src.modules.dashboards.router.enforce_publish_owner_edit", new_callable=AsyncMock),
    ):
        await delete_dashboard(dashboard_id=dashboard_id, current_user=mock_user, db=AsyncMock())

    mock_perm.assert_awaited_once()
    call_kwargs = mock_perm.await_args.kwargs
    assert call_kwargs.get("project_id") == str(project_id)
    mock_service.delete.assert_awaited_once_with(dashboard)
