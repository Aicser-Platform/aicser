"""Iceberg snapshot expiry: old history and its files go; the current table and refs stay."""

import os

import pytest

pa = pytest.importorskip("pyarrow")
pytest.importorskip("pyiceberg")

from pyiceberg.catalog.sql import SqlCatalog  # noqa: E402
from pyiceberg.expressions import EqualTo  # noqa: E402

from src.modules.pipeline.snapshot_retention import DAY_MS, expire_by_retention, expire_snapshots  # noqa: E402


def _files(root):
    return {os.path.join(d, f) for d, _, fs in os.walk(root) for f in fs if f.endswith((".parquet", ".avro"))}


@pytest.fixture
def table(tmp_path):
    catalog = SqlCatalog("t", uri=f"sqlite:///{tmp_path}/c.db", warehouse=f"file://{tmp_path}")
    catalog.create_namespace("n")
    t = catalog.create_table("n.people", schema=pa.schema([("email", pa.string()), ("v", pa.int64())]))
    t.append(pa.table({"email": ["dara@acme.com", "lin@acme.com"], "v": [1, 2]}))
    t.append(pa.table({"email": ["sok@acme.com"], "v": [3]}))
    return catalog, tmp_path


def test_erasure_expiry_removes_the_person_from_history(table):
    catalog, root = table
    t = catalog.load_table("n.people")
    first = t.metadata.snapshots[0].snapshot_id
    t.delete(EqualTo("email", "dara@acme.com"))
    t = catalog.load_table("n.people")
    # Before expiry, time travel still finds the person.
    assert "dara@acme.com" in t.scan(snapshot_id=first).to_arrow()["email"].to_pylist()

    result = expire_snapshots(t)
    t = catalog.load_table("n.people")
    assert result["expired"] == 2 and result["files_deleted"] > 0
    assert [s.snapshot_id for s in t.metadata.snapshots] == [t.metadata.current_snapshot_id]
    assert sorted(t.scan().to_arrow()["email"].to_pylist()) == ["lin@acme.com", "sok@acme.com"]
    # No data file on disk still holds the person.
    for path in _files(root):
        if path.endswith(".parquet"):
            assert "dara@acme.com" not in pa.parquet.read_table(path)["email"].to_pylist()


def test_retention_keeps_recent_history_and_tags(table):
    catalog, _ = table
    catalog.load_table("n.people").append(pa.table({"email": ["mey@acme.com"], "v": [4]}))
    t = catalog.load_table("n.people")
    newest = max(s.timestamp_ms for s in t.metadata.snapshots)
    # Everything is younger than a day: nothing expires.
    assert expire_by_retention(t, 1, now_ms=newest + 1000)["expired"] == 0
    # Ten days later the middle snapshot goes; the tagged one and the current one stay.
    tagged = catalog.load_table("n.people")
    oldest = min(tagged.metadata.snapshots, key=lambda s: s.timestamp_ms).snapshot_id
    tagged.manage_snapshots().create_tag(oldest, "audit-2026").commit()
    result = expire_by_retention(catalog.load_table("n.people"), 1, now_ms=newest + 10 * DAY_MS)
    t = catalog.load_table("n.people")
    assert result["expired"] == 1
    assert {s.snapshot_id for s in t.metadata.snapshots} == {oldest, t.metadata.current_snapshot_id}
    assert t.scan().to_arrow().num_rows == 4
    assert t.scan(snapshot_id=oldest).to_arrow().num_rows == 2
