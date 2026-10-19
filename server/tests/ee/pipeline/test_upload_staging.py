import os
import uuid

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")


class FakeStore:
    def __init__(self):
        self.saved = {}

    async def store_file(self, payload, key):
        self.saved[key] = payload
        return {"storage_uri": f"s3://lake/{key}"}


class FakeDb:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)


@pytest.mark.asyncio
async def test_the_original_upload_is_kept_as_a_staging_object(monkeypatch, tmp_path):
    from src.modules.pipeline import staging

    store = FakeStore()

    async def fake_store():
        return store

    monkeypatch.setattr(staging, "get_object_store_async", fake_store)
    path = tmp_path / "sales.xlsx"
    path.write_bytes(b"xlsx-bytes")
    db, org = FakeDb(), uuid.uuid4()

    out = await staging.stage_original_upload(db, org_id=org, data_source_id="ds1", file_path=str(path), filename="sales.xlsx")

    (key, payload), = store.saved.items()
    assert payload == b"xlsx-bytes" and key.startswith(f"orgs/{org}/staging/ds1/upload=") and key.endswith("/sales.xlsx")
    obj = db.added[0]
    assert obj.layer == "staging" and obj.format == "xlsx" and obj.status == "active" and obj.byte_size == 10
    assert out["object_key"] == key and out["storage_uri"] == f"s3://lake/{key}"


@pytest.mark.asyncio
async def test_staging_failures_never_fail_the_upload(monkeypatch):
    from src.modules.pipeline import staging

    async def broken(*a, **k):
        raise FileNotFoundError("gone")

    monkeypatch.setattr(staging, "stage_original_upload", broken)
    assert await staging.try_stage_original_upload(FakeDb(), "/nope", uuid.uuid4(), "ds1") is None


@pytest.mark.asyncio
async def test_nothing_is_staged_without_an_organization():
    from src.modules.data.services.data_connectivity_service import _stage_original_upload

    assert await _stage_original_upload(FakeDb(), "/x.csv", None, "ds1") is None
