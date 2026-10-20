"""A warehouse lists Gold tables from many sources; each person sees only those built from
sources they may query (and tables without an origin, e.g. the warehouse's own)."""

import asyncio


def test_tables_from_sources_you_cant_query_are_hidden(monkeypatch):
    from src.modules.data import router
    from src.modules.data.services.data_source_access_service import DataSourceAccessService

    asked = []

    async def can_query(user_id, source_id, **_kw):
        asked.append(source_id)
        return source_id == "sales-db"

    monkeypatch.setattr(DataSourceAccessService, "can_query", staticmethod(can_query))
    schema = {"tables": [
        {"name": "sales_orders", "origin_data_source_id": "sales-db"},
        {"name": "sales_refunds", "origin_data_source_id": "sales-db"},
        {"name": "hr_people", "origin_data_source_id": "hr-db"},
        {"name": "calendar"},
    ]}
    out = asyncio.run(router._visible_tables(schema, {"sub": "u1"}))
    assert [t["name"] for t in out["tables"]] == ["sales_orders", "sales_refunds", "calendar"]
    assert asked == ["sales-db", "hr-db"]  # one check per source
