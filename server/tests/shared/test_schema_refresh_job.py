"""The scheduled schema refresh must re-introspect live sources — get_source_schema only
returns the stored copy (and never accepted force_refresh), so drift was never detected."""

from unittest.mock import AsyncMock

import pytest

from src.shared.jobs.tasks import _fetch_fresh_schema


@pytest.mark.asyncio
async def test_database_source_is_reintrospected_live():
    svc = AsyncMock()
    svc.get_database_schema.return_value = {"success": True, "schema": {"tables": [{"name": "t"}]}}
    out = await _fetch_fresh_schema(svc, "ds-1")
    svc.get_database_schema.assert_awaited_once_with("ds-1", force_refresh=True)
    svc.get_source_schema.assert_not_called()
    assert out["success"] is True


@pytest.mark.asyncio
async def test_file_source_falls_back_to_stored_schema():
    svc = AsyncMock()
    svc.get_database_schema.return_value = {
        "success": False,
        "error": "Data source is not a database or warehouse connection",
    }
    svc.get_source_schema.return_value = {"success": True, "schema": {"tables": []}}
    out = await _fetch_fresh_schema(svc, "file-1")
    svc.get_source_schema.assert_awaited_once_with("file-1")
    assert out["success"] is True


@pytest.mark.asyncio
async def test_live_failure_is_reported_not_masked():
    svc = AsyncMock()
    svc.get_database_schema.return_value = {"success": False, "error": "connection refused"}
    out = await _fetch_fresh_schema(svc, "ds-2")
    svc.get_source_schema.assert_not_called()
    assert out["success"] is False
