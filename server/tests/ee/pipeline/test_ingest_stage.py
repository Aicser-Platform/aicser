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
        "src.modules.pipeline.ingest.stage.get_object_store",
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


async def test_ingest_stage_uses_the_persisted_watermark_for_incremental_runs():
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.ingest.base import Checkpoint
    from src.modules.pipeline.ingest.stage import IngestStage
    from src.modules.pipeline.runner import RunContext

    added = []
    session = AsyncMock()
    session.add = MagicMock(side_effect=added.append)

    org_id = uuid.uuid4()
    ctx = RunContext(
        session=session,
        run=type("R", (), {"id": uuid.uuid4(), "checkpoint": {}, "status": "running"})(),
        pipeline=type(
            "P",
            (),
            {
                "id": uuid.uuid4(),
                "organization_id": org_id,
                "source_asset_type": "data_source",
                "source_asset_id": "ds-1",
                "ingest_mode": "incremental",
                "target_layer": "silver",
                "options": {"source_table": "orders"},
            },
        )(),
        org_id=org_id,
    )

    class FakeSource:
        def __init__(self):
            self.since_received = None

        async def changes(self, since, *, load_id):
            self.since_received = since
            yield pa.RecordBatch.from_pydict({"id": pa.array([3], type=pa.int64())})

        def next_checkpoint(self, batch):
            return Checkpoint(offset="3")

    fake_source = FakeSource()

    class FakeS3:
        async def store_file(self, file_content, object_key, **kwargs):
            return {"success": True, "object_key": object_key, "storage_uri": f"s3://b/{object_key}"}

    with patch(
        "src.modules.pipeline.ingest.stage.get_object_store", return_value=FakeS3()
    ), patch(
        "src.modules.pipeline.ingest.watermark_source.build_watermark_source",
        new=AsyncMock(return_value=fake_source),
    ), patch(
        "src.modules.pipeline.ingest.watermark_source.load_cdc_state",
        new=AsyncMock(return_value=Checkpoint(offset="1")),
    ) as mocked_load, patch(
        "src.modules.pipeline.ingest.watermark_source.save_cdc_state",
        new=AsyncMock(),
    ) as mocked_save:
        result = await IngestStage().execute(ctx)

    assert result.rows == 1
    assert fake_source.since_received.offset == "1"
    mocked_load.assert_awaited_once()
    mocked_save.assert_awaited_once()
    assert mocked_save.await_args.kwargs["checkpoint"].offset == "3"


async def test_ingest_stage_treats_an_empty_incremental_tick_as_a_successful_noop():
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.ingest.base import Checkpoint
    from src.modules.pipeline.ingest.stage import IngestStage
    from src.modules.pipeline.runner import RunContext

    session = AsyncMock()
    session.add = MagicMock()

    org_id = uuid.uuid4()
    ctx = RunContext(
        session=session,
        run=type("R", (), {"id": uuid.uuid4(), "checkpoint": {}, "status": "running"})(),
        pipeline=type(
            "P",
            (),
            {
                "id": uuid.uuid4(),
                "organization_id": org_id,
                "source_asset_type": "data_source",
                "source_asset_id": "ds-1",
                "ingest_mode": "incremental",
                "target_layer": "silver",
                "options": {"source_table": "orders"},
            },
        )(),
        org_id=org_id,
    )

    class EmptySource:
        async def changes(self, since, *, load_id):
            return
            yield  # pragma: no cover - makes this an async generator with zero items

    with patch(
        "src.modules.pipeline.ingest.watermark_source.build_watermark_source",
        new=AsyncMock(return_value=EmptySource()),
    ), patch(
        "src.modules.pipeline.ingest.watermark_source.load_cdc_state",
        new=AsyncMock(return_value=Checkpoint(offset="1")),
    ), patch(
        "src.modules.pipeline.ingest.watermark_source.save_cdc_state", new=AsyncMock()
    ) as mocked_save:
        result = await IngestStage().execute(ctx)

    assert result.rows == 0
    assert result.outputs.get("note") == "no_new_rows_since_watermark"
    mocked_save.assert_not_called()
    session.add.assert_not_called()


