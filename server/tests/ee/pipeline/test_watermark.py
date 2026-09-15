import os
import uuid
from datetime import datetime, timezone

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa
import pytest


def _schema(*cols):
    return {"columns": [{"name": col, "type": "timestamp"} for col in cols]}


def test_configured_column_wins():
    from src.modules.pipeline.ingest.watermark_source import \
        resolve_watermark_column

    assert (
        resolve_watermark_column(_schema("id", "changed_on"), configured="changed_on")
        == "changed_on"
    )


def test_configured_column_must_exist():
    from src.modules.pipeline.ingest.watermark_source import (
        WatermarkColumnNotFound, resolve_watermark_column)

    with pytest.raises(WatermarkColumnNotFound):
        resolve_watermark_column(_schema("id"), configured="nope")


def test_conventional_names_are_preferred_in_order():
    from src.modules.pipeline.ingest.watermark_source import \
        resolve_watermark_column

    assert (
        resolve_watermark_column(_schema("id", "modified_at", "updated_at"))
        == "updated_at"
    )
    assert resolve_watermark_column(_schema("id", "modified_at")) == "modified_at"
    assert resolve_watermark_column(_schema("id", "_ts")) == "_ts"


def test_monotonic_primary_key_is_the_last_resort():
    from src.modules.pipeline.ingest.watermark_source import \
        resolve_watermark_column

    schema = {"columns": [{"name": "id", "type": "bigint", "primary_key": True}]}
    assert resolve_watermark_column(schema) == "id"


def test_monotonic_primary_key_fallback_recognizes_is_primary_key_flag():
    """database_connector_service.py (the real MySQL/Postgres introspection path)
    sets `is_primary_key`, never `primary_key` — see database_connector_service.py:901,1128.
    Every other primary-key check in the codebase (nl2sql_node.py:1189,
    schema_for_llm.py:222,256,835,1041) already checks both flags; this fallback
    must too, or every real introspected table with no conventional watermark
    column name silently has no usable fallback and incremental ingest is
    impossible for it."""
    from src.modules.pipeline.ingest.watermark_source import \
        resolve_watermark_column

    # Exact shape of the real `crm.customers` table as persisted by
    # data_connectivity_service for a live MySQL connection (db_mysql_1789015141).
    schema = {
        "columns": [
            {
                "name": "id",
                "type": "INTEGER",
                "nullable": False,
                "primary_key": False,
                "is_primary_key": True,
            },
            {"name": "name", "type": "VARCHAR(150)", "nullable": False, "primary_key": False},
            {"name": "revenue", "type": "DECIMAL(14, 2)", "nullable": False, "primary_key": False},
        ]
    }
    assert resolve_watermark_column(schema) == "id"


def test_refuses_rather_than_silently_full_loading():
    """A silent full refresh on a huge table is the failure mode this guards against."""
    from src.modules.pipeline.ingest.watermark_source import (
        WatermarkColumnNotFound, resolve_watermark_column)

    schema = {
        "columns": [
            {"name": "name", "type": "text"},
            {"name": "note", "type": "text"},
        ]
    }
    with pytest.raises(WatermarkColumnNotFound) as exc:
        resolve_watermark_column(schema)

    assert exc.value.error_code == "watermark_column_missing"
    assert "watermark" in str(exc.value).lower()


def test_next_checkpoint_takes_the_max_watermark_in_the_batch():
    from src.modules.pipeline.ingest.watermark_source import WatermarkSource

    src = WatermarkSource(
        executor=None,
        source_table="orders",
        watermark_column="updated_at",
    )
    batch = pa.RecordBatch.from_pydict(
        {
            "id": pa.array([1, 2], type=pa.int64()),
            "updated_at": pa.array(
                [
                    datetime(2026, 8, 1, tzinfo=timezone.utc),
                    datetime(2026, 8, 3, tzinfo=timezone.utc),
                ],
                type=pa.timestamp("us", tz="UTC"),
            ),
        }
    )

    checkpoint = src.next_checkpoint(batch)
    assert checkpoint.offset == "2026-08-03 00:00:00+00:00"


async def test_changes_queries_strictly_after_the_checkpoint():
    from src.modules.pipeline.ingest.base import Checkpoint
    from src.modules.pipeline.ingest.watermark_source import WatermarkSource

    issued = []

    class FakeExecutor:
        async def fetch_arrow(self, sql, params):
            issued.append((sql, params))
            return pa.table({"id": pa.array([], type=pa.int64())}).to_batches()

    src = WatermarkSource(
        executor=FakeExecutor(),
        source_table="public.orders",
        watermark_column="updated_at",
    )
    async for _ in src.changes(
        Checkpoint(offset="2026-08-01 00:00:00+00:00"), load_id=uuid.uuid4()
    ):
        pass

    sql, params = issued[0]
    assert "public.orders" in sql
    assert "updated_at > " in sql
    assert "ORDER BY updated_at" in sql
    assert params["since"] == "2026-08-01 00:00:00+00:00"


async def test_build_watermark_source_raises_when_the_table_is_not_in_the_schema(monkeypatch):
    from unittest.mock import AsyncMock

    from src.modules.pipeline.ingest.watermark_source import build_watermark_source

    class FakeDataConnectivityService:
        async def get_data_source_by_id(self, source_id):
            return {"id": source_id, "type": "database"}

        async def get_source_schema(self, source_id):
            return {"success": True, "schema": {"tables": [{"name": "customers", "columns": []}]}}

    monkeypatch.setattr(
        "src.modules.data.services.data_connectivity_service.DataConnectivityService",
        FakeDataConnectivityService,
    )

    ctx = type("Ctx", (), {"pipeline": type("P", (), {"source_asset_id": "ds-1", "options": {}})()})()

    with pytest.raises(ValueError, match="not found in the source schema"):
        await build_watermark_source(ctx, "orders")
