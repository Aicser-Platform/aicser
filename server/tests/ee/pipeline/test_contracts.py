"""Data contracts: certify as-is, then check each new version against the promise."""

from datetime import datetime, timedelta, timezone

from src.modules.pipeline.catalog.contracts import breaches, contract_columns
from src.shared.contract_rules import breaking_changes, type_family

SNAPSHOT = {"columns": [
    {"name": "order_id", "type": "BIGINT"},
    {"name": "amount", "type": "DOUBLE"},
    {"name": "placed_at", "type": "timestamp[us, tz=UTC]"},
    {"name": "_ingested_at", "type": "timestamp[us, tz=UTC]"},
]}
NOW = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)


def test_duckdb_and_arrow_spellings_share_a_family():
    assert type_family("BIGINT") == type_family("int64") == "number"
    assert type_family("VARCHAR") == type_family("string") == "text"
    assert type_family("timestamp[us, tz=UTC]") == type_family("TIMESTAMP WITH TIME ZONE") == "timestamp"
    assert type_family("date32[day]") == "date" and type_family("bool") == "boolean"


def test_certifying_promises_every_current_column_but_not_audit_ones():
    cols = contract_columns(SNAPSHOT)
    assert [c["name"] for c in cols] == ["order_id", "amount", "placed_at"]
    assert all(c["required"] for c in cols)


def test_a_table_that_keeps_its_promise_has_no_breaches():
    promised = contract_columns(SNAPSHOT)
    assert breaches(promised, SNAPSHOT, row_count=500, created_at=NOW - timedelta(hours=2),
                    min_rows=100, freshness_hours=24, now=NOW) == []


def test_each_broken_promise_is_named():
    promised = contract_columns(SNAPSHOT)
    newer = {"columns": [{"name": "order_id", "type": "VARCHAR"}, {"name": "placed_at", "type": "TIMESTAMP"}]}
    found = breaches(promised, newer, row_count=12, created_at=NOW - timedelta(hours=30),
                     min_rows=100, freshness_hours=24, now=NOW)
    codes = {(b["code"], b.get("column")) for b in found}
    assert ("missing_column", "amount") in codes
    assert ("type_changed", "order_id") in codes
    assert ("too_few_rows", None) in codes and ("stale", None) in codes


def test_optional_columns_may_go_away():
    promised = [{"name": "notes", "type": "text", "required": False}]
    assert breaches(promised, {"columns": []}, row_count=None, created_at=None, min_rows=None, freshness_hours=None) == []


def test_a_draft_that_drops_or_retypes_a_promised_column_is_caught_before_publishing():
    promised = contract_columns(SNAPSHOT)
    broken = breaking_changes(promised, removed=["amount", "scratch"], retyped=[
        {"column": "order_id", "from": "BIGINT", "to": "VARCHAR"},
        {"column": "placed_at", "from": "TIMESTAMP", "to": "TIMESTAMP WITH TIME ZONE"},
    ])
    assert broken == [
        {"code": "missing_column", "column": "amount"},
        {"code": "type_changed", "column": "order_id", "expected": "number", "actual": "text"},
    ]
