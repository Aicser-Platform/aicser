import os
import uuid

import duckdb
import pytest

from src.modules.pipeline.ingest import duckdb_s3, lakehouse_serving
from src.modules.pipeline.ingest.lakehouse_serving import (
    referenced_tables,
    register_served_tables,
    table_scan_sql,
)


@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(lakehouse_serving, "CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(lakehouse_serving, "CACHE_ENABLED", True)
    return tmp_path


@pytest.fixture
def local_iceberg(monkeypatch):
    """iceberg_scan over s3://lake/<t>/ reads the in-memory table src_<t>."""
    monkeypatch.setattr(
        duckdb_s3,
        "iceberg_scan_sql",
        lambda uri: f"SELECT * FROM src_{uri.rstrip('/').rsplit('/', 1)[-1]}",
    )


def _table(name, **extra):
    return {"name": name, "storage_uri": f"s3://lake/{name}/", **extra}


def test_referenced_tables_reads_from_and_join_targets():
    assert referenced_tables("SELECT * FROM customers c JOIN orders o ON c.id = o.cid") == {
        "customers",
        "orders",
    }


def test_referenced_tables_excludes_ctes_and_lowercases():
    sql = 'WITH recent AS (SELECT * FROM "Orders") SELECT * FROM recent'
    assert referenced_tables(sql) == {"orders"}


def test_referenced_tables_is_none_when_unparseable():
    assert referenced_tables("SELECT FROM WHERE (((") is None
    assert referenced_tables(None) is None


def test_only_referenced_tables_are_registered(cache_dir, local_iceberg):
    conn = duckdb.connect()
    conn.execute("CREATE TABLE src_customers AS SELECT 1 AS id")
    # src_orders deliberately missing: registering orders would fail to bind
    tables = [_table("customers"), _table("orders")]

    register_served_tables(conn, tables, tables[0], "SELECT * FROM customers")

    assert conn.execute("SELECT * FROM customers").fetchall() == [(1,)]
    views = {r[0] for r in conn.execute("SELECT view_name FROM duckdb_views() WHERE NOT internal").fetchall()}
    assert views == {"customers"}


def test_all_tables_registered_when_query_unknown(cache_dir, local_iceberg):
    conn = duckdb.connect()
    conn.execute("CREATE TABLE src_customers AS SELECT 1 AS id")
    conn.execute("CREATE TABLE src_orders AS SELECT 2 AS id")
    tables = [_table("customers"), _table("orders")]

    register_served_tables(conn, tables, tables[1], None)

    assert conn.execute("SELECT * FROM data").fetchall() == [(2,)]
    assert conn.execute("SELECT * FROM customers").fetchall() == [(1,)]


def test_a_cached_table_is_served_from_its_local_copy(cache_dir, local_iceberg):
    conn = duckdb.connect()
    conn.execute("CREATE TABLE src_customers AS SELECT * FROM range(3) t(id)")
    table = _table("customers", lake_object_id=str(uuid.uuid4()), row_count=3)

    first = table_scan_sql(conn, table)
    conn.execute("DROP TABLE src_customers")  # the "remote" is gone now
    second = table_scan_sql(conn, table)

    assert first == second and "read_parquet(" in second
    assert conn.execute(f"SELECT count(*) FROM ({second})").fetchone() == (3,)
    assert [f for f in os.listdir(cache_dir) if f.endswith(".parquet")]


def test_a_new_pipeline_run_gets_a_new_copy(cache_dir, local_iceberg):
    conn = duckdb.connect()
    conn.execute("CREATE TABLE src_customers AS SELECT 1 AS id")
    before = table_scan_sql(conn, _table("customers", lake_object_id=str(uuid.uuid4())))
    conn.execute("INSERT INTO src_customers VALUES (2)")
    after = table_scan_sql(conn, _table("customers", lake_object_id=str(uuid.uuid4())))

    assert before != after
    assert conn.execute(f"SELECT count(*) FROM ({after})").fetchone() == (2,)


@pytest.mark.parametrize(
    "extra",
    [{}, {"lake_object_id": "../../etc/passwd"}, {"lake_object_id": str(uuid.uuid4()), "row_count": 10**12}],
    ids=["no-id", "not-a-uuid", "over-row-cap"],
)
def test_uncacheable_tables_read_remotely(cache_dir, local_iceberg, extra):
    conn = duckdb.connect()
    conn.execute("CREATE TABLE src_customers AS SELECT 1 AS id")

    assert table_scan_sql(conn, _table("customers", **extra)) == "SELECT * FROM src_customers"
    assert os.listdir(cache_dir) == []


def test_a_failed_fill_falls_back_to_remote_and_leaves_no_temp_file(cache_dir, local_iceberg):
    conn = duckdb.connect()  # src_customers missing: the COPY fails

    sql = table_scan_sql(conn, _table("customers", lake_object_id=str(uuid.uuid4())))

    assert sql == "SELECT * FROM src_customers"
    assert os.listdir(cache_dir) == []


def test_serving_connections_do_not_share_temp_views(monkeypatch):
    monkeypatch.setattr(lakehouse_serving, "_db", None)
    monkeypatch.setattr(duckdb_s3, "configure_duckdb_s3", lambda c: False)
    monkeypatch.setattr(duckdb_s3, "configure_duckdb_iceberg", lambda c: False)

    a = lakehouse_serving.serving_connection()
    b = lakehouse_serving.serving_connection()
    a.execute("CREATE TEMP VIEW data AS SELECT 'a' AS who")
    b.execute("CREATE TEMP VIEW data AS SELECT 'b' AS who")

    assert a.execute("SELECT who FROM data").fetchone() == ("a",)
    assert b.execute("SELECT who FROM data").fetchone() == ("b",)
