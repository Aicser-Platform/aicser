"""Policies follow the data: what a pipeline built from a source (a Gold source, Gold tables in the
Warehouse) is governed by that source's access, row filters and column rules."""

import os

import pytest

os.environ["DEBUG"] = "false"
import src.db.registry  # noqa: F401

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")
from ee.modules.data.services import policy_lineage
from ee.modules.data.services.cls_rule_resolver import ColumnDecision
from ee.modules.data.services.data_source_cls_enforcement_service import DataSourceCLSEnforcementService
from ee.modules.data.services.data_source_rls_enforcement_service import DataSourceRLSEnforcementService
from ee.modules.data.services.policy_lineage import Origin, merge_predicates, relabel_tables, table_keys
from src.modules.data.services.data_source_access_service import DataSourceAccessService
from src.modules.data.services.query_identity import RowSecurityDenied

KW = dict(user_id="u1", organization_id="org-1", project_id="p1", token_payload={}, session=None, dialect="duckdb")


def _setup(monkeypatch, *, origins, can_query=True, restrictions=None, decisions=None):
    async def fake_origins(_session, _ds, _query=None):
        return origins

    async def fake_can_query(_user, source_id, **_kw):
        return can_query if isinstance(can_query, bool) else source_id in can_query

    async def fake_restriction(**kw):
        return (restrictions or {}).get(kw["data_source_id"])

    async def fake_decisions(**kw):
        return dict((decisions or {}).get(kw["data_source_id"], {}))

    async def fake_name(_session, _id):
        return "Sales DB"

    monkeypatch.setattr(policy_lineage, "origins_for", fake_origins)
    monkeypatch.setattr(policy_lineage, "origin_name", fake_name)
    monkeypatch.setattr(DataSourceAccessService, "can_query", staticmethod(fake_can_query))
    monkeypatch.setattr(DataSourceRLSEnforcementService, "_restriction_for", staticmethod(fake_restriction))
    monkeypatch.setattr(DataSourceCLSEnforcementService, "_decisions_for", staticmethod(fake_decisions))


@pytest.mark.asyncio
async def test_no_access_to_the_origin_means_no_access_to_the_copy(monkeypatch):
    _setup(monkeypatch, origins=[Origin("sales-db")], can_query=False)
    with pytest.raises(RowSecurityDenied, match="Sales DB"):
        await DataSourceRLSEnforcementService.apply_sql_rls("SELECT * FROM orders", data_source_id="gold-1", **KW)
    with pytest.raises(RowSecurityDenied, match="Sales DB"):
        await DataSourceCLSEnforcementService.apply_sql_cls(
            "SELECT * FROM orders", user_id="u1", data_source_id="gold-1", organization_id="org-1",
            project_id="p1", session=None, dialect="duckdb",
        )


@pytest.mark.asyncio
async def test_the_origins_row_filter_applies_to_the_gold_copy(monkeypatch):
    _setup(monkeypatch, origins=[Origin("sales-db")], restrictions={"sales-db": ({"public.orders": "region = 'APAC'"}, False)})
    sql, applied = await DataSourceRLSEnforcementService.apply_sql_rls("SELECT * FROM orders", data_source_id="gold-1", **KW)
    assert applied and "region = 'APAC'" in sql


@pytest.mark.asyncio
async def test_the_copys_own_filter_and_the_origins_both_hold(monkeypatch):
    _setup(monkeypatch, origins=[Origin("sales-db")], restrictions={
        "gold-1": ({"orders": "amount < 100"}, False),
        "sales-db": ({"orders": "region = 'APAC'"}, False),
    })
    sql, applied = await DataSourceRLSEnforcementService.apply_sql_rls("SELECT * FROM orders", data_source_id="gold-1", **KW)
    assert applied and "region = 'APAC'" in sql and "amount < 100" in sql


@pytest.mark.asyncio
async def test_an_unrestricted_origin_adds_nothing(monkeypatch):
    _setup(monkeypatch, origins=[Origin("sales-db")], restrictions={})
    sql, applied = await DataSourceRLSEnforcementService.apply_sql_rls("SELECT * FROM orders", data_source_id="gold-1", **KW)
    assert (sql, applied) == ("SELECT * FROM orders", False)


@pytest.mark.asyncio
async def test_in_the_warehouse_a_filter_lands_on_that_origins_tables_only(monkeypatch):
    # The warehouse names the Gold table built from sales-db's public.orders "sales_orders";
    # hr-db's "people" table is untouched by sales-db's default-deny.
    _setup(monkeypatch, origins=[Origin("sales-db", {"public.orders": ["sales_orders"], "public.refunds": ["sales_refunds"]})],
           restrictions={"sales-db": ({"public.orders": "region = 'APAC'"}, True)})
    sql, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM sales_orders JOIN sales_refunds USING (id) JOIN people USING (id)", data_source_id="wh-1", **KW
    )
    assert applied
    assert "region = 'APAC'" in sql and "1 = 0" in sql  # refunds: ungoverned table of a default-deny origin
    assert sql.lower().count("people") == 1  # not wrapped in a filter


@pytest.mark.asyncio
async def test_the_origins_column_rules_carry_to_the_warehouse_name(monkeypatch):
    captured = {}

    def fake_apply(query, decisions, schema, dialect):
        captured.update(decisions)
        return query, []

    import ee.modules.data.services.data_source_cls_enforcement_service as cls_mod

    monkeypatch.setattr(cls_mod, "apply_column_security", fake_apply)

    async def no_row(*_a, **_k):
        return None

    monkeypatch.setattr(DataSourceAccessService, "get_data_source", staticmethod(no_row))
    _setup(monkeypatch, origins=[Origin("sales-db", {"orders": ["sales_orders"]})],
           decisions={"sales-db": {("orders", "email"): ColumnDecision("mask", "hash")}})
    await DataSourceCLSEnforcementService.apply_sql_cls(
        "SELECT email FROM sales_orders", user_id="u1", data_source_id="wh-1", organization_id="org-1",
        project_id="p1", session=None, dialect="duckdb",
    )
    assert captured == {("sales_orders", "email"): ColumnDecision("mask", "hash")}


def test_names_and_merging():
    assert table_keys("Sales.Orders") == ["sales.orders", "orders", "sales_orders"]
    assert relabel_tables({"orders": "a", "*": "b"}, Origin("x", {"orders": ["o"], "other": ["p"]})) == {"o": "a", "p": "b"}
    assert relabel_tables({"public.orders": "a"}, Origin("x")) == {"public.orders": "a", "orders": "a", "public_orders": "a"}
    merged, deny = merge_predicates([None, ({"t": "a"}, False), ({"t": "b"}, True)])
    assert merged == {"t": "(a) AND (b)"} and deny is True
    assert merge_predicates([None, None]) is None
