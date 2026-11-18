"""Clean copy: one DuckDB file per source holding its prepared tables, readable by the query engine."""

import os

import duckdb
import pyarrow as pa

from src.modules.prep import clean_copy
from src.modules.prep.service import _recipe_table, source_tables

WORKBOOK = {
    "id": "s1",
    "type": "file",
    "schema": {"tables": [{"name": "customers", "row_count": 3, "columns": [{"name": "id"}]}, {"name": "orders", "row_count": 5}]},
}
DATABASE = {
    "id": "s2",
    "type": "database",
    "schema": {"tables": [{"name": "customers", "schema": "public"}, {"name": "customers", "schema": "crm"},
                          {"name": "loans", "schema": "bank"}]},
}


def test_source_tables_name_tables_like_the_editor():
    assert [t["name"] for t in source_tables(WORKBOOK)] == ["customers", "orders"]
    assert [t["name"] for t in source_tables(DATABASE)] == ["customers", "crm.customers", "bank.loans"]
    assert source_tables({"type": "file", "schema": {}})[0]["name"] == "data"


def test_clean_copy_table_names():
    assert clean_copy.table_name_for(WORKBOOK, "data") == "customers"  # a file's "data" is its first sheet
    assert clean_copy.table_name_for(WORKBOOK, "orders") == "orders"
    assert clean_copy.table_name_for(DATABASE, "bank.loans") == "loans"
    # Two schemas with the same table keep the schema so neither overwrites the other
    assert clean_copy.table_name_for(DATABASE, "crm.customers") == "crm_customers"
    assert clean_copy.table_name_for(DATABASE, "weird name!") == "weird_name"


def test_a_file_recipe_on_data_reads_the_first_table():
    class R:
        source_table = "data"

    assert _recipe_table(WORKBOOK, R()) == "customers"


def test_write_replaces_one_table_and_keeps_the_rest(tmp_path):
    path = str(tmp_path / "copy.duckdb")
    clean_copy._write_tables(path, {"customers": pa.table({"id": [1, 2]}), "orders": pa.table({"n": [1]})}, [])
    out = clean_copy._write_tables(path, {"customers": pa.table({"id": [1, 2, 3], "name": ["a", "b", "c"]})}, [])
    tables = {t["name"]: t for t in out["tables"]}
    assert tables["customers"]["row_count"] == 3
    assert [c["name"] for c in tables["customers"]["columns"]] == ["id", "name"]
    assert tables["orders"]["row_count"] == 1
    out = clean_copy._write_tables(path, {}, ["orders"])
    assert [t["name"] for t in out["tables"]] == ["customers"]


def test_query_engine_loads_every_table_and_a_data_view(tmp_path):
    path = str(tmp_path / "copy.duckdb")
    clean_copy._write_tables(path, {"customers": pa.table({"id": [1, 2]}), "orders": pa.table({"cid": [1, 1, 2]})}, [])
    conn = duckdb.connect()
    names = clean_copy.load_into(conn, path)
    assert sorted(names) == ["customers", "orders"]
    joined = conn.execute("SELECT COUNT(*) FROM customers c JOIN orders o ON o.cid = c.id").fetchone()[0]
    assert joined == 3
    assert conn.execute("SELECT COUNT(*) FROM data").fetchone()[0] == 2  # the first table
    # The file is not held open: it can be replaced right after
    os.remove(path)
