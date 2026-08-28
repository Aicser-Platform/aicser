import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


async def test_local_store_round_trips_bytes(tmp_path):
    from src.modules.pipeline.storage import LocalObjectStore

    store = LocalObjectStore(root=str(tmp_path))
    result = await store.store_file(b"hello", "orgs/o1/bronze/a1/part-0000.parquet")

    assert result["success"] is True
    assert result["object_key"] == "orgs/o1/bronze/a1/part-0000.parquet"
    assert result["storage_uri"].startswith("file://")
    assert await store.get_file("orgs/o1/bronze/a1/part-0000.parquet") == b"hello"


async def test_local_store_creates_missing_directories(tmp_path):
    from src.modules.pipeline.storage import LocalObjectStore

    store = LocalObjectStore(root=str(tmp_path / "does-not-exist-yet"))
    await store.store_file(b"x", "deep/nested/key.parquet")

    assert (
        tmp_path / "does-not-exist-yet" / "deep" / "nested" / "key.parquet"
    ).read_bytes() == b"x"


async def test_local_store_rejects_keys_that_escape_the_root(tmp_path):
    from src.modules.pipeline.storage import LocalObjectStore

    store = LocalObjectStore(root=str(tmp_path))

    with pytest.raises(ValueError, match="escapes the lake root"):
        await store.store_file(b"x", "../../etc/passwd")


async def test_s3_adapter_passes_the_key_positionally_and_normalises_the_result():
    from src.modules.pipeline.storage import S3ObjectStoreAdapter

    calls = []

    class FakeS3:
        bucket_name = "lake-bucket"

        async def store_file(self, file_content, object_key):
            calls.append((file_content, object_key))
            return {"success": True, "object_key": object_key}

        async def get_file(self, object_key):
            return b"payload"

    adapter = S3ObjectStoreAdapter(service=FakeS3())
    result = await adapter.store_file(b"x", "orgs/o1/bronze/a1/part-0000.parquet")

    assert calls == [(b"x", "orgs/o1/bronze/a1/part-0000.parquet")]
    assert (
        result["storage_uri"] == "s3://lake-bucket/orgs/o1/bronze/a1/part-0000.parquet"
    )
    assert await adapter.get_file("k") == b"payload"


def test_get_object_store_selects_by_storage_backend(monkeypatch):
    from src.core.config import settings
    from src.modules.pipeline.storage import LocalObjectStore, get_object_store

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    assert isinstance(get_object_store(), LocalObjectStore)
