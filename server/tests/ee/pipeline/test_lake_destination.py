"""Where Silver/Gold go: the platform storage from the system config, or a saved S3 connection."""

import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("AISER_EDITION", "enterprise")

import duckdb
import pytest


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())


def _target(**kw):
    from src.modules.pipeline.load.destination import S3Target

    base = dict(bucket="cust-lake", prefix="analytics/", region="eu-west-1", endpoint_url="",
                access_key_id="AKIA_CUST", secret_access_key="s3cr3t", provider="s3",
                source="destination", destination_id="ds-1", name="Customer lake")
    base.update(kw)
    return S3Target(**base)


def test_platform_target_comes_from_the_effective_storage_config():
    from src.modules.pipeline.load.destination import _from_storage_config

    t = _from_storage_config({
        "backend": "s3", "configured": True, "bucket_name": "aicser-prod-lake", "region": "ap-southeast-1",
        "endpoint_url": "https://t3.storage.dev", "access_key_id": "k", "secret_access_key": "s", "provider": "railway",
    })

    assert (t.bucket, t.region, t.endpoint_url, t.provider, t.source) == (
        "aicser-prod-lake", "ap-southeast-1", "https://t3.storage.dev", "railway", "platform")
    assert _from_storage_config({"backend": "postgresql", "configured": True}) is None
    assert _from_storage_config({"backend": "s3", "bucket_name": "b"}) is None  # no keys


def test_saved_connection_becomes_a_target_with_decrypted_keys():
    from src.modules.data.utils.credentials import encrypt_credentials
    from src.modules.pipeline.load.destination import target_from_data_source

    ds = SimpleNamespace(id="ds-9", name="Acme lake", connection_config={
        "storage_uri": "s3://acme-data/warehouse/lake",
        "credentials": encrypt_credentials({"access_key": "AKIA_ACME", "secret_key": "acme-secret", "region": "us-west-2"}),
    })

    t = target_from_data_source(ds)

    assert (t.bucket, t.prefix, t.region) == ("acme-data", "warehouse/lake/", "us-west-2")
    assert (t.access_key_id, t.secret_access_key) == ("AKIA_ACME", "acme-secret")
    assert t.org_root("o1") == "s3://acme-data/warehouse/lake/orgs/o1"


def test_object_storage_keys_are_encrypted_at_rest():
    """The S3 connection form sends access_key/secret_key: these used to be stored as-is."""
    from src.modules.data.utils.credentials import decrypt_credentials, encrypt_credentials

    stored = encrypt_credentials({"access_key": "AKIA", "secret_key": "plain", "region": "us-east-1"})

    assert stored["secret_key"] != "plain" and stored["access_key"] != "AKIA"
    assert stored["region"] == "us-east-1"
    assert decrypt_credentials(stored)["secret_key"] == "plain"


@pytest.mark.parametrize("uri", ["azure://acct/container", "s3://bucket-only-no-keys"])
def test_non_s3_or_keyless_connections_are_not_destinations(uri):
    from src.modules.pipeline.load.destination import target_from_data_source

    with pytest.raises(ValueError):
        target_from_data_source(SimpleNamespace(id="x", name="x", connection_config={"storage_uri": uri, "credentials": {}}))


def test_public_view_never_includes_keys():
    view = _target(endpoint_url="https://minio.internal:9000").public()

    assert "AKIA_CUST" not in str(view) and "s3cr3t" not in str(view)
    assert view["endpoint"] == "minio.internal:9000"
    assert view["path_template"] == "s3://cust-lake/analytics/orgs/<organization>/<layer>/"


def test_platform_bucket_locations_need_no_lookup(monkeypatch):
    from src.modules.pipeline.load import destination

    monkeypatch.setattr(destination, "_env_target", lambda: _target(bucket="platform", source="platform"))
    monkeypatch.setattr(destination, "_load_known_targets", lambda: pytest.fail("no DB lookup expected"))

    assert destination.targets_for_locations(["s3://platform/orgs/o/gold/x", "file:///tmp/x", None]) == []


