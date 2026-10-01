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
    # A snapshot load is already the full source: re-reading every past load
    # re-added the whole history on each run.
    assert _should_read_exact_bronze_partition(Pipeline("snapshot")) is True


def test_snapshot_runs_replace_instead_of_appending():
    from src.modules.pipeline.transform.stage import _effective_write_mode

    class Pipeline:
        def __init__(self, mode):
            self.ingest_mode = mode

    assert _effective_write_mode(Pipeline("snapshot"), "append") == "overwrite"
    assert _effective_write_mode(Pipeline("snapshot"), "merge") == "merge"
    assert _effective_write_mode(Pipeline("incremental"), "append") == "append"


def test_iceberg_table_key_isolates_layer_source_and_table():
    from src.modules.pipeline.load.stage import iceberg_table_key

    a = iceberg_table_key("silver", "69c355d2-f2cf-4baa", "customers")
    assert a == "silver_69c355d2f2cf_customers"
    assert iceberg_table_key("gold", "69c355d2-f2cf-4baa", "customers") != a
    assert iceberg_table_key("silver", "db_mysql_17902", "customers") != a
    assert iceberg_table_key("silver", "x", "Order Items!") == "silver_x_order_items"


def test_gold_source_accumulates_every_table_and_keeps_its_primary():
    from src.modules.pipeline.load.stage import merge_gold_table

    def t(name, rows):
        return {"name": name, "storage_uri": f"s3://b/gold/{name}/", "row_count": rows,
                "lake_object_id": f"lo-{name}", "columns": [{"name": "id", "type": "int64"}]}

    cc, schema, total = merge_gold_table(None, None, t("customers", 64))
    cc, schema, total = merge_gold_table(cc, schema, t("orders", 100))
    cc, schema, total = merge_gold_table(cc, schema, t("customers", 70))  # re-run replaces

    assert [x["name"] for x in cc["lakehouse_tables"]] == ["customers", "orders"]
    assert cc["source_table"] == "customers" and cc["storage_uri"] == "s3://b/gold/customers/"
    assert [x["name"] for x in schema["tables"]] == ["customers", "orders"]
    assert total == 170


def test_pre_merge_gold_source_keeps_the_table_it_described():
    from src.modules.pipeline.load.stage import merge_gold_table

    legacy = {"storage_uri": "s3://b/old/", "source_table": "order_items", "lake_object_id": "lo-1"}
    cc, _, _ = merge_gold_table(legacy, {"tables": []}, {
        "name": "orders", "storage_uri": "s3://b/orders/", "row_count": 5, "lake_object_id": "lo-2", "columns": []})
    assert [x["name"] for x in cc["lakehouse_tables"]] == ["order_items", "orders"]
    assert cc["source_table"] == "order_items"
