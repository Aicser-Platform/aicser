import unittest
import uuid
from unittest.mock import AsyncMock, patch

from src.modules.pipeline.connectors.schemas import (
    CheckConnectionResponse,
    ConnectorSpecResponse,
    DiscoverCatalogResponse,
    PresignedUploadResponse,
)
from src.modules.pipeline.connectors.service import ConnectorService
from src.modules.pipeline.gold.schemas import (
    GoldQueryRequest,
    GoldQueryResponse,
    GoldSchemaResponse,
)
from src.modules.pipeline.gold.service import (
    GoldLayerService,
    _classify_column,
)
from src.modules.pipeline.sync.schemas import (
    SyncStatusResponse,
    SyncStreamSelection,
    SyncTriggerRequest,
)
from src.modules.pipeline.sync.service import SyncService


def test_connector_specs_catalog():
    """Verify all supported connectors have valid JSONSchema specs."""
    specs = ConnectorService.get_specs()
    assert len(specs) >= 6

    connector_types = {s.connector_type for s in specs}
    assert "postgresql" in connector_types
    assert "mysql" in connector_types
    assert "clickhouse" in connector_types
    assert "snowflake" in connector_types
    assert "s3" in connector_types
    assert "rest" in connector_types

    # Single spec lookup
    pg_spec = ConnectorService.get_specs("postgresql")[0]
    assert pg_spec.connector_type == "postgresql"
    assert "properties" in pg_spec.connection_schema
    assert "host" in pg_spec.connection_schema["properties"]
    assert "port" in pg_spec.connection_schema["properties"]
    assert "password" in pg_spec.connection_schema["properties"]


async def test_connector_check_connection_mocked():
    """Verify connector check handles success and failure cleanly."""
    with patch(
        "src.modules.data.services.database_connector_service.DatabaseConnectorService.test_connection",
        new=AsyncMock(return_value={"success": True, "details": {"version": "PostgreSQL 16"}}),
    ):
        res = await ConnectorService.check_connection(
            "postgresql",
            {"host": "localhost", "port": 5432, "database": "db", "username": "u", "password": "p"},
        )
        assert res.status == "succeeded"
        assert "Successfully" in res.message
        assert res.latency_ms is not None

    with patch(
        "src.modules.data.services.database_connector_service.DatabaseConnectorService.test_connection",
        new=AsyncMock(return_value={"success": False, "error": "Connection refused"}),
    ):
        res = await ConnectorService.check_connection(
            "postgresql",
            {"host": "badhost", "port": 5432, "database": "db", "username": "u", "password": "p"},
        )
        assert res.status == "failed"
        assert "refused" in res.message


async def test_presigned_upload_generation():
    """Verify presigned S3 upload URL generation."""
    org_id = uuid.uuid4()
    res = await ConnectorService.generate_presigned_upload(org_id, "sales_2026.csv", "text/csv")
    assert isinstance(res, PresignedUploadResponse)
    assert res.upload_url
    assert "sales_2026.csv" in res.object_key
    assert str(org_id) in res.object_key


def test_gold_column_semantic_classification():
    """Verify automatic classification into metric, dimension, timestamp, and identifier."""
    assert _classify_column("id", "integer") == "identifier"
    assert _classify_column("user_id", "varchar") == "identifier"
    assert _classify_column("created_at", "timestamp") == "timestamp"
    assert _classify_column("order_date", "date") == "timestamp"
    assert _classify_column("total_amount", "decimal(10,2)") == "metric"
    assert _classify_column("quantity", "int") == "metric"
    assert _classify_column("country_code", "varchar") == "dimension"
    assert _classify_column("status", "string") == "dimension"


async def test_gold_query_safety_validation():
    """Verify dangerous non-SELECT queries are blocked by the Gold querying engine."""
    org_id = uuid.uuid4()
    mock_db = AsyncMock()

    destructive_queries = [
        "DROP TABLE users",
        "DELETE FROM orders WHERE id = 1",
        "INSERT INTO metrics VALUES ('x', 1)",
        "UPDATE accounts SET balance = 0",
        "ALTER TABLE customers ADD COLUMN hack TEXT",
        "ATTACH 'db.duckdb' AS external",
    ]

    for sql in destructive_queries:
        caught = False
        try:
            await GoldLayerService.execute_gold_query(
                org_id=org_id,
                sql=sql,
                limit=100,
                db=mock_db,
            )
        except ValueError as exc:
            caught = True
            assert "read-only" in str(exc).lower() or "must begin with" in str(exc).lower()
        assert caught, f"Query '{sql}' should have been rejected as unsafe"
