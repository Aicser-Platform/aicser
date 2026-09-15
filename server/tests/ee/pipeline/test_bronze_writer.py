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


def test_bronze_key_scopes_by_table_when_a_multi_table_database_source_provides_one():
    """A single data_source_id (e.g. one MySQL connection) can have many
    DataPipelines, one per table. Without a table segment in the key, every
    table's runs share one orgs/.../bronze/{asset_id}/load_id=*/ prefix, and
    bronze_scan_sql's non-exact glob (used for every data_source-type pipeline
    — see transform/stage.py) reads them all together via union_by_name=true,
    silently merging unrelated tables' rows (null-padding the mismatched
    columns) into whichever pipeline runs Transform next. Reproduces the
    contaminated crm_employees Silver table seen in production (18 rows =
    15 real employees + 3 departments rows pulled in from a different
    pipeline's Bronze data under the same data source)."""
    from src.modules.pipeline.ingest.bronze_writer import bronze_key

    org, asset, run = uuid.uuid4(), "db_mysql_1", uuid.uuid4()

    key = bronze_key(org, asset, run, 0, table="employees")

    assert key == f"orgs/{org}/bronze/db_mysql_1/employees/load_id={run}/part-0000.parquet"
    # No table given (lake_object / file-upload pipelines) keeps the original,
    # backward-compatible layout exactly.
    assert bronze_key(org, asset, run, 0) == f"orgs/{org}/bronze/db_mysql_1/load_id={run}/part-0000.parquet"


def test_bronze_scan_sql_glob_isolates_by_table_once_the_key_is_table_scoped():
    """The read side needs no changes: bronze_scan_sql's non-exact-partition
    glob strips everything from /load_id= onward and re-globs under whatever
    prefix remains, so inserting a table segment before /load_id= in the
    write path automatically scopes the read path too."""
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    employees_uri = "s3://bucket/orgs/org-1/bronze/db_mysql_1/employees/load_id=run-a/part-0000.parquet"
    departments_uri = "s3://bucket/orgs/org-1/bronze/db_mysql_1/departments/load_id=run-b/part-0000.parquet"

    employees_sql = bronze_scan_sql(employees_uri)
    departments_sql = bronze_scan_sql(departments_uri)

    assert "bronze/db_mysql_1/employees/load_id=*/*.parquet" in employees_sql
    assert "bronze/db_mysql_1/departments/load_id=*/*.parquet" in departments_sql
    assert employees_sql != departments_sql


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
