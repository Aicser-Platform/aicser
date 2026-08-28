import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa
import pyarrow.parquet as pq


def test_bronze_key_matches_the_spec_layout():
    from src.modules.pipeline.ingest.bronze_writer import bronze_key

    org, asset, run = uuid.uuid4(), "asset-1", uuid.uuid4()
    key = bronze_key(org, asset, run, 0)

    assert key == f"orgs/{org}/bronze/asset-1/load_id={run}/part-0000.parquet"


async def test_write_bronze_uploads_parquet_and_reports_counts():
    from src.modules.pipeline.ingest.bronze_writer import write_bronze

    uploaded = {}

    class FakeS3:
        async def store_file(self, file_content, object_key, **kwargs):
            uploaded[object_key] = file_content
            return {
                "success": True,
                "object_key": object_key,
                "storage_uri": f"s3://bucket/{object_key}",
            }

    async def batches():
        yield pa.RecordBatch.from_pydict({"id": pa.array([1, 2, 3], type=pa.int64())})

    org, asset, run = uuid.uuid4(), "asset-1", uuid.uuid4()
    result = await write_bronze(
        batches(), org_id=org, asset_id=asset, run_id=run, s3=FakeS3()
    )

    assert result.row_count == 3
    assert result.part_count == 1
    assert result.byte_size > 0
    assert result.checksum
    assert len(uploaded) == 1

    import io

    table = pq.read_table(io.BytesIO(next(iter(uploaded.values()))))
    assert table.column("id").to_pylist() == [1, 2, 3]


async def test_write_bronze_splits_parts_at_the_row_limit():
    from src.modules.pipeline.ingest.bronze_writer import write_bronze

    keys = []

    class FakeS3:
        async def store_file(self, file_content, object_key, **kwargs):
            keys.append(object_key)
            return {
                "success": True,
                "object_key": object_key,
                "storage_uri": f"s3://b/{object_key}",
            }

    async def batches():
        for _ in range(3):
            yield pa.RecordBatch.from_pydict({"id": pa.array([1, 2], type=pa.int64())})

    result = await write_bronze(
        batches(),
        org_id=uuid.uuid4(),
        asset_id="a",
        run_id=uuid.uuid4(),
        s3=FakeS3(),
        rows_per_part=2,
    )

    assert result.part_count == 3
    assert result.row_count == 6
    assert keys[0].endswith("part-0000.parquet")
    assert keys[2].endswith("part-0002.parquet")


async def test_write_bronze_records_the_schema_snapshot():
    from src.modules.pipeline.ingest.bronze_writer import write_bronze

    class FakeS3:
        async def store_file(self, file_content, object_key, **kwargs):
            return {
                "success": True,
                "object_key": object_key,
                "storage_uri": "s3://b/k",
            }

    async def batches():
        yield pa.RecordBatch.from_pydict(
            {
                "id": pa.array([1], type=pa.int64()),
                "name": pa.array(["x"], type=pa.string()),
            }
        )

    result = await write_bronze(
        batches(),
        org_id=uuid.uuid4(),
        asset_id="a",
        run_id=uuid.uuid4(),
        s3=FakeS3(),
    )

    assert result.schema_snapshot["columns"] == [
        {"name": "id", "type": "int64"},
        {"name": "name", "type": "string"},
    ]
