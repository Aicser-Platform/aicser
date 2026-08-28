import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa
import pyarrow.parquet as pq


async def test_file_source_snapshot_yields_batches_with_audit_columns(
    tmp_path,
):
    from src.modules.pipeline.ingest.base import AUDIT_COLUMNS
    from src.modules.pipeline.ingest.file_source import FileSource

    path = tmp_path / "orders.parquet"
    pq.write_table(pa.table({"id": [1, 2, 3], "amount": [1.0, 2.0, 3.0]}), path)

    src = FileSource(path=str(path), source_table="orders")
    load_id = uuid.uuid4()

    rows = 0
    async for batch in src.snapshot(load_id=load_id):
        rows += batch.num_rows
        for name in AUDIT_COLUMNS:
            assert name in batch.schema.names
        assert set(batch.column("_op").to_pylist()) == {"r"}

    assert rows == 3


async def test_file_source_reads_csv(tmp_path):
    from src.modules.pipeline.ingest.file_source import FileSource

    path = tmp_path / "orders.csv"
    path.write_text("id,amount\n1,10\n2,20\n")

    src = FileSource(path=str(path), source_table="orders")
    rows = sum([batch.num_rows async for batch in src.snapshot(load_id=uuid.uuid4())])
    assert rows == 2


async def test_ingest_stage_writes_bronze_and_records_the_lake_object(
    tmp_path,
):
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.ingest.stage import IngestStage
    from src.modules.pipeline.runner import RunContext

    path = tmp_path / "orders.parquet"
    pq.write_table(pa.table({"id": [1, 2]}), path)

    added = []
    session = AsyncMock()
    session.add = MagicMock(side_effect=added.append)

    org_id = uuid.uuid4()
    ctx = RunContext(
        session=session,
        run=type(
            "R",
            (),
            {"id": uuid.uuid4(), "checkpoint": {}, "status": "running"},
        )(),
        pipeline=type(
            "P",
            (),
            {
                "id": uuid.uuid4(),
                "organization_id": org_id,
                "source_asset_type": "lake_object",
                "source_asset_id": "asset-1",
                "ingest_mode": "snapshot",
                "target_layer": "silver",
            },
        )(),
        org_id=org_id,
    )

    class FakeS3:
        async def store_file(self, file_content, object_key, **kwargs):
            return {
                "success": True,
                "object_key": object_key,
                "storage_uri": f"s3://b/{object_key}",
            }

    with patch(
        "src.modules.pipeline.ingest.stage.resolve_source",
        new=AsyncMock(return_value=("orders", str(path))),
    ), patch(
        "src.modules.pipeline.ingest.stage.S3StorageService",
        return_value=FakeS3(),
    ):
        result = await IngestStage().execute(ctx)

    assert result.stage == "ingest"
    assert result.rows == 2
    assert "bronze_object_id" in result.outputs
    assert result.outputs["storage_uri"].startswith("s3://")

    assert len(added) == 1
    assert added[0].layer == "bronze"
    assert added[0].format == "parquet"
    assert added[0].row_count == 2
