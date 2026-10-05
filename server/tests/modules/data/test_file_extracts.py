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


@pytest.fixture()
def excel_source(tmp_path, monkeypatch):
    import pandas as pd

    monkeypatch.setenv("AISER_EXTRACT_DIR", str(tmp_path / "extracts"))
    path = tmp_path / "ecommerce.xlsx"
    with pd.ExcelWriter(path) as xl:
        pd.DataFrame({"order_id": ["O1", "O2"], "total_amount": [10.5, 4.5]}).to_excel(xl, sheet_name="orders", index=False)
        pd.DataFrame({"order_item_id": ["I1"], "quantity": [3]}).to_excel(xl, sheet_name="order_items", index=False)
    return {"id": "ds-ecom", "type": "file", "format": "xlsx", "file_path": str(path), "schema": {}}


def _sheet_tables(conn):
    return sorted(r[0] for r in conn.execute(
        "SELECT DISTINCT table_name FROM information_schema.tables WHERE table_name LIKE 'sheet_%'"
    ).fetchall())


@pytest.mark.asyncio
async def test_excel_extract_keeps_the_data_view_for_later_queries(excel_source):
    """'data' is a view over the first sheet: extracts used to drop it, so every query after the
    first failed with "Data table not loaded properly"."""
    service = DuckDBEngine.__new__(DuckDBEngine)
    await service._load_file_data_cached(duckdb.connect(), excel_source)

    later = duckdb.connect()
    await service._load_file_data_cached(later, excel_source)

    assert later.execute("SELECT SUM(total_amount) FROM data").fetchone()[0] == 15.0
    assert len(_sheet_tables(later)) == 2


@pytest.mark.asyncio
async def test_an_extract_saved_without_data_is_parsed_again(excel_source):
    """Extracts written before views were kept are on disk: they must heal, not fail."""
    service = DuckDBEngine.__new__(DuckDBEngine)
    loaded = duckdb.connect()
    await service._load_excel_all_sheets_into_duckdb(loaded, excel_source["file_path"], {})
    loaded.execute("DROP VIEW data")  # what the old write() saved
    path = file_extracts.extract_path(excel_source)
    file_extracts.write(loaded, path)

    conn = duckdb.connect()
    await service._load_file_data_cached(conn, excel_source)

    assert conn.execute("SELECT SUM(total_amount) FROM data").fetchone()[0] == 15.0
    fixed = duckdb.connect()
    assert "data" in file_extracts.attach(fixed, path)  # rewritten with the view
