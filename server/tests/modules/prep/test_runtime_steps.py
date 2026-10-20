"""Prediction and AI answer steps: rows so far go to Python, the new columns come back, and
later SQL steps carry on over them."""

import pyarrow as pa
import pytest

from src.modules.data.services.governed_sql import Caller
from src.modules.prep import service
from src.modules.prep.engine import runtime
from src.modules.prep.engine.compiler import compile_steps
from src.modules.prep.schemas import PreviewRequest

CALLER = Caller(user_id="u1", organization_id="o1", project_id="p1", payload={})
ROWS = {"columns": ["id", "note"], "rows": [{"id": 1, "note": "refund please"}, {"id": 2, "note": "thanks"},
                                            {"id": 3, "note": "refund now"}]}


@pytest.fixture(autouse=True)
def governed(monkeypatch):
    async def fake_load(caller, data_source_id):
        return {"id": data_source_id, "type": "file"}

    async def fake_run(caller, source, sql):
        return ROWS

    monkeypatch.setattr(service, "load_source_for", fake_load)
    monkeypatch.setattr(service, "run_sql", fake_run)


@pytest.fixture
def ai(monkeypatch):
    seen = []

    async def answer(caller, payload, rows, *, dry=False):
        seen.append((rows.num_rows, dry))
        notes = rows.column("note").to_pylist()
        return runtime.append_columns(rows, {"refund": [None if dry else ("yes" if "refund" in n else "no") for n in notes]})

    monkeypatch.setattr(runtime, "_enricher", lambda kind: answer)
    return seen


def test_the_step_reads_the_table_the_runner_fills():
    sql = compile_steps([{"filter": {"where": "id > 0"}}, {"ai_answer": {"decision_id": "d", "columns": ["note"]}}],
                        source_sql="SELECT 1").sql
    assert 's2 AS (SELECT * FROM "_rt2")' in sql
    assert runtime.has_runtime_steps([{"predict": {"model_id": "m"}}])
    assert not runtime.has_runtime_steps([{"predict": {"model_id": "m", "disabled": True}}])


def test_an_ai_step_needs_columns_to_read():
    with pytest.raises(ValueError):
        compile_steps([{"ai_answer": {"decision_id": "d", "columns": []}}], source_sql="SELECT 1")


@pytest.mark.asyncio
async def test_preview_runs_earlier_steps_then_the_ai_then_later_sql(ai):
    req = PreviewRequest(data_source_id="ds", steps=[
        {"filter": {"where": "id < 3"}},
        {"ai_answer": {"decision_id": "d", "columns": ["note"]}},
        {"filter": {"where": "refund = 'yes'"}},
    ])
    out = await service.preview(CALLER, req)
    assert out["step_errors"] == []
    assert [r["id"] for r in out["rows"]] == [1]
    assert ai == [(2, False)]  # only the rows left after step 1 were asked


@pytest.mark.asyncio
async def test_a_failing_ai_step_is_reported_on_that_step(monkeypatch):
    async def broken(caller, payload, rows, *, dry=False):
        raise ValueError("That AI decision isn't available.")

    monkeypatch.setattr(runtime, "_enricher", lambda kind: broken)
    req = PreviewRequest(data_source_id="ds", steps=[{"select": {"columns": ["id", "note"]}},
                                                      {"predict": {"model_id": "m"}}])
    out = await service.preview(CALLER, req)
    assert out["step_errors"] == [{"step": 1, "message": "That AI decision isn't available."}]


def test_new_columns_never_overwrite_existing_ones():
    t = pa.table({"refund": [1]})
    assert runtime.append_columns(t, {"refund": ["yes"]}).column_names == ["refund", "refund_2"]


@pytest.mark.asyncio
async def test_an_ai_step_runs_in_the_connections_organization(monkeypatch):
    """A sign-in token without an organization still finds the org's models and decisions."""
    seen = {}

    async def fake_load(caller, data_source_id):
        return {"id": data_source_id, "type": "file", "organization_id": "org-of-source"}

    async def answer(caller, payload, rows, *, dry=False):
        seen["org"] = caller.organization_id
        return runtime.append_columns(rows, {"x": [None] * rows.num_rows})

    async def fake_resolve(caller, db, requested=None):
        caller.organization_id = requested
        return caller

    import src.modules.data.services.governed_sql as governed

    monkeypatch.setattr(service, "load_source_for", fake_load)
    monkeypatch.setattr(governed, "resolve_organization", fake_resolve)
    monkeypatch.setattr(runtime, "_enricher", lambda kind: answer)
    no_org = Caller(user_id="u1", organization_id=None, project_id="p1", payload={})
    out = await service.preview(no_org, PreviewRequest(data_source_id="ds", steps=[{"predict": {"model_id": "m"}}]))
    assert out["step_errors"] == []
    assert seen["org"] == "org-of-source"
    assert no_org.organization_id is None  # the caller passed in is left as it was
