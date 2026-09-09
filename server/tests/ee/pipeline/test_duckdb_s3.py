import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_iceberg_scan_sql_wraps_the_storage_uri_in_iceberg_scan():
    from src.modules.pipeline.ingest.duckdb_s3 import iceberg_scan_sql

    sql = iceberg_scan_sql("s3://lake/orgs/o1/gold/insights_gold/")

    assert "iceberg_scan(" in sql
    assert "s3://lake/orgs/o1/gold/insights_gold/" in sql


def test_iceberg_scan_sql_escapes_single_quotes():
    from src.modules.pipeline.ingest.duckdb_s3 import iceberg_scan_sql

    sql = iceberg_scan_sql("s3://lake/orgs/o1/gold/it's_a_table/")

    assert "it''s_a_table" in sql


def test_configure_duckdb_iceberg_returns_true_when_extension_loads():
    from src.modules.pipeline.ingest.duckdb_s3 import configure_duckdb_iceberg

    class FakeConn:
        def execute(self, _sql):
            return None

    assert configure_duckdb_iceberg(FakeConn()) is True


def test_configure_duckdb_iceberg_returns_false_and_does_not_raise_on_failure():
    from src.modules.pipeline.ingest.duckdb_s3 import configure_duckdb_iceberg

    class FailingConn:
        def execute(self, _sql):
            raise RuntimeError("no network access to extension repository")

    assert configure_duckdb_iceberg(FailingConn()) is False
