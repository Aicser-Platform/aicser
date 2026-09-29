"""Warehouse safety and SQL handling that doesn't need a running engine."""

import os

import pytest

from ee.modules.warehouse import catalog, engine


@pytest.mark.parametrize("sql", [
    "drop table orders",
    "insert into orders values (1)",
    "select 1; select 2",
    "copy orders to '/tmp/x.csv'",
    "select * from read_parquet('/etc/passwd')",
    "select * from iceberg_scan('s3://other/tbl')",
    "attach 'x.db'",
])
def test_only_one_select_over_table_names(sql):
    with pytest.raises(engine.WarehouseError):
        engine.referenced_tables(sql)


def test_referenced_tables_skip_ctes():
    sql = "with recent as (select * from orders where order_date > date '2024-06-01') select * from recent join stores using (store)"
    assert engine.referenced_tables(sql) == ["orders", "stores"]


def test_locations_are_object_storage_or_the_lake_folder(monkeypatch, tmp_path):
    monkeypatch.setenv("LAKEHOUSE_LOCAL_ROOT", str(tmp_path))
    assert catalog.location_allowed("s3://bucket/gold/orders/metadata/v3.metadata.json")
    assert catalog.location_allowed(f"file://{tmp_path}/warehouse/x.metadata.json")
    assert catalog.location_allowed(f"{tmp_path}/gold/*.parquet")
    assert not catalog.location_allowed("/etc/passwd")
    assert not catalog.location_allowed(f"file://{tmp_path}/../secrets")
    assert not catalog.location_allowed("http://evil.test/x.parquet")
    assert not catalog.location_allowed("")


def test_sql_names_are_short_safe_and_unique():
    taken: set = set()
    assert catalog.sql_name("org_ab_gold.orders_daily", taken) == "orders_daily"
    assert catalog.sql_name("org_ab_gold2.orders_daily", taken) == "org_ab_gold2__orders_daily"
    assert catalog.sql_name("org_ab_gold.Weird Name!", taken) == "weird_name"


def test_trino_rewrite_qualifies_tables_and_expands_group_by_all(monkeypatch):
    captured = {}

    class Cursor:
        description = [("store",), ("n",)]

        def execute(self, sql):
            captured["sql"] = sql

        def fetchall(self):
            return [("Store 1", 3)]

    class Conn:
        def cursor(self):
            return Cursor()

        def close(self):
            pass

    import trino

    monkeypatch.setenv("TRINO_URL", "http://trino:8080")
    monkeypatch.setattr(trino.dbapi, "connect", lambda **kw: Conn())
    out = engine._run_trino(
        "select store, count(*) as n from orders group by all order by n desc",
        [{"name": "orders", "identifier": "org_ab_gold.orders", "format": "iceberg", "location": "s3://b/x"}],
        30,
    )
    assert out["rows"] == [("Store 1", 3)]
    assert '"iceberg"."org_ab_gold"."orders"' in captured["sql"]
    assert "GROUP BY 1" in captured["sql"] and "ALL" not in captured["sql"]


def test_trino_refuses_nested_namespaces(monkeypatch):
    monkeypatch.setenv("TRINO_URL", "http://trino:8080")
    with pytest.raises(engine.WarehouseError, match="nested namespace"):
        engine._run_trino("select * from orders", [{"name": "orders", "identifier": "org.gold.orders", "format": "iceberg", "location": "s3://b"}], 30)


def test_embedded_engine_reads_parquet_views(tmp_path, monkeypatch):
    import duckdb

    monkeypatch.setenv("LAKEHOUSE_LOCAL_ROOT", str(tmp_path))
    path = tmp_path / "orders.parquet"
    duckdb.connect().execute(f"copy (select i as id, i % 3 as grp from range(1000) t(i)) to '{path}' (format parquet)")
    out = engine._run(
        "select grp, count(*) as n from orders group by grp order by grp",
        [{"name": "orders", "format": "parquet", "location": str(path)}],
        "small",
        30,
    )
    assert out["columns"] == ["grp", "n"]
    assert [tuple(r) for r in out["rows"]] == [(0, 334), (1, 333), (2, 333)]
