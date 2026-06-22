"""Tests for schema resolver with mocked data connectivity."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.modules.nl2sql.schema_resolver import resolve_usable_schema


@pytest.mark.asyncio
async def test_resolve_database_schema_from_wrapped_response():
    data_service = MagicMock()
    data_service.get_data_source_by_id = AsyncMock(return_value={
        "id": "ds-1",
        "type": "database",
        "db_type": "postgresql",
        "schema": {},
    })
    data_service.get_database_schema = AsyncMock(return_value={
        "success": True,
        "schema": {
            "tables": [
                {"name": "orders", "columns": [{"name": "id", "type": "int"}]},
            ],
        },
    })

    ds, schema = await resolve_usable_schema(data_service, "ds-1")
    assert ds is not None
    assert schema is not None
    assert schema["tables"][0]["name"] == "orders"


@pytest.mark.asyncio
async def test_resolve_file_legacy_columns_without_live_fetch():
    data_service = MagicMock()
    data_service.get_data_source_by_id = AsyncMock(return_value={
        "id": "file-1",
        "type": "file",
        "schema": {
            "columns": [{"name": "name", "type": "string"}, {"name": "value", "type": "number"}],
            "row_count": 10,
        },
    })

    ds, schema = await resolve_usable_schema(data_service, "file-1")
    assert ds is not None
    assert schema is not None
    assert schema["tables"][0]["name"] == "data"
    data_service.get_database_schema.assert_not_called()
