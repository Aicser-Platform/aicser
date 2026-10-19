"""Data leaving the platform keeps the source's controls: column rules travel with it, and a
source with row policies can be exported only with a manager's approval."""

import asyncio
import os

import pyarrow as pa
import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")


def _table():
    return pa.table({"id": [1, 2], "email": ["ann@x.io", "bob@y.io"], "card": ["4111111111111111", "5500000000000004"], "salary": [10, 20]})


def test_column_rules_mask_and_drop_in_the_export():
    from ee.modules.data.services.cls_rule_resolver import ColumnDecision
    from src.modules.pipeline.export_governance import apply_column_rules

    decisions = {
        ("public.customers", "email"): ColumnDecision("mask", "hash"),
        ("customers", "card"): ColumnDecision("mask", "partial", {"keep": 4}),
        ("customers", "salary"): ColumnDecision("deny"),
        ("other_table", "id"): ColumnDecision("deny"),
    }
    out, changed = apply_column_rules(_table(), decisions, "public.customers")
    assert out.column_names == ["id", "email", "card"]
    assert out.column("id").to_pylist() == [1, 2]  # another table's rule doesn't touch this one
    assert all(len(v) == 64 and "@" not in v for v in out.column("email").to_pylist())  # sha256 hex
    assert out.column("card").to_pylist() == ["****1111", "****0004"]
    assert sorted(changed) == ["card masked (partial)", "email masked (hash)", "salary left out"]


def test_no_rules_means_the_table_goes_as_it_is():
    from src.modules.pipeline.export_governance import apply_column_rules

    table = _table()
    assert apply_column_rules(table, {}, "customers") == (table, [])


def _ctx(options):
    return type("Ctx", (), {"session": None, "pipeline": type("P", (), {"options": options})()})()


def test_row_policies_block_an_export_until_a_manager_approves(monkeypatch):
    from src.modules.pipeline import export_governance as eg

    async def controls(_session, _source):
        return {"row_policies": True, "column_decisions": {}}

    monkeypatch.setattr(eg, "source_controls", controls)
    with pytest.raises(eg.ExportNeedsApproval, match="approve"):
        asyncio.run(eg.govern_export(_ctx({}), _table(), origin_id="ds", source_table="customers", destination_type="postgresql"))
    approved = _ctx({"export_approval": {"by": "u1", "at": "2026-10-19T00:00:00Z"}})
    out, changed = asyncio.run(eg.govern_export(approved, _table(), origin_id="ds", source_table="customers", destination_type="postgresql"))
    assert out.num_rows == 2 and changed == []


def test_lake_destinations_stay_governed_at_query_time(monkeypatch):
    from src.modules.pipeline import export_governance as eg

    async def boom(*_a, **_k):
        raise AssertionError("lake loads are governed when read, not rewritten when written")

    monkeypatch.setattr(eg, "source_controls", boom)
    table = _table()
    assert asyncio.run(eg.govern_export(_ctx({}), table, origin_id="ds", source_table="t", destination_type="s3_iceberg")) == (table, [])
    assert eg.is_export("google_sheets") and eg.is_export("mysql") and not eg.is_export(None)
