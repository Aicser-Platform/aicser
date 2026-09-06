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
        # Calling the endpoint function directly (not through TestClient/FastAPI's
        # request pipeline) bypasses Query(...) default resolution entirely - an
        # omitted `purge` param stays the raw, always-truthy Query(False) sentinel
        # object rather than becoming the actual bool False, forcing the router's
        # `if purge:` branch every time. Must pass real values for every
        # Query-defaulted param when calling directly like this.
        await delete_dashboard(dashboard_id=dashboard_id, purge=False, current_user=mock_user, db=AsyncMock())

    mock_perm.assert_awaited_once()
    call_kwargs = mock_perm.await_args.kwargs
    assert call_kwargs.get("project_id") == str(project_id)
    mock_service.delete.assert_awaited_once_with(dashboard)


@pytest.mark.asyncio
async def test_list_dashboards_ce_scopes_to_caller_not_list_all():
    """Regression: CE used to call list_all() -- every user's dashboards, no
    owner filter. list_dashboards was since refactored onto a single
    DashboardLibraryService.list_library() call whose own _scope_filter()
    does the CE/EE scoping via a SQL WHERE clause instead of dispatching to
    separate list_by_user()/list_all() methods (verified directly in
    dashboard_library_service.py: project_id is None under CE, so
    _scope_filter falls through to `Dashboard.created_by == user_id`, never
    an unfiltered scan) - this now asserts the router passes list_library
    the caller's own user_id and, under CE, project_id=None so that filter
    actually applies."""
    from src.modules.dashboards.router import list_dashboards

    caller_id = uuid4()
    mock_service = MagicMock()
    mock_lib = MagicMock()
    mock_lib.list_library = AsyncMock(return_value={"dashboards": []})

    mock_user = {"id": str(caller_id)}

    with (
        patch("src.modules.dashboards.router.DashboardService", return_value=mock_service),
        patch("src.modules.dashboards.router.DashboardLibraryService", return_value=mock_lib),
        patch("src.modules.dashboards.router.is_ee_enabled", return_value=False),
        patch("src.modules.dashboards.router.user_id_from_payload", return_value=str(caller_id)),
        patch("src.modules.dashboards.router.extract_user_payload", return_value=mock_user),
        patch("src.modules.dashboards.router.require_permission", new_callable=AsyncMock),
    ):
        # Calling the endpoint function directly bypasses Query(...) default
        # resolution - every Query-defaulted param must get a real value here or
        # it stays the raw sentinel object (e.g. int(Query(None)) raises TypeError).
        await list_dashboards(
            project_id=None, q=None, facet="all", collection_id=None,
            limit=None, offset=0, detail="summary", db=AsyncMock(), current_user=mock_user,
        )

    mock_lib.list_library.assert_awaited_once()
    call_kwargs = mock_lib.list_library.await_args.kwargs
    assert call_kwargs.get("user_id") == caller_id
    assert call_kwargs.get("project_id") is None


@pytest.mark.asyncio
async def test_list_dashboards_unauthenticated_gets_nothing():
    """No identifiable caller must get user_id=None passed through to
    list_library(), whose _scope_filter() then matches only legacy
    created_by IS NULL rows (never an unfiltered scan) - not "must not call
    list_all()", since that method no longer exists on this path (see
    test_list_dashboards_ce_scopes_to_caller_not_list_all)."""
    from src.modules.dashboards.router import list_dashboards

    mock_service = MagicMock()
    mock_lib = MagicMock()
    mock_lib.list_library = AsyncMock(return_value={"dashboards": []})

    with (
        patch("src.modules.dashboards.router.DashboardService", return_value=mock_service),
        patch("src.modules.dashboards.router.DashboardLibraryService", return_value=mock_lib),
        patch("src.modules.dashboards.router.is_ee_enabled", return_value=False),
        patch("src.modules.dashboards.router.user_id_from_payload", return_value=None),
        patch("src.modules.dashboards.router.extract_user_payload", return_value={}),
        patch("src.modules.dashboards.router.require_permission", new_callable=AsyncMock),
    ):
        result = await list_dashboards(
            project_id=None, q=None, facet="all", collection_id=None,
            limit=None, offset=0, detail="summary", db=AsyncMock(), current_user=None,
        )

    mock_lib.list_library.assert_awaited_once()
    assert mock_lib.list_library.await_args.kwargs.get("user_id") is None
    assert result == {"dashboards": []}


@pytest.mark.asyncio
async def test_create_dashboard_sets_created_by():
    from src.modules.dashboards.router import create_dashboard
    from src.modules.dashboards.dashboard_schema import DashboardCreateRequest

    caller_id = uuid4()
    created_dashboard = SimpleNamespace(
        id=uuid4(), project_id=None, name="New Dashboard", description=None,
        config=None, created_at=None, updated_at=None,
    )
    mock_service = MagicMock()
    mock_service.create = AsyncMock(return_value=created_dashboard)

    mock_user = {"id": str(caller_id)}

    with (
        patch("src.modules.dashboards.router.DashboardService", return_value=mock_service),
        patch("src.modules.dashboards.router.is_ee_enabled", return_value=False),
        patch("src.modules.dashboards.router.user_id_from_payload", return_value=str(caller_id)),
        patch("src.modules.dashboards.router.extract_user_payload", return_value=mock_user),
        patch("src.modules.dashboards.router.require_permission", new_callable=AsyncMock),
    ):
        await create_dashboard(
            payload=DashboardCreateRequest(title="New Dashboard"),
            project_id=None,
            db=AsyncMock(),
            current_user=mock_user,
        )

    mock_service.create.assert_awaited_once()
    call_args = mock_service.create.await_args.args[0]
    assert call_args["created_by"] == caller_id