async def test_ingest_stage_first_run_snapshot_does_not_require_an_existing_bronze_object():
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.ingest.stage import IngestStage
    from src.modules.pipeline.runner import RunContext

    added = []
    session = AsyncMock()
    session.add = MagicMock(side_effect=added.append)

    org_id = uuid.uuid4()
    ctx = RunContext(
        session=session,
        run=type("R", (), {"id": uuid.uuid4(), "checkpoint": {}, "status": "running"})(),
        pipeline=type(
            "P",
            (),
            {
                "id": uuid.uuid4(),
                "organization_id": org_id,
                "source_asset_type": "data_source",
                "source_asset_id": "ds-1",
                "ingest_mode": "snapshot",
                "target_layer": "silver",
                "options": {"source_table": "orders"},
            },
        )(),
        org_id=org_id,
    )

    class FakeSource:
        async def snapshot(self, *, load_id):
            yield pa.RecordBatch.from_pydict({"id": pa.array([1, 2], type=pa.int64())})

    class FakeS3:
        async def store_file(self, file_content, object_key, **kwargs):
            return {"success": True, "object_key": object_key, "storage_uri": f"s3://b/{object_key}"}

    with patch(
        "src.modules.pipeline.ingest.stage.get_object_store", return_value=FakeS3()
    ), patch(
        "src.modules.pipeline.ingest.watermark_source.build_watermark_source",
        new=AsyncMock(return_value=FakeSource()),
    ):
        # No DataLakeObject exists for this data source yet — this must not raise
        # "no Bronze object for data source ...".
        result = await IngestStage().execute(ctx)

    assert result.rows == 2
    assert len(added) == 1


async def test_ingest_stage_reads_an_existing_bronze_object_for_a_file_upload_data_source():
    """A spreadsheet/file source onboarded with source_asset_type="data_source"
    (OnboardingWizard / IngestEmptyState) has no source_table. Its Bronze object
    was already written by the upload flow, so ingest reads it via resolve_source
    /FileSource — exactly like a lake_object pipeline — never via a live database
    connection."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.ingest.stage import IngestStage
    from src.modules.pipeline.runner import RunContext

    added = []
    session = AsyncMock()
    session.add = MagicMock(side_effect=added.append)

    org_id = uuid.uuid4()
    ctx = RunContext(
        session=session,
        run=type("R", (), {"id": uuid.uuid4(), "checkpoint": {}, "status": "running"})(),
        pipeline=type(
            "P",
            (),
            {
                "id": uuid.uuid4(),
                "organization_id": org_id,
                "source_asset_type": "data_source",
                "source_asset_id": "ds-upload-1",
                "ingest_mode": "snapshot",
                "target_layer": "silver",
                "options": {},  # no source_table — this is a file upload
            },
        )(),
        org_id=org_id,
    )

    class FakeSource:
        async def snapshot(self, *, load_id):
            yield pa.RecordBatch.from_pydict({"id": pa.array([7], type=pa.int64())})

    class FakeS3:
        async def store_file(self, file_content, object_key, **kwargs):
            return {
                "success": True,
                "object_key": object_key,
                "storage_uri": f"s3://b/{object_key}",
            }

    resolve_mock = AsyncMock(return_value=("orders", "s3://lake/bronze/orders.parquet"))

    def _fake_file_source(*, path, source_table):
        assert path == "s3://lake/bronze/orders.parquet"
        assert source_table == "orders"
        return FakeSource()

    with patch(
        "src.modules.pipeline.ingest.stage.get_object_store", return_value=FakeS3()
    ), patch(
        "src.modules.pipeline.ingest.stage.resolve_source", new=resolve_mock
    ), patch(
        "src.modules.pipeline.ingest.file_source.FileSource", new=_fake_file_source
    ), patch(
        "src.modules.pipeline.ingest.watermark_source.build_watermark_source",
        new=AsyncMock(
            side_effect=AssertionError(
                "a file-upload data_source pipeline must not open a live DB connection"
            )
        ),
    ):
        result = await IngestStage().execute(ctx)

    resolve_mock.assert_awaited_once()
    assert result.rows == 1
    assert len(added) == 1


async def test_resolve_source_falls_back_to_the_latest_bronze_object_for_a_data_source():
    """resolve_source must still serve data_source pipelines (file uploads):
    Task 3 narrowed it to lake_object only, which broke that path."""
    from unittest.mock import AsyncMock, MagicMock

    from src.modules.pipeline.ingest.stage import resolve_source

    bronze = type(
        "O",
        (),
        {"object_key": "orgs/o1/bronze/x.parquet", "storage_uri": "s3://b/x.parquet"},
    )()

    class FakeResult:
        def scalar_one_or_none(self):
            return bronze

    session = AsyncMock()
    session.execute = AsyncMock(return_value=FakeResult())

    pipeline = type(
        "P",
        (),
        {"source_asset_type": "data_source", "source_asset_id": "ds-upload-1"},
    )()

    name, uri = await resolve_source(session, pipeline)

    assert name == "ds-upload-1"
    assert uri == "s3://b/x.parquet"


async def test_resolve_source_raises_a_clear_error_when_a_data_source_has_no_bronze_object():
    from unittest.mock import AsyncMock

    import pytest

    from src.modules.pipeline.ingest.stage import resolve_source

    class FakeResult:
        def scalar_one_or_none(self):
            return None

    session = AsyncMock()
    session.execute = AsyncMock(return_value=FakeResult())

    pipeline = type(
        "P",
        (),
        {"source_asset_type": "data_source", "source_asset_id": "ds-upload-1"},
    )()

    with pytest.raises(ValueError, match="no Bronze object for data source"):
        await resolve_source(session, pipeline)
