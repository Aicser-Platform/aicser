"""Row/column policies on a multi-sheet upload hold for its physical sheet table names.

The AI is shown ``sheet_0_customers`` while policies name ``customers``; a query
using the physical name must still be masked and filtered, not refused.
"""

from types import SimpleNamespace

import pytest

from src.modules.data.services.multi_engine_query_service import file_table_aliases

WORKBOOK = {
    "type": "file",
    "schema": {
        "duckdb_tables": {"customers": "sheet_0_customers", "orders": "sheet_2_orders"},
        "tables": [
            {"name": "customers", "columns": [{"name": "customer_id", "type": "VARCHAR"}, {"name": "email", "type": "VARCHAR"}]},
        ],
    },
}


def test_file_table_aliases_map_physical_to_policy_names():
    assert file_table_aliases(WORKBOOK) == {"sheet_0_customers": "customers", "sheet_2_orders": "orders"}
    assert file_table_aliases({"type": "postgres", "schema": WORKBOOK["schema"]}) == {}
    assert file_table_aliases({"type": "file", "schema": {}}) == {}


@pytest.mark.asyncio
async def test_column_mask_applies_to_physical_sheet_name(monkeypatch):
    from ee.modules.data.services import data_source_cls_enforcement_service as cls_mod
    from ee.modules.data.services.cls_rule_resolver import ColumnDecision

    service = cls_mod.DataSourceCLSEnforcementService

    async def decisions(**_kwargs):
        return {("customers", "email"): ColumnDecision(action="mask", strategy="fixed", config={"value": "***MASKED***"})}

    async def no_origins(*_args, **_kwargs):
        return []

    async def get_source(_id, session=None):
        return SimpleNamespace(schema=WORKBOOK["schema"])

    monkeypatch.setattr(service, "_decisions_for", staticmethod(decisions))
    monkeypatch.setattr("ee.modules.data.services.policy_lineage.origins_for", no_origins)
    monkeypatch.setattr(cls_mod.DataSourceAccessService, "get_data_source", staticmethod(get_source))

    sql, _ = await service.apply_sql_cls(
        'SELECT "customer_id", "email" FROM "sheet_0_customers" LIMIT 2',
        user_id="u",
        data_source_id="ds",
        organization_id=None,
        project_id=None,
        session=None,
        dialect="duckdb",
        table_name_aliases=file_table_aliases(WORKBOOK),
    )

    assert '"sheet_0_customers"."email"' not in sql
    assert "***MASKED***" in sql and "customer_id" in sql
