"""Embedded charts run like embedded dashboards.

The chart embed endpoint used to execute with identity=None: a signed chart token's locked
filters were never applied (every tenant's rows came back), and any source with row or column
security refused to run. It now runs as the token's creator, in the chart's project, carrying
the token's locked filters, the same identity the dashboard embed path builds.
"""

import time
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, Response

from src.modules.charts import router as charts_router
from src.modules.charts.services.v2 import chart_service as chart_service_module
from src.modules.embed import locked_filters
from src.modules.embed import service as embed_service

CHART_ID = "11111111-1111-1111-1111-111111111111"
PROJECT_ID = "22222222-2222-2222-2222-222222222222"
LOCKED = [{"field": "tenant_id", "value": ["acme"]}]


def _token(**extra):
    return embed_service.sign_embed_token(
        {
            "jti": str(uuid.uuid4()),
            "sub": "creator-1",
            "type": "embed",
            "scopes": ["chart"],
            "resource_id": CHART_ID,
            "exp": int(time.time()) + 600,
            **extra,
        }
    )


class _FakeChartService:
    """Records the identity each execute() ran with; optionally fails like the real one."""

    calls = []
    error = None

    def __init__(self, db):
        pass

    async def get(self, chart_id):
        return SimpleNamespace(
            id=chart_id, project_id=PROJECT_ID, title="Sales", chart_type="bar", chart_query={}, chart_options={}
        )

    async def execute(self, chart, *, identity=None):
        type(self).calls.append(identity)
        if type(self).error:
            raise Exception(type(self).error)
        return {"x": ["acme"], "y": [1]}


@pytest.fixture
def endpoint(monkeypatch):
    _FakeChartService.calls = []
    _FakeChartService.error = None
    monkeypatch.setattr(chart_service_module, "ChartService", _FakeChartService)
    monkeypatch.setattr(
        embed_service,
        "verify_embed_token",
        AsyncMock(return_value={"resource_id": CHART_ID, "allowed_domains": [], "session": True, "org_id": None}),
    )
    monkeypatch.setattr(charts_router, "_check_embed_domain", lambda *a, **k: None)
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=AsyncMock())
    session.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(charts_router, "async_session", lambda: session)

    async def call(token):
        return await charts_router.get_chart_for_embed(CHART_ID, MagicMock(), Response(), token=token)

    return call


@pytest.mark.asyncio
async def test_chart_embed_runs_as_creator_with_locked_filters(endpoint):
    result = await endpoint(_token(org_id="org-1", locked_filters=LOCKED))

    assert result["data"] == {"x": ["acme"], "y": [1]}
    (identity,) = _FakeChartService.calls
    assert identity is not None, "an embedded chart must never run without an identity"
    assert identity.user_id == "creator-1"
    assert identity.organization_id == "org-1"
    assert identity.project_id == PROJECT_ID
    assert identity.token_payload["embed_locked_filters"] == LOCKED


@pytest.mark.asyncio
async def test_public_chart_embed_runs_as_creator_without_filters(endpoint):
    await endpoint(_token())

    (identity,) = _FakeChartService.calls
    assert identity.user_id == "creator-1"
    assert identity.token_payload["embed_locked_filters"] == []


@pytest.mark.asyncio
async def test_locked_filter_refusal_is_shown_to_the_viewer(endpoint):
    _FakeChartService.error = f"Query execution failed: {locked_filters.NO_FILTER_COLUMN}"

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(_token(locked_filters=LOCKED))

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == locked_filters.NO_FILTER_COLUMN


@pytest.mark.asyncio
async def test_other_failures_stay_generic(endpoint):
    _FakeChartService.error = "Query execution failed: connection refused to db.internal:5432"

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(_token())

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Chart could not be executed"


def test_refusal_in_finds_each_locked_filter_message():
    for message in (locked_filters.NO_REWRITER, locked_filters.NO_FILTER_COLUMN, locked_filters.UNFILTERABLE_QUERY):
        assert locked_filters.refusal_in(f"Query execution failed: {message}") == message
    assert locked_filters.refusal_in("Query execution failed: syntax error") is None
