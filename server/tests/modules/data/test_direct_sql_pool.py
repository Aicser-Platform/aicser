"""Tests for Direct SQL connection pooling."""

from src.modules.data.services import direct_sql_pool


def test_pool_reuses_engine_for_same_data_source():
    direct_sql_pool.clear_all_pools()
    source = {"id": "ds-123"}
    uri = "postgresql+psycopg2://user:pass@localhost:5432/testdb"

    first = direct_sql_pool.get_sync_engine(source, uri)
    second = direct_sql_pool.get_sync_engine(source, uri)

    assert first is second
    direct_sql_pool.clear_all_pools()


def test_pool_key_falls_back_to_uri_hash_without_id():
    direct_sql_pool.clear_all_pools()
    uri = "postgresql+psycopg2://user:pass@localhost:5432/other"

    first = direct_sql_pool.get_sync_engine({}, uri)
    second = direct_sql_pool.get_sync_engine({}, uri)

    assert first is second
    direct_sql_pool.clear_all_pools()


def test_dispose_engine_for_data_source():
    direct_sql_pool.clear_all_pools()
    source = {"id": "ds-dispose"}
    uri = "postgresql+psycopg2://user:pass@localhost:5432/dispose"

    engine = direct_sql_pool.get_sync_engine(source, uri)
    direct_sql_pool.dispose_engine_for_data_source("ds-dispose")
    replacement = direct_sql_pool.get_sync_engine(source, uri)

    assert replacement is not engine
    direct_sql_pool.clear_all_pools()
