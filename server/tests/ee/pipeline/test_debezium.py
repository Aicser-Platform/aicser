import os

os.environ.setdefault("AISER_EDITION", "enterprise")

from src.modules.pipeline.ingest.debezium import normalize_debezium_event


def test_normalize_debezium_delete_uses_before():
    raw = {
        "payload": {
            "op": "d",
            "before": {"id": 1, "name": "gone"},
            "after": None,
            "source": {"table": "orders", "lsn": 9912, "ts_ms": 1_700_000_000_000},
        }
    }
    ev = normalize_debezium_event(raw)
    assert ev.stream_name == "orders"
    assert ev.op == "d"
    assert ev.row == {"id": 1, "name": "gone"}
    assert ev.source_offset == "9912"


def test_normalize_flat_create():
    raw = {
        "op": "c",
        "after": {"id": 2},
        "source": {"table": "customers", "pos": 44},
    }
    ev = normalize_debezium_event(raw)
    assert ev.op == "c"
    assert ev.row == {"id": 2}
