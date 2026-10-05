"""Scheduled runs on an unchanged upload reuse its Bronze; a table belongs to one pipeline."""

import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def _result(scalar=None, first=None):
    r = MagicMock()
    r.scalar_one_or_none.return_value = scalar
    r.first.return_value = first
    return r


def _ctx(session, pipeline):
    from src.modules.pipeline.runner import RunContext

    return RunContext(session=session, run=SimpleNamespace(id=uuid.uuid4()), pipeline=pipeline, org_id=uuid.uuid4())


def _file_pipeline():
    return SimpleNamespace(
        id=uuid.uuid4(), source_asset_type="data_source", source_asset_id="ds-1",
        ingest_mode="snapshot", options={"source_table": "products"},
    )


async def test_an_unchanged_upload_reuses_its_bronze(monkeypatch):
    from src.modules.pipeline.ingest import stage as ingest

    landed = SimpleNamespace(id=uuid.uuid4(), row_count=40, storage_uri="s3://b/bronze/products/load_id=1/part-0.parquet",
                             partition_values={"load_id": "1", "source_file": "s3://b/staging/ecommerce.xlsx"})
    monkeypatch.setattr(ingest, "resolve_sheet_file", AsyncMock(return_value="s3://b/staging/ecommerce.xlsx"))
    monkeypatch.setattr(ingest, "_latest_bronze", AsyncMock(return_value=landed))
    write = AsyncMock()
    monkeypatch.setattr(ingest, "write_bronze", write)
    session = AsyncMock()
    session.execute.return_value = _result(scalar=SimpleNamespace(type="file", connection_config=None))
    session.add = MagicMock()

    out = await ingest.IngestStage().execute(_ctx(session, _file_pipeline()))

    write.assert_not_awaited()
    session.add.assert_not_called()
    assert out.outputs["bronze_object_id"] == str(landed.id)
    assert out.outputs["storage_uri"] == landed.storage_uri and out.outputs["reused"] is True
    assert out.rows == 40


async def test_a_new_upload_lands_and_retires_the_old_snapshot(monkeypatch):
    from sqlalchemy.dialects import postgresql

    from src.modules.pipeline.ingest import stage as ingest

    previous = SimpleNamespace(id=uuid.uuid4(), row_count=40, storage_uri="s3://b/old",
                               partition_values={"load_id": "1", "source_file": "s3://b/staging/old.xlsx"})
    monkeypatch.setattr(ingest, "resolve_sheet_file", AsyncMock(return_value="s3://b/staging/new.xlsx"))
    monkeypatch.setattr(ingest, "_latest_bronze", AsyncMock(return_value=previous))

    async def fake_write(batches, **kw):
        return SimpleNamespace(object_key="k", storage_uri="s3://b/new", schema_snapshot={}, checksum="c", row_count=41, byte_size=10)

    monkeypatch.setattr(ingest, "write_bronze", fake_write)
    monkeypatch.setattr("src.modules.pipeline.ingest.file_source.FileSource.snapshot", lambda self, load_id: None)
    session = AsyncMock()
    session.execute.return_value = _result(scalar=SimpleNamespace(type="file", connection_config=None))
    added = []
    session.add = MagicMock(side_effect=added.append)

    await ingest.IngestStage().execute(_ctx(session, _file_pipeline()))

    assert added[0].partition_values["source_file"] == "s3://b/staging/new.xlsx"
    retire = str(session.execute.await_args_list[-1].args[0].compile(dialect=postgresql.dialect()))
    assert retire.startswith("UPDATE data_lake_objects SET status=")
    assert "data_lake_objects.layer = " in retire and "data_lake_objects.id != " in retire


