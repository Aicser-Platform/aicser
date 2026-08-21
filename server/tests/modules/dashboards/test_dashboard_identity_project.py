"""Dashboard reads carry the dashboard's project, not just the viewer.

Row filters are granted to a project, so `DataSourceAccessService` resolves a
project grant only when it is told which project is asking. An identity with no
project therefore matches no grant, and `apply_sql_rls` returns the query
unfiltered — filter dropdowns would list values the viewer's row filter is
meant to hide. The JWT does not carry a project, so the dashboard is the only
place that knows it.
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from src.modules.dashboards import router as dash_router

PROJECT_ID = uuid4()
DASHBOARD_ID = uuid4()
CURRENT_USER = {"id": "viewer-1", "organization_id": "org-1"}


def _dashboard():
    dashboard = MagicMock()
    dashboard.id = DASHBOARD_ID
    dashboard.project_id = PROJECT_ID
    return dashboard


@pytest.fixture
def captured_identity(monkeypatch):
    seen = {}

    async def _verify(*_args, **_kwargs):
        return _dashboard()

    monkeypatch.setattr(dash_router.dash_ops, "verify_dashboard_read_access", _verify)

    def _capture(name, result):
        async def _fn(*_args, **kwargs):
            seen[name] = kwargs.get("identity")
            return result

        return _fn

    monkeypatch.setattr(
        dash_router.dash_ops, "get_filter_options", _capture("options", [])
    )
    monkeypatch.setattr(
        dash_router.dash_ops,
        "get_filter_field_stats",
        _capture("stats", {"min": None, "max": None}),
    )
    monkeypatch.setattr(
        dash_router.dash_ops,
        "refresh_dashboard_charts",
        _capture("refresh", {"results": [], "ok": 0, "failed": 0, "total": 0}),
    )
    monkeypatch.setattr(
        dash_router.dash_ops, "build_embed_payload", _capture("embed", {})
    )
    return seen


@pytest.mark.asyncio
async def test_filter_options_identity_names_the_dashboards_project(captured_identity):
    await dash_router.dashboard_filter_options(
        DASHBOARD_ID,
        field="region",
        data_source_id="ds-1",
        table_name=None,
        runtime_filters=None,
        token=None,
        db=MagicMock(),
        current_user=CURRENT_USER,
    )

    assert captured_identity["options"].project_id == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_filter_field_stats_identity_names_the_dashboards_project(
    captured_identity,
):
    await dash_router.dashboard_filter_field_stats(
        DASHBOARD_ID,
        field="amount",
        data_source_id="ds-1",
        table_name=None,
        runtime_filters=None,
        token=None,
        db=MagicMock(),
        current_user=CURRENT_USER,
    )

    assert captured_identity["stats"].project_id == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_refresh_identity_names_the_dashboards_project(captured_identity):
    await dash_router.refresh_dashboard(
        DASHBOARD_ID,
        payload={"charts": []},
        token=None,
        db=MagicMock(),
        current_user=CURRENT_USER,
    )

    assert captured_identity["refresh"].project_id == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_embed_payload_identity_names_the_dashboards_project(captured_identity):
    await dash_router.get_dashboard_embed(
        DASHBOARD_ID,
        page_id=None,
        runtime_filters=None,
        token=None,
        db=MagicMock(),
        current_user=CURRENT_USER,
    )

    assert captured_identity["embed"].project_id == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_a_dashboard_without_a_project_still_yields_an_identity(monkeypatch):
    """No project is not the same as no identity — the user filters still apply."""
    seen = {}

    dashboard = MagicMock()
    dashboard.project_id = None

    async def _verify(*_args, **_kwargs):
        return dashboard

    async def _options(*_args, **kwargs):
        seen["identity"] = kwargs.get("identity")
        return []

    monkeypatch.setattr(dash_router.dash_ops, "verify_dashboard_read_access", _verify)
    monkeypatch.setattr(dash_router.dash_ops, "get_filter_options", _options)

    await dash_router.dashboard_filter_options(
        DASHBOARD_ID,
        field="region",
        data_source_id="ds-1",
        table_name=None,
        runtime_filters=None,
        token=None,
        db=MagicMock(),
        current_user=CURRENT_USER,
    )

    assert seen["identity"] is not None
    assert seen["identity"].user_id == "viewer-1"
    assert seen["identity"].project_id is None


@pytest.mark.asyncio
async def test_widget_execution_identity_names_the_dashboards_project(monkeypatch):
    """The widget path must not depend on the chart row carrying a project."""
    from src.modules.dashboards.charts import router as chart_router

    seen = {}

    async def _verify(*_args, **_kwargs):
        return _dashboard()

    async def _execute(*_args, **kwargs):
        seen["identity"] = kwargs.get("identity")
        return {"x": [], "y": []}

    monkeypatch.setattr(chart_router, "verify_dashboard_read_access", _verify)
    monkeypatch.setattr(chart_router, "_execute_chart_data", _execute)

    await chart_router.execute_chart(
        DASHBOARD_ID,
        uuid4(),
        token=None,
        db=MagicMock(),
        current_user=CURRENT_USER,
    )

    assert seen["identity"].project_id == str(PROJECT_ID)
