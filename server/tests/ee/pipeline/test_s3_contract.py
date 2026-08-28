"""Real S3 wire contract against MinIO.

Skipped unless MinIO is running:
    docker compose -f deploy/docker-compose.dev.extras.yml --profile minio up -d minio
"""

import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa
import pytest

ENDPOINT = os.getenv("TEST_S3_ENDPOINT", "http://localhost:9000")
BUCKET = "aiser-pipeline-test"


def _minio_available() -> bool:
    import socket
    from urllib.parse import urlparse

    parsed = urlparse(ENDPOINT)
    try:
        with socket.create_connection(
            (parsed.hostname, parsed.port or 9000), timeout=1
        ):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(not _minio_available(), reason="MinIO not running")


@pytest.fixture
def s3_settings(monkeypatch):
    for key, value in (
        ("S3_ENDPOINT_URL", ENDPOINT),
        ("S3_ACCESS_KEY_ID", "minioadmin"),
        ("S3_SECRET_ACCESS_KEY", "minioadmin"),
        ("S3_BUCKET_NAME", BUCKET),
        ("S3_REGION", "us-east-1"),
        ("STORAGE_BACKEND", "s3"),
    ):
        monkeypatch.setattr(f"src.core.config.settings.{key}", value, raising=False)

    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id="minioadmin",
        aws_secret_access_key="minioadmin",
        region_name="us-east-1",
    )
    try:
        client.create_bucket(Bucket=BUCKET)
    except Exception:
        pass
    return client


async def test_bronze_write_then_duckdb_read_round_trips(s3_settings):
    """The full object-storage contract: boto3 writes, DuckDB reads."""
    import duckdb

    from ee.modules.data.services.s3_storage_service import S3StorageService
    from src.modules.pipeline.ingest.bronze_writer import write_bronze
    from src.modules.pipeline.ingest.duckdb_s3 import (bronze_scan_sql,
                                                       configure_duckdb_s3)

    org = uuid.uuid4()
    asset = f"asset-{uuid.uuid4().hex[:8]}"
    run = uuid.uuid4()

    async def batches():
        yield pa.RecordBatch.from_pydict(
            {
                "id": pa.array([1, 2, 3], type=pa.int64()),
                "region": pa.array(["eu", "us", "eu"], type=pa.string()),
            }
        )

    result = await write_bronze(
        batches(), org_id=org, asset_id=asset, run_id=run, s3=S3StorageService()
    )
    assert result.row_count == 3

    conn = duckdb.connect()
    assert configure_duckdb_s3(conn) is True

    table = conn.execute(bronze_scan_sql(result.storage_uri)).arrow()
    if hasattr(table, "read_all"):
        table = table.read_all()

    assert table.num_rows == 3
    assert sorted(table.column("region").to_pylist()) == ["eu", "eu", "us"]


async def test_multiple_load_partitions_are_globbed_together(s3_settings):
    """bronze_scan_sql must read every load_id partition, not just the last."""
    import duckdb

    from ee.modules.data.services.s3_storage_service import S3StorageService
    from src.modules.pipeline.ingest.bronze_writer import write_bronze
    from src.modules.pipeline.ingest.duckdb_s3 import (bronze_scan_sql,
                                                       configure_duckdb_s3)

    org = uuid.uuid4()
    asset = f"asset-{uuid.uuid4().hex[:8]}"

    for value in (1, 2):

        async def batches(v=value):
            yield pa.RecordBatch.from_pydict({"id": pa.array([v], type=pa.int64())})

        result = await write_bronze(
            batches(),
            org_id=org,
            asset_id=asset,
            run_id=uuid.uuid4(),
            s3=S3StorageService(),
        )

    conn = duckdb.connect()
    configure_duckdb_s3(conn)
    table = conn.execute(bronze_scan_sql(result.storage_uri)).arrow()
    if hasattr(table, "read_all"):
        table = table.read_all()

    assert sorted(table.column("id").to_pylist()) == [1, 2]
