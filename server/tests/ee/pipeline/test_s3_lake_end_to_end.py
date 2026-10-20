"""The S3 lakehouse end to end against an S3 API (moto's server, in this process): reach the
bucket, land Bronze, read it with DuckDB, write Silver as Iceberg (append then merge) and
read that back — with the same target a saved bucket connection resolves to."""

import asyncio
import io
import os
import uuid

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")

moto_server = pytest.importorskip("moto.server")
pa = pytest.importorskip("pyarrow")
pq = pytest.importorskip("pyarrow.parquet")
duckdb = pytest.importorskip("duckdb")

BUCKET = "aicser-lake-test"


@pytest.fixture(scope="module")
def s3_endpoint():
    import boto3

    server = moto_server.ThreadedMotoServer(ip_address="127.0.0.1", port=0)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"
    boto3.client(
        "s3", endpoint_url=endpoint, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1"
    ).create_bucket(Bucket=BUCKET)
    yield endpoint
    server.stop()


@pytest.fixture
def target(s3_endpoint):
    from src.modules.pipeline.load.destination import target_from_data_source
    from src.modules.data.utils.credentials import encrypt_credentials

    # Saved exactly as the "Connect S3 bucket" form stores a bucket.
    ds = type("DS", (), {
        "id": uuid.uuid4(),
        "name": "Test lake bucket",
        "db_type": "iceberg",
        "connection_config": {
            "storage_uri": f"s3://{BUCKET}/lake",
            "credentials": encrypt_credentials({
                "access_key_id": "test", "secret_access_key": "test", "endpoint": s3_endpoint, "provider": "other",
            }),
        },
    })()
    return target_from_data_source(ds)


def _rows(n, start=0, label="row"):
    return pa.table({"id": list(range(start, start + n)), "name": [f"{label} {i}" for i in range(start, start + n)]})


def _duck(target):
    from src.modules.pipeline.load.destination import duckdb_secret_sql

    conn = duckdb.connect()
    conn.execute("INSTALL httpfs")
    conn.execute("LOAD httpfs")
    conn.execute(duckdb_secret_sql(target, "aiser_test"))
    return conn


def test_saved_bucket_resolves_to_a_path_style_target(target, s3_endpoint):
    assert target.root == f"s3://{BUCKET}/lake/"
    assert target.endpoint_url == s3_endpoint
    assert target.source == "destination"


def test_bucket_is_reachable(target):
    from src.modules.pipeline.storage_health import _head_s3_target

    assert asyncio.run(_head_s3_target(target))["ok"] is True


def test_unreachable_bucket_says_so(target):
    from dataclasses import replace

    from src.modules.pipeline.storage_health import _head_s3_target

    check = asyncio.run(_head_s3_target(replace(target, bucket="no-such-bucket")))
    assert check["ok"] is False and check["message"]


def test_bronze_lands_and_duckdb_reads_it(target):
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql
    from src.modules.pipeline.load.destination import object_store_for_target

    store = object_store_for_target(target)
    buf = io.BytesIO()
    pq.write_table(_rows(5), buf)
    key = f"{target.prefix}orgs/test/bronze/orders/load_id=1/part-0.parquet"
    stored = asyncio.run(store.store_file(buf.getvalue(), key))
    assert stored["storage_uri"] == f"s3://{BUCKET}/{key}"
    assert asyncio.run(store.get_file(key)) == buf.getvalue()

    conn = _duck(target)
    assert conn.execute(f"SELECT count(*) FROM ({bronze_scan_sql(stored['storage_uri'])})").fetchone()[0] == 5


def test_silver_iceberg_append_merge_and_read(target):
    from src.modules.pipeline.ingest.duckdb_s3 import configure_duckdb_iceberg, iceberg_scan_sql
    from src.modules.pipeline.load.catalog import ensure_namespace, get_catalog
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg

    try:
        catalog = get_catalog(target)
        namespace = f"test_s3_{uuid.uuid4().hex[:10]}"
        ensure_namespace(catalog, namespace)
    except Exception as exc:  # noqa: BLE001 - the catalog lives in the app database
        pytest.skip(f"Iceberg catalog database unavailable: {exc}")
    location = f"{target.root}orgs/test/silver/{namespace}/orders"
    try:
        first = load_to_iceberg(catalog, namespace=namespace, table_name="orders", table=_rows(3),
                                write_mode="append", primary_key=[], location=location)
        assert first["created"] and first["rows_written"] == 3
        assert first["location"].startswith(f"s3://{BUCKET}/lake/")

        merged = load_to_iceberg(catalog, namespace=namespace, table_name="orders", table=_rows(3, start=2, label="changed"),
                                 write_mode="merge", primary_key=["id"])
        assert merged["rows_written"] == 3  # id 2 updated, 3 and 4 inserted
        assert catalog.load_table(f"{namespace}.orders").scan().to_arrow().num_rows == 5

        conn = _duck(target)
        if configure_duckdb_iceberg(conn):
            metadata = catalog.load_table(f"{namespace}.orders").metadata_location
            assert conn.execute(f"SELECT count(*) FROM ({iceberg_scan_sql(metadata)})").fetchone()[0] == 5
    finally:
        try:
            catalog.drop_table(f"{namespace}.orders")
        except Exception:  # noqa: BLE001
            pass
        catalog.drop_namespace(namespace)


