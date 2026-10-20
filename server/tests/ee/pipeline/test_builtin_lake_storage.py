"""With no bucket configured, the lake lives on the shared lake volume (built-in storage):
pipelines resolve to it, write Silver/Gold there as Iceberg, and read it back."""

import asyncio
import os
import uuid

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")
pa = pytest.importorskip("pyarrow")
duckdb = pytest.importorskip("duckdb")


@pytest.fixture
def no_bucket(monkeypatch, tmp_path):
    from src.core.config import settings
    from src.modules.pipeline.load import destination

    for name in ("S3_BUCKET_NAME", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"):
        monkeypatch.setattr(settings, name, "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    async def no_admin_storage():
        return {"enabled": False, "configured": False, "backend": "disabled"}

    monkeypatch.setattr("src.core.system_settings.runtime_config.get_effective_storage_config", no_admin_storage)
    return tmp_path


def test_workspace_storage_falls_back_to_the_lake_volume(no_bucket):
    from src.modules.pipeline.load.destination import platform_target, resolve_target

    target = asyncio.run(platform_target())
    assert target is not None and target.is_local
    assert target.root == no_bucket.resolve().as_uri() + "/"
    assert target.public()["provider"] == "builtin"
    assert asyncio.run(resolve_target(None, uuid.uuid4(), None)).root == target.root


def test_builtin_storage_passes_the_write_check(no_bucket):
    from src.modules.pipeline.load.destination import builtin_target
    from src.modules.pipeline.storage_health import probe_s3_target

    result = asyncio.run(probe_s3_target(builtin_target()))
    assert result["ok"] is True
    assert not any((no_bucket / "_aicser").iterdir())  # the marker file is gone again


def test_silver_iceberg_on_builtin_storage(no_bucket):
    from src.modules.pipeline.ingest.duckdb_s3 import configure_duckdb_iceberg, iceberg_scan_sql
    from src.modules.pipeline.load.catalog import ensure_namespace, get_catalog
    from src.modules.pipeline.load.destination import builtin_target, object_store_for_target
    from src.modules.pipeline.load.iceberg_loader import load_to_iceberg
    from src.modules.pipeline.storage import LocalObjectStore

    target = builtin_target()
    assert isinstance(object_store_for_target(target), LocalObjectStore)
    try:
        catalog = get_catalog(target)
        namespace = f"test_builtin_{uuid.uuid4().hex[:10]}"
        ensure_namespace(catalog, namespace)
    except Exception as exc:  # noqa: BLE001 - the catalog lives in the app database
        pytest.skip(f"Iceberg catalog database unavailable: {exc}")
    location = f"{target.org_root('test')}/silver/{namespace}/orders/"
    try:
        rows = pa.table({"id": [1, 2, 3], "region": ["n", "s", "n"]})
        out = load_to_iceberg(catalog, namespace=namespace, table_name="orders", table=rows,
                              write_mode="append", primary_key=[], location=location)
        assert out["rows_written"] == 3 and out["location"].startswith("file://")
        assert catalog.load_table(f"{namespace}.orders").scan().to_arrow().num_rows == 3
        conn = duckdb.connect()
        if configure_duckdb_iceberg(conn):
            meta = catalog.load_table(f"{namespace}.orders").metadata_location
            assert conn.execute(f"SELECT count(*) FROM ({iceberg_scan_sql(meta)})").fetchone()[0] == 3
    finally:
        try:
            catalog.drop_table(f"{namespace}.orders")
        except Exception:  # noqa: BLE001
            pass
        catalog.drop_namespace(namespace)
