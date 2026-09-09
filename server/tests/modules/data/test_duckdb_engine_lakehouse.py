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
