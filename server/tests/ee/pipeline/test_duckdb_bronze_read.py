import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_bronze_scan_sql_globs_all_load_partitions():
    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    uri = "s3://bucket/orgs/abc/bronze/ds-1/load_id=run-1/part-0000.parquet"
    sql = bronze_scan_sql(uri)

    assert "read_parquet" in sql
    assert "s3://bucket/orgs/abc/bronze/ds-1/load_id=*/*.parquet" in sql


def test_bronze_scan_sql_rejects_an_unsupported_scheme():
    import pytest

    from src.modules.pipeline.ingest.duckdb_s3 import bronze_scan_sql

    with pytest.raises(ValueError, match="unsupported storage URI"):
        bronze_scan_sql("gs://bucket/orgs/o1/bronze/a1/load_id=abc/p.parquet")


def test_configure_duckdb_s3_sets_credentials(monkeypatch):
    from src.modules.pipeline.ingest.duckdb_s3 import configure_duckdb_s3

    executed = []

    class FakeConn:
        def execute(self, sql, *args, **kwargs):
            executed.append(sql)
            return self

    monkeypatch.setattr(
        "src.core.config.settings.S3_ACCESS_KEY_ID", "AK", raising=False
    )
    monkeypatch.setattr(
        "src.core.config.settings.S3_SECRET_ACCESS_KEY", "SK", raising=False
    )
    monkeypatch.setattr(
        "src.core.config.settings.S3_REGION", "eu-west-1", raising=False
    )
    monkeypatch.setattr("src.core.config.settings.S3_ENDPOINT_URL", "", raising=False)

    assert configure_duckdb_s3(FakeConn()) is True

    joined = " ".join(executed)
    assert "INSTALL httpfs" in joined
    assert "LOAD httpfs" in joined
    assert "CREATE OR REPLACE SECRET" in joined
    assert "eu-west-1" in joined


def test_configure_duckdb_s3_returns_false_without_credentials(monkeypatch):
    from src.modules.pipeline.ingest.duckdb_s3 import configure_duckdb_s3

    class FakeConn:
        def execute(self, sql, *args, **kwargs):
            return self

    monkeypatch.setattr("src.core.config.settings.S3_ACCESS_KEY_ID", "", raising=False)
    monkeypatch.setattr(
        "src.core.config.settings.S3_SECRET_ACCESS_KEY", "", raising=False
    )

    assert configure_duckdb_s3(FakeConn()) is False


async def test_load_file_data_uses_bronze_fast_path(monkeypatch):
    from src.modules.data.services.multi_engine_query_service import \
        DuckDBEngine

    executed = []

    class FakeConn:
        def execute(self, sql, *args, **kwargs):
            executed.append(sql)
            return self

    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.configure_duckdb_s3",
        lambda conn: True,
    )
    monkeypatch.setattr(
        "src.modules.pipeline.ingest.duckdb_s3.bronze_scan_sql",
        lambda uri: "SELECT * FROM read_parquet('s3://bucket/path/*.parquet')",
    )

    source = {
        "id": "ds-1",
        "type": "file",
        "format": "csv",
        "storage_uri": "s3://bucket/orgs/o/bronze/ds-1/load_id=r/part-0000.parquet",
        "sample_data": [{"id": 999}],
    }
    await DuckDBEngine()._load_file_data(FakeConn(), source)

    assert executed == [
        "CREATE OR REPLACE TABLE data AS SELECT * FROM read_parquet('s3://bucket/path/*.parquet')"
    ]
    assert source["analysis_based_on_sample_only"] is False
