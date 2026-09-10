import pytest


async def test_duckdb_engine_loads_a_lakehouse_iceberg_source_via_iceberg_scan(monkeypatch):
    from src.modules.data.services.multi_engine_query_service import DuckDBEngine

    calls = []

    class FakeConn:
        def execute(self, sql, *a, **kw):
            calls.append(sql)
            return self

        def fetchall(self):
            return []

    fake_conn = FakeConn()
    monkeypatch.setattr(
        "duckdb.connect", lambda *a, **kw: fake_conn
    )
    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.configure_duckdb_s3",
        lambda conn: True,
        raising=False,
    )
    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.configure_duckdb_iceberg",
        lambda conn: True,
        raising=False,
    )

    engine = DuckDBEngine()
    data_source = {
        "type": "lakehouse_iceberg",
        "storage_uri": "s3://lake/orgs/o1/gold/orders/",
    }

    await engine._load_lakehouse_iceberg(fake_conn, data_source)

    assert any("iceberg_scan(" in c for c in calls)
    assert any(c.startswith("CREATE TABLE data AS") for c in calls)


async def test_duckdb_engine_execute_routes_lakehouse_iceberg_to_the_iceberg_loader_not_file_upload(
    monkeypatch,
):
    """Guards the elif ordering in DuckDBEngine.execute: after Step 1's frozenset
    extension, is_file_upload_duckdb("lakehouse_iceberg") is also True, so if the
    "lakehouse_iceberg" branch were ever moved after (or removed in favor of) the
    is_file_upload_duckdb branch, this test must fail. It exercises execute()
    end-to-end rather than calling _load_lakehouse_iceberg directly, so it actually
    proves the real if/elif dispatch — not just the helper's own body."""
    from src.modules.data.services.multi_engine_query_service import DuckDBEngine

    class FakeConn:
        def execute(self, sql, *a, **kw):
            return self

        def fetchall(self):
            return []

        def close(self):
            pass

    monkeypatch.setattr("duckdb.connect", lambda *a, **kw: FakeConn())

    sentinel = "iceberg-branch-entered"

    async def fake_load_lakehouse_iceberg(self, conn, data_source):
        raise RuntimeError(sentinel)

    monkeypatch.setattr(
        DuckDBEngine, "_load_lakehouse_iceberg", fake_load_lakehouse_iceberg
    )

    engine = DuckDBEngine()
    data_source = {
        "type": "lakehouse_iceberg",
        "storage_uri": "s3://lake/orgs/o1/gold/orders/",
    }

    result = await engine.execute("SELECT * FROM data", data_source, {})

    assert result["success"] is False
    assert sentinel in result["error"]


async def test_duckdb_engine_also_exposes_the_lakehouse_table_under_its_real_name(
    monkeypatch,
):
    """SQL built against the source's real schema (chart_service does exactly
    that) references the pipeline's configured table name, not "data". Both must
    resolve to the same rows."""
    from src.modules.data.services.multi_engine_query_service import DuckDBEngine

    calls = []

    class FakeConn:
        def execute(self, sql, *a, **kw):
            calls.append(sql)
            return self

        def fetchall(self):
            return []

    fake_conn = FakeConn()
    monkeypatch.setattr("duckdb.connect", lambda *a, **kw: fake_conn)
    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.configure_duckdb_s3",
        lambda conn: True,
        raising=False,
    )
    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.configure_duckdb_iceberg",
        lambda conn: True,
        raising=False,
    )

    engine = DuckDBEngine()
    await engine._load_lakehouse_iceberg(
        fake_conn,
        {
            "type": "lakehouse_iceberg",
            "storage_uri": "s3://lake/orgs/o1/gold/orders/",
            "source_table": "orders",
        },
    )

    assert any(c.startswith("CREATE TABLE data AS") for c in calls)
    assert any(
        c == 'CREATE VIEW "orders" AS SELECT * FROM data' for c in calls
    ), calls


async def test_duckdb_lakehouse_alias_returns_the_same_rows_as_data():
    """End-to-end against a real in-memory DuckDB: the alias is not just a
    statement we emitted, it actually resolves."""
    import duckdb

    from src.modules.data.services.multi_engine_query_service import DuckDBEngine

    conn = duckdb.connect(":memory:")

    # Exercise the real body, but with iceberg_scan replaced by a local table.
    import src.modules.pipeline.ingest.duckdb_s3 as duckdb_s3

    orig_scan = duckdb_s3.iceberg_scan_sql
    orig_s3 = duckdb_s3.configure_duckdb_s3
    orig_ice = duckdb_s3.configure_duckdb_iceberg
    duckdb_s3.iceberg_scan_sql = lambda uri: "SELECT 1 AS id UNION ALL SELECT 2"
    duckdb_s3.configure_duckdb_s3 = lambda c: True
    duckdb_s3.configure_duckdb_iceberg = lambda c: True
    try:
        await DuckDBEngine()._load_lakehouse_iceberg(
            conn,
            {
                "type": "lakehouse_iceberg",
                "storage_uri": "s3://lake/orgs/o1/gold/orders/",
                "source_table": "orders",
            },
        )
    finally:
        duckdb_s3.iceberg_scan_sql = orig_scan
        duckdb_s3.configure_duckdb_s3 = orig_s3
        duckdb_s3.configure_duckdb_iceberg = orig_ice

    assert conn.execute("SELECT * FROM data ORDER BY 1").fetchall() == [(1,), (2,)]
    assert conn.execute('SELECT * FROM "orders" ORDER BY 1').fetchall() == [(1,), (2,)]


async def test_duckdb_lakehouse_load_without_a_source_table_still_creates_data(
    monkeypatch,
):
    from src.modules.data.services.multi_engine_query_service import DuckDBEngine

    calls = []

    class FakeConn:
        def execute(self, sql, *a, **kw):
            calls.append(sql)
            return self

    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.configure_duckdb_s3",
        lambda conn: True,
        raising=False,
    )
    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.configure_duckdb_iceberg",
        lambda conn: True,
        raising=False,
    )

    await DuckDBEngine()._load_lakehouse_iceberg(
        FakeConn(),
        {
            "type": "lakehouse_iceberg",
            "storage_uri": "s3://lake/orgs/o1/gold/orders/",
            "source_table": None,
        },
    )

    assert any(c.startswith("CREATE TABLE data AS") for c in calls)
    assert not any("CREATE VIEW" in c for c in calls)
