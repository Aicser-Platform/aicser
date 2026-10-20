"""Bronze files are rewritten without the person; erased people are left out of later runs."""

import io
from types import SimpleNamespace

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from ee.modules.privacy import service


class _Store:
    def __init__(self, data):
        self.files = {"orgs/o/bronze/s/part-1.parquet": data}

    async def get_file(self, key):
        return self.files[key]

    async def store_file(self, content, key):
        self.files[key] = content
        return {}


@pytest.mark.asyncio
async def test_bronze_rewrite_removes_only_the_person(monkeypatch):
    buf = io.BytesIO()
    pq.write_table(pa.table({"email": ["dara@acme.com", "lina@shop.kh", "DARA@acme.com "], "amount": [1, 2, 3]}), buf)
    store = _Store(buf.getvalue())

    async def get_store():
        return store

    import src.modules.pipeline.storage as storage

    monkeypatch.setattr(storage, "get_object_store_async", get_store)
    obj = SimpleNamespace(object_key="orgs/o/bronze/s/part-1.parquet", row_count=3)
    removed = await service._rewrite_parquet(obj, ["email"], "email", "dara@acme.com")
    kept = pq.read_table(io.BytesIO(store.files[obj.object_key]))
    assert removed == 2 and kept["email"].to_pylist() == ["lina@shop.kh"] and obj.row_count == 1


@pytest.mark.asyncio
async def test_suppressions_come_from_erased_requests_on_that_connection(monkeypatch):
    import src.modules.data.utils.credentials as creds

    monkeypatch.setattr(creds, "decrypt_text", lambda token: token)
    rows = [SimpleNamespace(identifier_type="email", subject_secret=" Dara@Acme.com", findings=[
        {"data_source_id": "ds1", "table": "contacts", "columns": ["email"]},
        {"data_source_id": "ds2", "table": "other", "columns": ["mail"]},
    ])]

    class _DB:
        async def execute(self, *_a, **_k):
            class _R:
                def scalars(self):
                    return SimpleNamespace(all=lambda: rows)
            return _R()

    out = await service.active_suppressions(_DB(), "org", "ds1", None)
    assert out == [{"identifier_type": "email", "value": "dara@acme.com", "columns": ["email"]}]
