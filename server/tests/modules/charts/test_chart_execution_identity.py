"""Chart execution uses the viewer's identity, not the chart author's."""

import os
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401
from src.modules.data.services.query_identity import (
    QueryIdentity,
    RowSecurityDenied,
    RowSecurityIdentityRequired,
)


class _ExecuteResult:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class _Session:
    def __init__(self, row):
        self._row = row

    async def execute(self, _query):
        return _ExecuteResult(self._row)


@pytest.mark.asyncio
async def test_execute_forwards_the_viewers_identity_not_the_authors(monkeypatch):
    from src.modules.charts.services.v2 import chart_service as cs

    seen = {}

    class _Engine:
        async def execute_query(self, _query, _data_source, **kwargs):
            seen["identity"] = kwargs.get("identity")
            return {"success": True, "data": [], "columns": []}

    data_source = SimpleNamespace(
        id="ds-1",
        type="database",
        db_type="postgres",
        format=None,
        schema={},
        connection_config={},
        project_id="project-1",
        user_id="owner-7",
        file_path=None,
    )
    chart = SimpleNamespace(
        chart_type="bar",
        chart_query={},
        chart_options={"sample_sql": "SELECT * FROM orders"},
        data_source_id="ds-1",
        user_id="author-9",
    )
    viewer = QueryIdentity(
        user_id="viewer-1",
        organization_id="org-1",
        project_id="project-1",
    )

    monkeypatch.setattr(cs, "get_multi_engine_query_service", lambda: _Engine())

    await cs.ChartService(_Session(data_source)).execute(chart, identity=viewer)

    assert seen["identity"] is viewer
    assert seen["identity"].user_id == "viewer-1"


@pytest.mark.asyncio
async def test_stat_period_comparison_reuses_the_viewers_identity(monkeypatch):
    from src.modules.charts.services.v2 import chart_service as cs

    seen = []

    class _Engine:
        async def execute_query(self, _query, _data_source, **kwargs):
            seen.append(kwargs.get("identity"))
            return {
                "success": True,
                "data": [{"value": len(seen)}],
                "columns": ["value"],
            }

    data_source = SimpleNamespace(
        id="ds-1",
        type="database",
        db_type="postgres",
        format=None,
        schema={},
        connection_config={},
        project_id="project-1",
        user_id="owner-7",
        file_path=None,
    )
    chart = SimpleNamespace(
        chart_type="stat",
        chart_query={
            "filters": [
                {"field": "created_at", "operator": ">=", "value": "2026-08-01"},
                {"field": "created_at", "operator": "<=", "value": "2026-08-19"},
            ]
        },
        chart_options={
            "sample_sql": "SELECT COUNT(*) AS value FROM orders",
            "comparisonPeriod": "mom",
        },
        data_source_id="ds-1",
        user_id="author-9",
    )
    viewer = QueryIdentity(
        user_id="viewer-1",
        organization_id="org-1",
        project_id="project-1",
    )

    monkeypatch.setattr(cs, "get_multi_engine_query_service", lambda: _Engine())

    result = await cs.ChartService(_Session(data_source)).execute(chart, identity=viewer)

    assert result["value"] == 1
    assert result["comparisonValue"] == 2
    assert seen == [viewer, viewer]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        RowSecurityDenied("row filter denied this query"),
        RowSecurityIdentityRequired(),
    ],
)
async def test_file_chart_does_not_swallow_row_security_into_unfiltered_fallback(
    monkeypatch, exc
):
    from src.modules.charts.services.v2 import chart_service as cs

    fallback_called = {"yes": False}

    async def _deny(self, *args, **kwargs):
        raise exc

    def _unfiltered_fallback(self, *args, **kwargs):
        fallback_called["yes"] = True
        return {"x": ["leaked"], "y": [1]}

    monkeypatch.setattr(cs.ChartService, "_execute_db_source", _deny)
    monkeypatch.setattr(cs.ChartService, "_execute_file_source", _unfiltered_fallback)

    data_source = SimpleNamespace(
        id="ds-1",
        type="file",
        db_type=None,
        format="csv",
        schema={},
        connection_config={},
        project_id="project-1",
        user_id="owner-7",
        file_path="/tmp/orders.csv",
    )
    chart = SimpleNamespace(
        chart_type="bar",
        chart_query={"x": "region", "aggregate": "count"},
        chart_options={},
        data_source_id="ds-1",
        user_id="author-9",
    )
    viewer = QueryIdentity(user_id="viewer-1")

    with pytest.raises(type(exc)):
        await cs.ChartService(_Session(data_source)).execute(chart, identity=viewer)

    assert fallback_called["yes"] is False
