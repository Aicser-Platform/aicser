"""Catalog lineage: real lanes per table, nothing fabricated."""

import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("AISER_EDITION", "enterprise")

T0 = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _obj(table, layer, rows, job_id=None, minutes_ago=0):
    return SimpleNamespace(
        id=uuid.uuid4(), source_table=table, layer=layer, row_count=rows,
        format="parquet" if layer == "bronze" else "iceberg", status="active",
        storage_uri=f"s3://b/{layer}/{table}", created_at=T0 - timedelta(minutes=minutes_ago),
        created_by_job_id=job_id, schema_snapshot={"columns": [{"name": "a"}]},
    )


def test_one_lane_per_table_with_real_durations_and_semantic():
    from src.modules.pipeline.catalog.lineage_builder import build_lineage

    job = SimpleNamespace(id="j1", status="succeeded", started_at=T0, finished_at=T0 + timedelta(seconds=75))
    pipe = SimpleNamespace(id=uuid.uuid4(), name="Sales", target_layer="gold")
    sem_yaml = 'output: {layer: silver, table: orders}\nsemantic: {fact_table: orders, metrics: [{name: rev}]}\n'
    nodes, edges = build_lineage(
        source_name="shop", source_type="postgresql",
        lake_objects=[_obj("orders", "bronze", 10, "j1", 5), _obj("orders", "bronze", 12, "j1", 1),
                      _obj("orders", "silver", 11, "j1"), _obj("customers", "bronze", 4)],
        jobs_by_id={"j1": job},
        table_pipelines={"orders": {"pipeline": pipe, "yaml": sem_yaml},
                         "customers": {"pipeline": pipe, "yaml": "output: {layer: silver, table: customers}"}},
    )
    by_id = {n.id: n for n in nodes}
    assert by_id["node-bronze-orders"].row_count == 12, "newest Bronze wins"
    assert by_id["node-silver-orders"].duration == "1m 15s"
    assert by_id["node-silver-orders"].type_label == "Cleansed table · Iceberg"
    assert "node-gold-orders" not in by_id, "YAML says Silver; no Gold is invented"
    assert by_id["node-silver-customers"].status == "pending"
    assert by_id["node-semantic-orders"].name == "1 metrics"
    assert ("node-silver-orders", "node-semantic-orders") in {(e.source, e.target) for e in edges}


def test_focus_restricts_to_one_table_and_marks_current():
    from src.modules.pipeline.catalog.lineage_builder import build_lineage

    silver = _obj("orders", "silver", 11)
    nodes, _ = build_lineage(
        source_name="shop", source_type="file",
        lake_objects=[_obj("orders", "bronze", 12), silver, _obj("customers", "bronze", 4)],
        jobs_by_id={}, table_pipelines={},
        focus_table="orders", focus_object_id=str(silver.id),
    )
    assert {n.table for n in nodes if n.table} == {"orders"}
    assert [n.id for n in nodes if n.is_current] == ["node-silver-orders"]


def test_untracked_tables_only_show_what_exists():
    from src.modules.pipeline.catalog.lineage_builder import build_lineage

    nodes, edges = build_lineage(
        source_name="s", source_type="file",
        lake_objects=[_obj("sheet1", "bronze", 3)], jobs_by_id={}, table_pipelines={},
    )
    assert [n.layer for n in nodes] == ["raw", "bronze"]
    assert nodes[1].duration is None, "no job, no made-up duration"
    assert len(edges) == 1
