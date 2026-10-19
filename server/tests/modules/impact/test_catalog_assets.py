"""Business catalog search: tables come from each connection's stored schema, and results rank
exact names, then certified, then recent."""

from ee.modules.catalog import assets


def test_files_are_one_table_and_databases_list_theirs():
    assert assets._tables_of({"columns": [{"name": "a"}]}, "file") == [{"name": "data", "columns": [{"name": "a"}]}]
    assert assets._tables_of({"tables": [{"name": "orders"}, {"x": 1}]}, "postgresql") == [{"name": "orders"}]
    assert assets._tables_of(None, "file") == []


def test_ranking_prefers_exact_names_then_certified_then_recent():
    a = assets._item("metric", 1, "Net revenue", href="/", updated_at="2026-10-01T00:00:00")
    b = assets._item("metric", 2, "revenue", href="/", updated_at="2026-01-01T00:00:00")
    c = assets._item("table", 3, "revenue_daily", href="/", certified=True, updated_at="2026-01-01T00:00:00")
    d = assets._item("table", 4, "revenue_monthly", href="/", updated_at="2026-10-01T00:00:00")
    ranked = sorted([a, d, c, b], key=lambda it: assets._rank(it, "revenue"))
    assert [it["id"] for it in ranked] == ["2", "3", "4", "1"]


import pytest


@pytest.mark.asyncio
async def test_lineage_names_only_connections_the_caller_can_open(monkeypatch):
    from src.modules.data.services.governed_sql import Caller

    caller = Caller(user_id="u1", organization_id="o1", project_id="p1", payload={})

    async def fake_rows(db, sql, params):
        if "FROM prep_recipes" in sql:
            return [("r1", "Clean orders", "src-ok"), ("r2", "Secret prep", "src-hidden")]
        if "FROM data_sources WHERE id = ANY" in sql:
            return [("src-ok", "Orders DB"), ("src-hidden", "HR DB")]
        return []

    class Access:
        @staticmethod
        async def list_accessible_source_ids(*a, **k):
            return ["src-ok"]

    async def no_dependents(db, caller, kind, ref):
        class I:
            def as_dict(self):
                return {"items": [{"kind": "chart", "id": "c1", "name": "Orders by day"}], "hidden": 0}
        return I()

    import src.modules.data.services.data_source_access_service as access
    import src.modules.impact.service as impact

    monkeypatch.setattr(assets, "_rows", fake_rows)
    monkeypatch.setattr(access, "DataSourceAccessService", Access)
    monkeypatch.setattr(impact, "dependents", no_dependents)
    out = await assets.lineage(None, caller, "data_source", "ds-saved")
    names = [(n["kind"], n["name"]) for n in out["upstream"]]
    assert ("data_source", "Orders DB") in names and ("data_source", "HR DB") not in names
    assert out["upstream_hidden"] == 1
    assert out["downstream"][0]["name"] == "Orders by day"