def test_foreign_location_matches_the_longest_saved_prefix(monkeypatch):
    from src.modules.pipeline.load import destination

    wide, narrow = _target(prefix="", destination_id="wide"), _target(prefix="analytics/", destination_id="narrow")
    monkeypatch.setattr(destination, "_env_target", lambda: None)
    monkeypatch.setattr(destination, "_load_known_targets", lambda: [wide, narrow])
    monkeypatch.setitem(destination._cache, "at", 0.0)

    found = destination.targets_for_locations(["s3://cust-lake/analytics/orgs/o/gold/t/metadata/v1.json"])

    assert [t.destination_id for t in found] == ["narrow"]


def test_duckdb_secret_is_scoped_to_the_destination_bucket():
    from src.modules.pipeline.load.destination import duckdb_secret_sql

    sql = duckdb_secret_sql(_target(endpoint_url="http://minio:9000"), "s1")

    assert "SCOPE 's3://cust-lake/analytics/'" in sql
    assert "ENDPOINT 'minio:9000'" in sql and "USE_SSL false" in sql
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs")
    conn.execute("LOAD httpfs")
    conn.execute(sql)  # valid DuckDB
    assert conn.execute("SELECT scope FROM duckdb_secrets() WHERE name = 's1'").fetchone()[0] == ["s3://cust-lake/analytics/"]


async def test_resolve_target_without_a_destination_needs_platform_storage(monkeypatch):
    from src.modules.pipeline.load import destination

    async def none():
        return None

    monkeypatch.setattr(destination, "platform_target", none)

    with pytest.raises(ValueError, match="no S3 storage configured"):
        await destination.resolve_target(AsyncMock(), uuid.uuid4(), None)


async def test_resolve_target_refuses_a_connection_the_caller_cannot_see():
    from src.modules.pipeline.load.destination import resolve_target

    session = AsyncMock()
    found = MagicMock()
    found.scalar_one_or_none.return_value = None
    session.execute.return_value = found

    with pytest.raises(ValueError, match="not found"):
        await resolve_target(session, uuid.uuid4(), "someone-elses-ds", user_id=uuid.uuid4())


async def test_load_stage_writes_to_the_chosen_destination(monkeypatch):
    """Silver/Gold land under the destination's root and the registry row names it."""
    import pyarrow as pa

    from src.modules.pipeline.load import destination
    from src.modules.pipeline.load.stage import LoadStage
    from src.modules.pipeline.runner import RunContext

    target = _target()
    seen = {}

    async def fake_resolve(session, org_id, dest_id, user_id=None):
        seen["dest_id"] = dest_id
        return target

    def fake_load(catalog, **kw):
        seen.update(kw)
        return {"identifier": f"{kw['namespace']}.{kw['table_name']}", "location": kw["location"],
                "rows_written": 1, "created": True, "byte_size": 10}

    monkeypatch.setattr(destination, "resolve_target", fake_resolve)
    monkeypatch.setattr("src.modules.pipeline.load.catalog.get_catalog", lambda t=None: seen.setdefault("catalog_target", t))
    monkeypatch.setattr("src.modules.pipeline.load.catalog.ensure_namespace", lambda *a: None)
    monkeypatch.setattr("src.modules.pipeline.load.iceberg_loader.load_to_iceberg", fake_load)

    added = []
    session = AsyncMock()
    session.add = MagicMock(side_effect=added.append)
    nothing = MagicMock()
    nothing.scalar_one_or_none.return_value = None
    nothing.scalars.return_value.first.return_value = None
    nothing.first.return_value = None
    session.execute = AsyncMock(return_value=nothing)

    org_id = uuid.uuid4()
    compiled = SimpleNamespace(output=SimpleNamespace(layer="silver", table="orders", write_mode="append", primary_key=[]))
    ctx = RunContext(
        session=session,
        run=SimpleNamespace(id=uuid.uuid4()),
        pipeline=SimpleNamespace(source_asset_id="src1", source_asset_type="data_source", created_by=None,
                                 options={"destination_type": "s3_iceberg", "destination_asset_id": "ds-1"}),
        org_id=org_id,
        arrow_table=pa.table({"id": [1]}),
        compiled=compiled,
    )

    await LoadStage().execute(ctx)

    assert seen["dest_id"] == "ds-1" and seen["catalog_target"] is target
    assert seen["location"].startswith(f"s3://cust-lake/analytics/orgs/{org_id}/silver/src1/")
    assert seen["table_name"].endswith("_dds1")  # distinct from the same table in the platform lakehouse
    lake = [o for o in added if type(o).__name__ == "DataLakeObject"]
    assert lake[0].storage_destination_id == "ds-1"
