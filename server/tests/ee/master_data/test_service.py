"""An entity's sources are read through the governed path and matched as one table."""

from types import SimpleNamespace

import pytest

from ee.modules.master_data import service
from src.modules.data.services.governed_sql import Caller

CALLER = Caller(user_id="u1", organization_id="o1", project_id="p1", payload={})

ENTITY = SimpleNamespace(
    name="Customer",
    sources=[
        {"data_source_id": "crm", "table": "contacts", "key_column": "id", "label": "CRM",
         "mapping": {"name": "full_name", "email": "email"}},
        {"data_source_id": "shop", "table": "buyers", "key_column": "buyer_id", "label": "Shop",
         "mapping": {"name": "buyer", "email": "mail", "phone": "tel"}},
    ],
    rules=[{"attributes": ["email"], "method": "exact"}],
    survivorship={"default": "most_complete"},
    decisions=[],
)


@pytest.mark.asyncio
async def test_preview_reads_each_source_and_merges_on_email(monkeypatch):
    queries = []

    async def fake_source(caller, ds_id):
        return {"id": ds_id, "name": ds_id, "type": "database", "schema": {"tables": [{"name": "contacts"}, {"name": "buyers"}]}}

    async def fake_sql(caller, source, sql):
        queries.append(sql)
        if source["id"] == "crm":
            return {"columns": ["_record_id", "_updated_at", "name", "email", "phone"],
                    "rows": [{"_record_id": "1", "_updated_at": None, "name": "Sok Dara", "email": "dara@acme.com", "phone": None}]}
        return {"columns": ["_record_id", "_updated_at", "name", "email", "phone"],
                "rows": [{"_record_id": "B1", "_updated_at": None, "name": "S. Dara", "email": "DARA@acme.com", "phone": "012 345 678"}]}

    monkeypatch.setattr(service, "load_source_for", fake_source)
    monkeypatch.setattr(service, "run_sql", fake_sql)
    out = await service.preview(CALLER, ENTITY)
    assert out["stats"] == {"records": 2, "masters": 1, "merged_records": 1, "to_review": 0}
    golden = out["examples"][0]
    assert golden["name"] == "Sok Dara" and golden["phone"] == "012 345 678"
    # Attributes a source doesn't have are read as empty, not left out.
    assert 'CAST(NULL AS VARCHAR) AS "phone"' in queries[0]
    assert all("LIMIT 5000" in q for q in queries)


@pytest.mark.asyncio
async def test_a_second_run_updates_the_same_datasets(monkeypatch):
    async def fake_source(caller, ds_id):
        return {"id": ds_id, "name": ds_id, "type": "database", "schema": {"tables": [{"name": "contacts"}, {"name": "buyers"}]}}

    async def fake_sql(caller, source, sql):
        return {"columns": ["_record_id", "_updated_at", "name", "email", "phone"],
                "rows": [{"_record_id": source["id"], "_updated_at": None, "name": "Sok Dara", "email": "dara@acme.com", "phone": None}]}

    saved, refreshed = [], []

    async def fake_save(caller, table, name):
        saved.append(name)
        return {"id": f"new-{len(saved)}"}

    async def fake_refresh(ds_id, table, *, organization_id, user_id):
        refreshed.append(ds_id)
        return {}

    import src.modules.data.services.dataset_writer as writer
    import src.modules.prep.service as prep

    monkeypatch.setattr(service, "load_source_for", fake_source)
    monkeypatch.setattr(service, "run_sql", fake_sql)
    monkeypatch.setattr(prep, "save_arrow_as_connection", fake_save)
    monkeypatch.setattr(writer, "refresh_dataset", fake_refresh)

    first = await service.run(CALLER, SimpleNamespace(**{**vars(ENTITY), "output": {}}))
    assert saved == ["Customer (master)", "Customer (crosswalk)"] and refreshed == []
    second = await service.run(CALLER, SimpleNamespace(**{**vars(ENTITY), "output": first}))
    assert refreshed == [first["golden_data_source_id"], first["crosswalk_data_source_id"]]
    assert len(saved) == 2  # nothing new created
    assert second["golden_data_source_id"] == first["golden_data_source_id"]


@pytest.mark.asyncio
async def test_records_come_with_the_source_records_merged_into_them(monkeypatch):
    async def fake_source(caller, ds_id):
        return {"id": ds_id, "type": "file"}

    async def fake_sql(caller, source, sql):
        if source["id"] == "golden":
            if "count(*)" in sql:
                return {"columns": ["n"], "rows": [{"n": 1}]}
            assert "LIKE '%dara%'" in sql
            return {"columns": ["master_id", "name", "source_records"], "rows": [{"master_id": "m1", "name": "Sok Dara", "source_records": 2}]}
        return {"columns": ["master_id", "source", "record_id"],
                "rows": [{"master_id": "m1", "source": "CRM", "record_id": "1"}, {"master_id": "m1", "source": "Shop", "record_id": "B1"}]}

    monkeypatch.setattr(service, "load_source_for", fake_source)
    monkeypatch.setattr(service, "run_sql", fake_sql)
    entity = SimpleNamespace(**{**vars(ENTITY), "output": {"golden_data_source_id": "golden", "crosswalk_data_source_id": "cw"}})
    out = await service.records(CALLER, entity, "Dara")
    assert out["total"] == 1
    assert [m["source"] for m in out["records"][0]["members"]] == ["CRM", "Shop"]
