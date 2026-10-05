"""data_lake_objects bookkeeping for Silver/Gold writes (warehouse/CONTRACT.md)."""

import os
import uuid
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("AISER_EDITION", "enterprise")

import duckdb
import pytest
from sqlalchemy.dialects import postgresql


def _session(existing=None):
    session = AsyncMock()
    session.add = MagicMock()
    lookup = MagicMock()
    lookup.scalar_one_or_none.return_value = existing
    session.execute.side_effect = [lookup, MagicMock()]
    return session


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


async def _register(session, org_id, **overrides):
    from src.modules.pipeline.load.registry import register_lake_object

    kwargs = dict(
        organization_id=org_id,
        layer="gold",
        object_key="org_ab_gold.orders",
        storage_uri="s3://b/orders",
        format="iceberg",
        version="run-2",
        columns=[{"name": "id", "type": "int64"}],
        row_count=10,
        byte_size=5_000_000_000,
    )
    kwargs.update(overrides)
    return await register_lake_object(session, **kwargs)


async def test_new_version_is_added_and_older_active_versions_are_superseded():
    org_id = uuid.uuid4()
    session = _session()

    obj = await _register(session, org_id)

    session.add.assert_called_once_with(obj)
    assert obj.status == "active"
    assert obj.byte_size == 5_000_000_000
    supersede = _sql(session.execute.await_args_list[1].args[0])
    assert supersede.startswith("UPDATE data_lake_objects SET status='superseded'")
    assert "data_lake_objects.object_key = 'org_ab_gold.orders'" in supersede
    assert "data_lake_objects.version != 'run-2'" in supersede
    assert f"data_lake_objects.organization_id = '{org_id}'" in supersede
    assert "data_lake_objects.status = 'active'" in supersede


async def test_rerun_of_the_same_version_updates_the_row_in_place():
    from src.modules.data.models import DataLakeObject

    existing = DataLakeObject(object_key="org_ab_gold.orders", version="run-2", status="superseded", row_count=1)
    session = _session(existing)

    obj = await _register(session, uuid.uuid4())

    assert obj is existing
    session.add.assert_not_called()
    assert existing.status == "active"
    assert existing.row_count == 10


async def test_supersede_without_an_organization_matches_only_unowned_rows():
    session = _session()

    await _register(session, None)

    assert "data_lake_objects.organization_id IS NULL" in _sql(session.execute.await_args_list[1].args[0])


def test_parquet_shape_reports_columns_and_size(tmp_path):
    from src.modules.pipeline.dbt.runner import _parquet_shape

    path = str(tmp_path / "data.parquet")
    conn = duckdb.connect()
    conn.execute(f"COPY (SELECT 1::BIGINT AS id, 'eu' AS region) TO '{path}' (FORMAT PARQUET)")

    columns, size = _parquet_shape(conn, path)

    assert columns == [{"name": "id", "type": "BIGINT"}, {"name": "region", "type": "VARCHAR"}]
    assert 0 < size <= os.path.getsize(path)


async def test_dbt_outputs_are_registered_under_per_layer_namespaces(monkeypatch):
    from src.modules.pipeline.dbt.runner import register_dbt_outputs

    calls = []

    async def fake_register(session, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr("src.modules.pipeline.load.registry.register_lake_object", fake_register)
    org_id = uuid.UUID("11111111-2222-3333-4444-555555555555")
    run_id = uuid.uuid4()
    session = AsyncMock()

    await register_dbt_outputs(session, org_id=org_id, run_id=run_id, outputs=[
        {"layer": "silver", "model": "orders", "storage_uri": "s3://b/silver/orders/data.parquet",
         "row_count": 3, "byte_size": 100, "columns": [{"name": "id", "type": "BIGINT"}]},
        {"layer": "gold", "model": "fct_orders", "storage_uri": "s3://b/gold/fct_orders/data.parquet",
         "row_count": 3, "byte_size": 90, "columns": []},
    ])

    hexed = org_id.hex
    assert [c["object_key"] for c in calls] == [f"org_{hexed}_silver.orders", f"org_{hexed}_gold.fct_orders"]
    assert all(c["format"] == "parquet" and c["version"] == str(run_id) for c in calls)
    assert calls[1]["layer"] == "gold" and calls[1]["byte_size"] == 90
    session.commit.assert_awaited_once()


def test_gold_parquet_key_gets_a_readable_warehouse_name():
    """The Warehouse names a table after the identifier's last part."""
    from src.modules.warehouse.catalog import sql_name

    assert sql_name(f"org_{uuid.uuid4().hex}_gold.fct_orders", set()) == "fct_orders"
