"""Google Sheets are fetched once per freshness window, not once per query."""

import asyncio
import os

import pytest

from src.modules.data.services import sheet_snapshot_cache as snap


@pytest.fixture(autouse=True)
def tmp_cache(tmp_path, monkeypatch):
    import src.modules.data.services.upload_datasource_storage_service as up

    monkeypatch.setattr(up, "_get_cache_dir", lambda: str(tmp_path))
    snap._locks.clear()
    return tmp_path


@pytest.mark.asyncio
async def test_reuses_snapshot_within_ttl_and_downloads_once_under_concurrency(monkeypatch):
    monkeypatch.setenv("GOOGLE_SHEETS_SNAPSHOT_TTL_S", "60")
    calls = {"n": 0}

    async def fetch():
        calls["n"] += 1
        await asyncio.sleep(0.05)
        return "a,b\n1,2\n"

    paths = await asyncio.gather(*[snap.get_sheet_snapshot("ds1", "sheet", "0", fetch) for _ in range(8)])
    assert calls["n"] == 1 and len(set(paths)) == 1
    assert open(paths[0]).read() == "a,b\n1,2\n"
    await snap.get_sheet_snapshot("ds1", "sheet", "0", fetch)
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_refreshes_when_stale_and_serves_stale_if_google_down(monkeypatch):
    monkeypatch.setenv("GOOGLE_SHEETS_SNAPSHOT_TTL_S", "0")

    async def ok():
        return "v\n1\n"

    path = await snap.get_sheet_snapshot("ds1", "sheet", "0", ok)

    async def down():
        raise ConnectionError("google unreachable")

    assert await snap.get_sheet_snapshot("ds1", "sheet", "0", down) == path
    monkeypatch.setenv("GOOGLE_SHEETS_SNAPSHOT_MAX_STALE_S", "0")
    with pytest.raises(ConnectionError):
        await snap.get_sheet_snapshot("ds1", "sheet", "0", down)


@pytest.mark.asyncio
async def test_data_sources_never_share_a_snapshot():
    async def a():
        return "x\nA\n"

    async def b():
        return "x\nB\n"

    pa = await snap.get_sheet_snapshot("tenant-a-ds", "same-sheet", "0", a)
    pb = await snap.get_sheet_snapshot("tenant-b-ds", "same-sheet", "0", b)
    assert pa != pb and "A" in open(pa).read() and "B" in open(pb).read()
