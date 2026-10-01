"""File extracts: the first query parses the upload and saves it; later queries read the saved
copy (the original file isn't touched again), and editing the source drops it."""

import os

import duckdb
import pytest

from src.modules.data.services import file_extracts
from src.modules.data.services.multi_engine_query_service import (
    DuckDBEngine,
    invalidate_api_response_cache,
)


@pytest.fixture()
def csv_source(tmp_path, monkeypatch):
    monkeypatch.setenv("AISER_EXTRACT_DIR", str(tmp_path / "extracts"))
    path = tmp_path / "sales.csv"
    path.write_text("region,amount\nNorth,10\nSouth,5\nNorth,7\n")
    return {"id": "ds-sales", "type": "file", "format": "csv", "file_path": str(path), "schema": {}}


def _total(conn):
    return conn.execute("SELECT region, SUM(amount) FROM data GROUP BY region ORDER BY region").fetchall()


@pytest.mark.asyncio
async def test_second_query_reads_the_extract_not_the_file(csv_source):
    service = DuckDBEngine.__new__(DuckDBEngine)

    first = duckdb.connect()
    await service._load_file_data_cached(first, csv_source)
    assert _total(first) == [("North", 17), ("South", 5)]
    extract = file_extracts.extract_path(csv_source)
    assert extract and os.path.isfile(extract)

    second = duckdb.connect()
    loads = []
    original = service._load_file_data

    async def spy(conn, ds):
        loads.append(ds)
        await original(conn, ds)

    service._load_file_data = spy
    await service._load_file_data_cached(second, csv_source)
    assert loads == []  # served from the extract
    assert _total(second) == [("North", 17), ("South", 5)]


@pytest.mark.asyncio
async def test_editing_the_source_drops_its_extract(csv_source):
    service = DuckDBEngine.__new__(DuckDBEngine)
    await service._load_file_data_cached(duckdb.connect(), csv_source)
    extract = file_extracts.extract_path(csv_source)
    assert os.path.isfile(extract)
    invalidate_api_response_cache("ds-sales")
    assert not os.path.isfile(extract)


@pytest.mark.asyncio
async def test_a_broken_extract_falls_back_to_parsing(csv_source):
    service = DuckDBEngine.__new__(DuckDBEngine)
    extract = file_extracts.extract_path(csv_source)
    with open(extract, "wb") as fh:
        fh.write(b"not a duckdb file")
    conn = duckdb.connect()
    await service._load_file_data_cached(conn, csv_source)
    assert _total(conn) == [("North", 17), ("South", 5)]
