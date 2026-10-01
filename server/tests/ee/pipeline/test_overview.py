"""Pipeline detail overview: status, per-table medallion state, stats, semantic."""

import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("AISER_EDITION", "enterprise")

T0 = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _run(status, minutes_ago=0, duration=60, checkpoint=None):
    start = T0 - timedelta(minutes=minutes_ago)
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        started_at=start,
        finished_at=start + timedelta(seconds=duration) if status in ("succeeded", "failed") else None,
        checkpoint=checkpoint or {},
    )


def _obj(table, layer, rows, minutes_ago=0, status="active"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        source_table=table,
        layer=layer,
        row_count=rows,
        byte_size=1024,
        format="parquet" if layer == "bronze" else "iceberg",
        storage_uri=f"s3://b/{layer}/{table}",
        created_at=T0 - timedelta(minutes=minutes_ago),
        created_by_job_id=None,
        schema_snapshot={"columns": [{"name": "a"}, {"name": "b"}]},
        status=status,
    )


def test_status_lifecycle():
    from src.modules.pipeline.overview import derive_status

    bronze_only = _run("succeeded", checkpoint={"stop_after": "ingest"})
    assert derive_status(False, [bronze_only]) == "draft"
    assert derive_status(False, [_run("succeeded")]) == "paused"
    assert derive_status(True, []) == "never_run"
    assert derive_status(True, [_run("running")]) == "running"
    assert derive_status(True, [_run("failed"), _run("succeeded", 10)]) == "failing"
    assert derive_status(True, [_run("succeeded")]) == "healthy"


def test_tables_use_the_newest_active_object_per_layer():
    from src.modules.pipeline.overview import build_tables

    sheets = [SimpleNamespace(source_table="orders", watermark_column="order_date"),
              SimpleNamespace(source_table="customers", watermark_column=None)]
    objects = [
        _obj("orders", "bronze", 100, minutes_ago=60),
        _obj("orders", "bronze", 120, minutes_ago=5),
        _obj("orders", "silver", 118, minutes_ago=4),
        _obj("orders", "silver", 999, minutes_ago=1, status="archived"),
        _obj("customers", "bronze", 50),
    ]
    latest = _run("failed", checkpoint={"sheets": {
        "orders": {"status": "succeeded", "rows_written": 118, "checkpoint": {"stage": "load"}},
        "customers": {"status": "failed", "error_message": "cast error", "checkpoint": {"stage": "ingest"}},
    }})
    tables = build_tables(sheets, {"orders": "version: 1", "customers": None}, objects, latest)

    orders, customers = tables
    assert orders.bronze.row_count == 120
    assert orders.silver.row_count == 118
    assert orders.silver.column_count == 2
    assert orders.has_transform is True and customers.has_transform is False
    assert customers.silver is None
    assert (customers.last_status, customers.last_error) == ("failed", "cast error")


def test_run_stats_over_finished_runs():
    from src.modules.pipeline.overview import run_stats

    runs = [_run("running"), _run("succeeded", 5, 30), _run("failed", 10, 90), _run("succeeded", 20, 60)]
    stats = run_stats(runs)
    assert stats.runs_total == 4
    assert (stats.succeeded, stats.failed) == (2, 1)
    assert abs(stats.success_rate - 2 / 3) < 1e-9
    assert stats.avg_duration_seconds == 60
    assert stats.last_success_at == runs[1].finished_at


def test_semantic_block_comes_from_the_fact_table_yaml():
    from src.modules.pipeline.overview import semantic_block

    body = 'version: 1\nsemantic:\n  fact_table: "orders"\n  time_grain: day\n  metrics: [{"name": "rev", "type": "sum", "column": "total"}]\n'
    block = semantic_block({"customers": "version: 1\n", "orders": body, "bad": ": : :"})
    assert block["fact_table"] == "orders"
    assert block["metrics"][0]["name"] == "rev"
    assert semantic_block({"orders": "version: 1\n"}) is None


def test_registry_metrics_back_the_semantic_tab_when_yaml_has_none():
    from src.modules.pipeline.overview import registry_semantic

    block = registry_semantic([
        {"name": "total_revenue", "expression": "SUM(total_amount)", "tags": '["certified"]', "certified": False},
        {"name": "orders", "expression": "COUNT(order_id)", "tags": None, "certified": True},
    ])
    assert [m["name"] for m in block["metrics"]] == ["total_revenue", "orders"]
    assert block["metrics"][0]["expression"] == "SUM(total_amount)"
    assert all(m["certified"] for m in block["metrics"])
    assert registry_semantic([]) is None
