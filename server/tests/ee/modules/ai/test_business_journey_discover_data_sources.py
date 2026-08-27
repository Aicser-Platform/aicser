"""_discover_data_sources used to filter on data_sources.status = 'active', a
column that does not exist on that table (the real column is the boolean
is_active - see DataSource in src/modules/data/models.py). Every call raised
inside the try/except and was swallowed, so Business OS mode always reported
"No data sources are connected yet" regardless of how many were actually
connected. Fixed to go through DataSourceAccessService, the same
permission-aware resolver every other data-source-listing endpoint uses."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ee.modules.ai.nodes.business_journey_nodes import _discover_data_sources


def _mock_db(rows):
    db = MagicMock()
    result = MagicMock()
    result.fetchall.return_value = rows
    db.execute = AsyncMock(return_value=result)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=db)
    cm.__aexit__ = AsyncMock(return_value=False)
    return db, cm


@pytest.mark.asyncio
async def test_discover_data_sources_returns_accessible_sources():
    db, cm = _mock_db([("ds-1", "Sample: Banking", "postgresql", "database")])
    with patch("src.db.session.async_session", return_value=cm), patch(
        "src.modules.data.services.data_source_access_service.DataSourceAccessService.list_accessible_source_ids",
        new=AsyncMock(return_value=["ds-1"]),
    ):
        sources = await _discover_data_sources("user-1", "org-1", project_id="proj-1")

    assert sources == [
        {"id": "ds-1", "name": "Sample: Banking", "db_type": "postgresql", "type": "database"}
    ]


@pytest.mark.asyncio
async def test_discover_data_sources_no_accessible_ids_short_circuits():
    db, cm = _mock_db([])
    with patch("src.db.session.async_session", return_value=cm), patch(
        "src.modules.data.services.data_source_access_service.DataSourceAccessService.list_accessible_source_ids",
        new=AsyncMock(return_value=[]),
    ):
        sources = await _discover_data_sources("user-1", "org-1")

    assert sources == []
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_discover_data_sources_fails_open_on_error():
    db, cm = _mock_db([])
    with patch("src.db.session.async_session", return_value=cm), patch(
        "src.modules.data.services.data_source_access_service.DataSourceAccessService.list_accessible_source_ids",
        new=AsyncMock(side_effect=RuntimeError("db unavailable")),
    ):
        sources = await _discover_data_sources("user-1", "org-1")

    assert sources == []
