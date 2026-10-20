"""The local lake store reads back the file:// locations it hands out (e.g. a staged upload)."""

import pytest

from ee.modules.pipeline.storage import LocalObjectStore


@pytest.mark.asyncio
async def test_a_file_uri_from_the_store_reads_back(tmp_path):
    store = LocalObjectStore(str(tmp_path))
    out = await store.store_file(b"hello", "orgs/o1/staging/ds/session=abc/file.xlsx")
    uri = out["storage_uri"]
    assert uri.startswith("file:") and "%3D" in uri  # '=' is escaped in the URI
    assert await store.get_file(uri) == b"hello"


@pytest.mark.asyncio
async def test_a_file_uri_outside_the_lake_is_refused(tmp_path):
    store = LocalObjectStore(str(tmp_path / "lake"))
    with pytest.raises(ValueError):
        await store.get_file("file:///etc/passwd")
