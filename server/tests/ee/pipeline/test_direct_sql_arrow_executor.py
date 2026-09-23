import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def test_connection_uri_prefers_a_full_uri_if_present():
    from src.modules.data.services.multi_engine_query_service import \
        DirectSQLArrowExecutor

    executor = DirectSQLArrowExecutor(
        {"connection_info": {"uri": "postgresql+psycopg2://u:p@h:5432/db"}}
    )

    assert executor._connection_uri() == "postgresql+psycopg2://u:p@h:5432/db"


def test_connection_uri_builds_a_postgres_url_from_fields():
    from src.modules.data.services.multi_engine_query_service import \
        DirectSQLArrowExecutor

    executor = DirectSQLArrowExecutor(
        {
            "db_type": "postgresql",
            "connection_info": {
                "host": "db.internal",
                "port": 5432,
                "database": "analytics",
                "username": "reader",
                "password": "s3cr3t",
            },
        }
    )

    uri = executor._connection_uri()

    assert uri == "postgresql+psycopg2://reader:s3cr3t@db.internal:5432/analytics"


def test_connection_uri_rejects_clickhouse():
    from src.modules.data.services.multi_engine_query_service import \
        DirectSQLArrowExecutor

    executor = DirectSQLArrowExecutor(
        {"db_type": "clickhouse", "connection_info": {"host": "ch", "database": "d"}}
    )

    with pytest.raises(NotImplementedError):
        executor._connection_uri()


def test_connection_uri_requires_host_and_database():
    from src.modules.data.services.multi_engine_query_service import \
        DirectSQLArrowExecutor

    executor = DirectSQLArrowExecutor({"db_type": "postgresql", "connection_info": {}})

    with pytest.raises(ValueError, match="requires a database connection"):
        executor._connection_uri()


async def test_fetch_arrow_runs_the_query_and_returns_batches(monkeypatch):
    import pyarrow as pa

    from src.modules.data.services.multi_engine_query_service import \
        DirectSQLArrowExecutor

    executor = DirectSQLArrowExecutor({"connection_info": {"uri": "sqlite:///:memory:"}})

    class FakeResult:
        def keys(self):
            return ["id", "updated_at"]

        def fetchall(self):
            return [(1, "2026-08-01"), (2, "2026-08-03")]

    class FakeConn:
        def execute(self, stmt, params):
            return FakeResult()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr(
        "src.modules.data.services.direct_sql_pool.get_sync_engine",
        lambda data_source, uri: FakeEngine(),
    )

    batches = await executor.fetch_arrow("SELECT * FROM orders WHERE updated_at > :since", {"since": "x"})

    assert len(batches) == 1
    table = pa.Table.from_batches(batches)
    assert table.column("id").to_pylist() == [1, 2]


async def test_fetch_arrow_returns_no_batches_for_an_empty_result(monkeypatch):
    from src.modules.data.services.multi_engine_query_service import \
        DirectSQLArrowExecutor

    executor = DirectSQLArrowExecutor({"connection_info": {"uri": "sqlite:///:memory:"}})

    class FakeResult:
        def keys(self):
            return ["id"]

        def fetchall(self):
            return []

    class FakeConn:
        def execute(self, stmt, params):
            return FakeResult()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class FakeEngine:
        def connect(self):
            return FakeConn()

    monkeypatch.setattr(
        "src.modules.data.services.direct_sql_pool.get_sync_engine",
        lambda data_source, uri: FakeEngine(),
    )

    batches = await executor.fetch_arrow("SELECT * FROM orders", {})

    assert batches == []
