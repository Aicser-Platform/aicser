import pytest
from fastapi import HTTPException

from src.modules.data.services.governed_sql import Caller
from src.modules.prep import service
from src.modules.prep.schemas import PreviewRequest, ProfileRequest

CALLER = Caller(user_id="u1", organization_id=None, project_id="p1", payload={})

ROWS = {
    "columns": ["id", "name", "amount"],
    "rows": [
        {"id": 1, "name": " Dara ", "amount": "10"},
        {"id": 2, "name": "N/A", "amount": "20"},
        {"id": 2, "name": "Lina", "amount": None},
    ],
}


@pytest.fixture(autouse=True)
def governed(monkeypatch):
    calls = {}

    async def fake_load(caller, data_source_id):
        calls["source"] = data_source_id
        return {"id": data_source_id, "type": "file"}

    async def fake_run(caller, source, sql):
        calls["sql"] = sql
        return ROWS

    monkeypatch.setattr(service, "load_source_for", fake_load)
    monkeypatch.setattr(service, "run_sql", fake_run)
    return calls


def test_file_sources_read_their_single_table():
    assert service.resolve_table({"type": "file"}, None) == "data"


def test_database_sources_default_to_first_table():
    src = {"type": "database", "schema": {"tables": [{"name": "orders", "schema": "sales"}]}}
    assert service.resolve_table(src, None) == "sales.orders"


def test_database_without_tables_asks_for_one():
    with pytest.raises(HTTPException):
        service.resolve_table({"type": "database", "schema": {}}, None)


def test_catalog_lists_every_step_with_a_schema():
    kinds = {s["kind"] for s in service.step_catalog()}
    assert {"clean", "split", "flatten_json", "mask", "dedupe"} <= kinds
    assert all("properties" in s["schema"] for s in service.step_catalog())


@pytest.mark.asyncio
async def test_preview_reads_through_governed_sql_and_applies_steps(governed):
    req = PreviewRequest(
        data_source_id="ds1",
        steps=[{"clean": {"columns": ["name"], "trim": True, "nulls": ["N/A"]}}, {"dedupe": {"keys": ["id"]}}],
    )
    result = await service.preview(CALLER, req)
    assert governed["source"] == "ds1"
    assert governed["sql"].startswith('SELECT * FROM "data" LIMIT')
    assert result["step_errors"] == []
    assert len(result["rows"]) == 2
    assert {r["name"] for r in result["rows"]} <= {"Dara", None, "Lina"}


@pytest.mark.asyncio
async def test_preview_reports_bad_step_instead_of_failing():
    req = PreviewRequest(data_source_id="ds1", steps=[{"no_such_step": {}}])
    result = await service.preview(CALLER, req)
    assert result["step_errors"][0]["step"] == 0


@pytest.mark.asyncio
async def test_profile_suggests_fixes():
    result = await service.profile(CALLER, ProfileRequest(data_source_id="ds1"))
    assert result["profile"]["row_count"] == 3
    # Three rows is under the sample cap: the stats cover the whole table.
    assert result["profile"]["sampled"] is False and result["sample_rows"] == 3
    assert isinstance(result["health"], int)
    codes = {f["code"] for f in result["findings"]}
    assert "null_tokens" in codes


@pytest.mark.asyncio
async def test_lakehouse_served_file_falls_back_to_its_real_table(monkeypatch):
    async def fake_load(caller, data_source_id):
        return {"id": data_source_id, "type": "file", "schema": {"tables": [{"name": "Sheet1"}]}}

    async def fake_run(caller, source, sql):
        if '"data"' in sql:
            raise HTTPException(status_code=400, detail="Table data does not exist")
        return ROWS

    monkeypatch.setattr(service, "load_source_for", fake_load)
    monkeypatch.setattr(service, "run_sql", fake_run)
    _source, table, sample = await service.load_sample(CALLER, "ds1", None, 10)
    assert table == "Sheet1" and sample.num_rows == 3


@pytest.mark.asyncio
async def test_profile_of_a_failing_step_returns_no_suggestions_instead_of_an_error():
    req = ProfileRequest(data_source_id="ds1", steps=[{"clean": {"columns": ["id"], "trim": True}}])
    result = await service.profile(CALLER, req)
    assert result["findings"] == [] and result["error"]


class _NoDb:
    async def execute(self, *_a, **_k):
        raise RuntimeError("no tables in unit tests")

    async def rollback(self):
        return None


@pytest.mark.asyncio
async def test_impact_lists_dropped_and_retyped_columns():
    from types import SimpleNamespace

    recipe = SimpleNamespace(id="r1", data_source_id="ds1", source_table=None, output={},
                             steps=[{"drop": {"columns": ["name"]}}, {"cast": {"columns": {"amount": "double"}}}])
    result = await service.impact(CALLER, recipe, [], _NoDb())
    assert result["removed"] == ["name"]
    assert result["retyped"][0]["column"] == "amount"
    assert await service.impact(CALLER, recipe, None, _NoDb()) == {
        "removed": [], "retyped": [], "pipelines": [], "saved_table": None, "metrics": [], "contracts": []}


@pytest.mark.asyncio
async def test_merge_and_append_preview_load_the_other_table(monkeypatch):
    async def fake_load(caller, data_source_id):
        return {"id": data_source_id, "type": "database", "schema": {"tables": [{"name": "orders"}]}}

    async def fake_run(caller, source, sql):
        if '"customers"' in sql:
            return {"columns": ["cid", "city"], "rows": [{"cid": 1, "city": "Phnom Penh"}, {"cid": 2, "city": "Siem Reap"}]}
        return {"columns": ["id", "cid"], "rows": [{"id": 10, "cid": 1}, {"id": 11, "cid": 2}, {"id": 12, "cid": 3}]}

    monkeypatch.setattr(service, "load_source_for", fake_load)
    monkeypatch.setattr(service, "run_sql", fake_run)
    req = PreviewRequest(data_source_id="ds1", table="orders",
                         steps=[{"join": {"asset": "customers", "how": "left", "on": {"cid": "cid"}}}])
    result = await service.preview(CALLER, req)
    assert result["step_errors"] == []
    assert [r.get("city") for r in result["rows"]] == ["Phnom Penh", "Siem Reap", None]

    req = PreviewRequest(data_source_id="ds1", table="orders", steps=[{"union": {"asset": "orders"}}])
    assert len((await service.preview(CALLER, req))["rows"]) == 6


def test_preview_engine_cannot_read_server_files():
    import pyarrow as pa
    from src.modules.prep.engine.executor import preview_steps
    from src.modules.prep.service import _connection_over

    conn = _connection_over(pa.table({"a": [1, 2]}))
    ok = preview_steps([{"sql": {"query": "SELECT COUNT(*) AS n FROM {input}"}}], source_sql="SELECT * FROM src", connection=conn)
    assert ok["rows"] == [{"n": 2}]
    for query in ("SELECT * FROM read_text('/etc/passwd'), {input}", "SELECT current_setting('threads') FROM {input}; SET enable_external_access = true"):
        conn = _connection_over(pa.table({"a": [1]}))
        result = preview_steps([{"sql": {"query": query}}], source_sql="SELECT * FROM src", connection=conn)
        assert result["step_errors"], query