def test_probe_proves_write_read_delete(target):
    from src.modules.pipeline.storage_health import probe_s3_target

    result = asyncio.run(probe_s3_target(target))
    assert result["ok"] is True, result
    assert "write, read and delete" in result["message"]


def test_probe_explains_a_missing_bucket(target):
    from dataclasses import replace

    from src.modules.pipeline.storage_health import probe_s3_target

    result = asyncio.run(probe_s3_target(replace(target, bucket="no-such-bucket")))
    assert result["ok"] is False
    assert result["code"] == "NoSuchBucket"
    assert "doesn't exist" in result["message"]


def test_probe_explains_read_only_keys():
    from src.modules.data.utils.s3_compatible import probe_bucket_write
    from botocore.exceptions import ClientError

    class ReadOnly:
        def put_object(self, **_kw):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "denied"}}, "PutObject")

    result = probe_bucket_write(ReadOnly(), "lake", "data/")
    assert result["ok"] is False and result["code"] == "AccessDenied"
    assert "can't write" in result["message"] and "s3://lake/data/" in result["message"]


def test_admin_storage_test_uses_the_write_probe(s3_endpoint):
    from src.core.system_settings.runtime_config import test_storage_config

    ok = asyncio.run(test_storage_config({
        "enabled": True, "configured": True, "backend": "s3", "bucket_name": BUCKET,
        "access_key_id": "test", "secret_access_key": "test", "endpoint_url": s3_endpoint, "provider": "other",
    }))
    assert ok["success"] is True, ok
    missing = asyncio.run(test_storage_config({
        "enabled": True, "configured": True, "backend": "s3", "bucket_name": "absent-bucket",
        "access_key_id": "test", "secret_access_key": "test", "endpoint_url": s3_endpoint, "provider": "other",
    }))
    assert missing["success"] is False and "doesn't exist" in missing["message"]


def test_duckdb_endpoint_drops_the_scheme_and_keeps_ssl_in_step():
    from src.modules.data.utils.s3_compatible import duckdb_endpoint

    assert duckdb_endpoint("http://server:5055") == ("server:5055", False)
    assert duckdb_endpoint("https://acc.r2.cloudflarestorage.com/") == ("acc.r2.cloudflarestorage.com", True)
    assert duckdb_endpoint("minio:9000") == ("minio:9000", True)
    assert duckdb_endpoint("") == (None, True)


def test_encryption_at_rest_is_read_and_enforced(target, s3_endpoint, monkeypatch):
    import boto3
    from dataclasses import replace

    from src.modules.pipeline.load import encryption
    from src.modules.pipeline.load.destination import builtin_target

    encryption._cache.clear()
    plain = f"plain-{BUCKET}"
    s3 = boto3.client("s3", endpoint_url=s3_endpoint, aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1")
    s3.create_bucket(Bucket=plain)
    try:
        s3.delete_bucket_encryption(Bucket=plain)  # newer moto applies the AWS default (SSE-S3)
    except Exception:
        pass
    unencrypted = replace(target, bucket=plain, prefix="")
    assert asyncio.run(encryption.target_encryption(unencrypted))["encrypted"] is False

    s3.put_bucket_encryption(Bucket=BUCKET, ServerSideEncryptionConfiguration={"Rules": [
        {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms", "KMSMasterKeyID": "alias/lake"}}]})
    state = asyncio.run(encryption.target_encryption(target))
    assert state["encrypted"] is True and state["algorithm"] == "aws:kms" and state["kms_key"] == "alias/lake"

    async def required(_session, _org):
        return {"require_encryption_at_rest": True}

    monkeypatch.setattr("src.modules.pipeline.lakehouse_settings.get_org_lakehouse_settings", required)
    asyncio.run(encryption.enforce_encryption_at_rest(None, "org", target))  # proven: allowed
    with pytest.raises(encryption.EncryptionRequired, match="no default encryption"):
        asyncio.run(encryption.enforce_encryption_at_rest(None, "org", unencrypted))
    with pytest.raises(encryption.EncryptionRequired, match="built-in storage"):
        asyncio.run(encryption.enforce_encryption_at_rest(None, "org", builtin_target()))

    async def not_required(_session, _org):
        return {"require_encryption_at_rest": False}

    monkeypatch.setattr("src.modules.pipeline.lakehouse_settings.get_org_lakehouse_settings", not_required)
    asyncio.run(encryption.enforce_encryption_at_rest(None, "org", unencrypted))  # not required: allowed
