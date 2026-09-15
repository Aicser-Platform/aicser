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


def test_incremental_and_cdc_modes_scope_transform_to_only_the_new_bronze_partition():
    """Incremental/CDC ingest already scopes Bronze to just this run's new
    rows (see IngestStage's watermark-based read) -- re-reading the full
    historical Bronze glob every run and appending it again would duplicate
    every previously-loaded row on each successful incremental run.
    Reproduces a real production incident verified against the live crm
    MySQL database: a customers pipeline (ingest_mode=incremental,
    write_mode=append) tripled every one of its 80 rows to 240 across 3
    incremental runs, because Transform always read every Bronze load
    partition ever written for that table, not just the new one. Snapshot
    mode intentionally reprocesses full source history each run, so it keeps
    the full glob."""
    from src.modules.pipeline.transform.stage import \
        _should_read_exact_bronze_partition

    Pipeline = lambda mode: type("P", (), {"ingest_mode": mode})()  # noqa: E731

    assert _should_read_exact_bronze_partition(Pipeline("incremental")) is True
    assert _should_read_exact_bronze_partition(Pipeline("cdc")) is True
    assert _should_read_exact_bronze_partition(Pipeline("snapshot")) is False