@pytest.mark.parametrize("owner_is_other_pipeline", [True, False])
async def test_a_table_written_by_another_pipeline_gets_its_own_name(monkeypatch, owner_is_other_pipeline):
    import pyarrow as pa

    from src.modules.pipeline.load import stage as load
    from src.modules.pipeline.load.destination import S3Target

    pipeline_id = uuid.uuid4()
    owner = uuid.uuid4() if owner_is_other_pipeline else pipeline_id
    monkeypatch.setattr(load, "_table_owner", AsyncMock(return_value=owner))

    async def platform(*a, **kw):
        return S3Target(bucket="b", prefix="", region="us-east-1", endpoint_url="", access_key_id="k", secret_access_key="s")

    seen = {}

    def fake_load(catalog, **kw):
        seen.update(kw)
        return {"identifier": f"{kw['namespace']}.{kw['table_name']}", "location": kw["location"], "rows_written": 1, "byte_size": 1}

    monkeypatch.setattr("src.modules.pipeline.load.destination.resolve_target", platform)
    monkeypatch.setattr("src.modules.pipeline.load.catalog.get_catalog", lambda *a, **kw: None)
    monkeypatch.setattr("src.modules.pipeline.load.catalog.ensure_namespace", lambda *a: None)
    monkeypatch.setattr("src.modules.pipeline.load.iceberg_loader.load_to_iceberg", fake_load)
    session = AsyncMock()
    session.execute.return_value = _result()
    session.add = MagicMock()
    ctx = _ctx(session, SimpleNamespace(id=pipeline_id, source_asset_id="22794e20-09bf", source_asset_type="data_source",
                                        created_by=None, options={"destination_type": "s3_iceberg"}))
    ctx.arrow_table = pa.table({"id": [1]})
    ctx.compiled = SimpleNamespace(output=SimpleNamespace(layer="silver", table="products", write_mode="overwrite", primary_key=[]))

    await load.LoadStage().execute(ctx)

    suffix = f"_p{pipeline_id.hex[:8]}"
    assert seen["table_name"].endswith(suffix) is owner_is_other_pipeline
    assert seen["table_name"].startswith("silver_22794e2009bf_products")


@pytest.mark.parametrize("target_layer, expected", [("gold", ["silver", "gold"]), ("silver", ["silver"])])
async def test_a_gold_pipeline_publishes_its_silver_tables_to_gold(monkeypatch, target_layer, expected):
    """The wizard compiles Silver transforms for a Gold pipeline: Gold — what the semantic
    model, Warehouse and BI read — must still be produced."""
    import pyarrow as pa

    from src.modules.pipeline.load import stage as load
    from src.modules.pipeline.load.destination import S3Target

    async def platform(*a, **kw):
        return S3Target(bucket="b", prefix="", region="us-east-1", endpoint_url="", access_key_id="k", secret_access_key="s")

    loads = []

    def fake_load(catalog, **kw):
        loads.append(kw)
        return {"identifier": f"{kw['namespace']}.{kw['table_name']}", "location": kw["location"], "rows_written": 3, "byte_size": 1}

    monkeypatch.setattr(load, "_table_owner", AsyncMock(return_value=None))
    published = AsyncMock()
    monkeypatch.setattr(load, "_publish_gold_source", published)
    monkeypatch.setattr("src.modules.pipeline.load.destination.resolve_target", platform)
    monkeypatch.setattr("src.modules.pipeline.load.catalog.get_catalog", lambda *a, **kw: None)
    monkeypatch.setattr("src.modules.pipeline.load.catalog.ensure_namespace", lambda *a: None)
    monkeypatch.setattr("src.modules.pipeline.load.iceberg_loader.load_to_iceberg", fake_load)
    session = AsyncMock()
    session.execute.return_value = _result()
    added = []
    session.add = MagicMock(side_effect=added.append)
    ctx = _ctx(session, SimpleNamespace(id=uuid.uuid4(), source_asset_id="src1", source_asset_type="data_source", created_by=None,
                                        options={"destination_type": "s3_iceberg", "source_table": "products"}))
    ctx.target_layer = target_layer
    ctx.arrow_table = pa.table({"id": [1, 2, 3]})
    ctx.compiled = SimpleNamespace(output=SimpleNamespace(layer="silver", table="products", write_mode="merge", primary_key=["id"]))

    out = await load.LoadStage().execute(ctx)

    assert [kw["table_name"].split("_")[0] for kw in loads] == expected
    assert [o.layer for o in added if type(o).__name__ == "DataLakeObject"] == expected
    assert all(kw["write_mode"] == "merge" and kw["primary_key"] == ["id"] for kw in loads)
    assert published.await_count == (1 if "gold" in expected else 0)
    assert out.outputs["destination_identifier"].split(".")[0].endswith(f"_{expected[-1]}")


async def test_deleting_a_pipeline_retires_its_silver_and_gold_but_not_bronze():
    """Otherwise a deleted pipeline's Gold tables stay in the Warehouse and Catalog."""
    from sqlalchemy.dialects import postgresql

    from src.modules.pipeline.router import retire_pipeline_tables

    db = AsyncMock()
    await retire_pipeline_tables(db, uuid.uuid4())

    sql = str(db.execute.await_args.args[0].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert sql.startswith("UPDATE data_lake_objects SET status='deleted'")
    assert "data_lake_objects.layer IN ('silver', 'gold')" in sql
    assert "SELECT data_ingestion_jobs.id" in sql and "data_ingestion_jobs.pipeline_id" in sql
