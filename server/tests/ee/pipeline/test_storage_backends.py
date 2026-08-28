import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa
import pytest


async def test_write_bronze_defaults_to_the_local_store(tmp_path, monkeypatch):
    from src.core.config import settings
    from src.modules.pipeline.ingest.bronze_writer import write_bronze

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    async def batches():
        yield pa.RecordBatch.from_pydict({"id": pa.array([1, 2], type=pa.int64())})

    org, asset, run = uuid.uuid4(), "asset-1", uuid.uuid4()
    result = await write_bronze(batches(), org_id=org, asset_id=asset, run_id=run)

    assert result.row_count == 2
    assert result.storage_uri.startswith("file://")
    written = (
        tmp_path
        / "orgs"
        / str(org)
        / "bronze"
        / "asset-1"
        / f"load_id={run}"
        / "part-0000.parquet"
    )
    assert written.exists()


def test_bronze_scan_sql_accepts_a_file_uri():
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    sql = bronze_scan_sql(
        "file:///lake/orgs/o1/bronze/a1/load_id=abc/part-0000.parquet"
    )

    assert "/lake/orgs/o1/bronze/a1/load_id=*/*.parquet" in sql
    assert "union_by_name=true" in sql


def test_bronze_scan_sql_accepts_a_bare_path():
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    sql = bronze_scan_sql("/lake/orgs/o1/bronze/a1/load_id=abc/part-0000.parquet")

    assert "/lake/orgs/o1/bronze/a1/load_id=*/*.parquet" in sql


def test_bronze_scan_sql_still_accepts_s3():
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    sql = bronze_scan_sql("s3://bucket/orgs/o1/bronze/a1/load_id=abc/part-0000.parquet")

    assert "s3://bucket/orgs/o1/bronze/a1/load_id=*/*.parquet" in sql


def test_bronze_scan_sql_rejects_an_unsupported_scheme():
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    with pytest.raises(ValueError, match="unsupported storage URI"):
        bronze_scan_sql("gs://bucket/orgs/o1/bronze/a1/load_id=abc/p.parquet")


def test_bronze_upload_no_longer_requires_s3(monkeypatch):
    from src.core.config import settings
    from src.modules.pipeline.ingest.upload_bridge import bronze_upload_enabled

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)

    assert bronze_upload_enabled() is True


async def test_local_bronze_round_trips_through_duckdb(tmp_path, monkeypatch):
    """The regression that matters: written locally, then readable by preview."""
    import duckdb

    from src.core.config import settings
    from src.modules.pipeline.ingest.bronze_writer import write_bronze
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    async def batches():
        yield pa.RecordBatch.from_pydict({"id": pa.array([7, 8, 9], type=pa.int64())})

    result = await write_bronze(
        batches(), org_id=uuid.uuid4(), asset_id="asset-1", run_id=uuid.uuid4()
    )

    rows = duckdb.connect().execute(bronze_scan_sql(result.storage_uri)).fetchall()
    assert sorted(row[0] for row in rows) == [7, 8, 9]
