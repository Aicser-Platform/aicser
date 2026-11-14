"""Recipe tools never guess the table, report failed steps as failures, and file drafts where the person works.

From a real run: previews without a table ran on the source's first table (accounts, not loans), each came
back as "0 rows", and the draft was saved on accounts in the data source's project.
"""

import sys
import types
import uuid

import pytest

from ee.modules.ai import governed_tools as T
from src.core.tool_registry import ToolCaller, ToolError

TWO_TABLES = {"id": "ds", "project_id": str(uuid.uuid4()),
              "schema": {"tables": [{"name": "accounts"}, {"name": "loans"}]}}


def _fake_service(monkeypatch, **fns):
    """Stand-in for src.modules.prep.service (the real one loads pyarrow), resolving tables as it does."""
    import src.modules.prep as prep

    fake = types.SimpleNamespace(resolve_table=lambda source, table: table or "accounts", **fns)
    monkeypatch.setitem(sys.modules, "src.modules.prep.service", fake)
    monkeypatch.setattr(prep, "service", fake, raising=False)


def _caller(project_id=None):
    return ToolCaller(user_id=str(uuid.uuid4()), organization_id=str(uuid.uuid4()), project_id=project_id)


def test_a_source_with_several_tables_must_name_one():
    with pytest.raises(ToolError, match="accounts, loans"):
        T._recipe_table(TWO_TABLES, None)
    assert T._recipe_table(TWO_TABLES, "loans") == "loans"
    assert T._recipe_table({"schema": {"tables": [{"name": "only"}]}}, None) is None  # the only table is used
    nested = {"schema": {"banking": {"tables": [{"name": "accounts"}, {"name": "loans"}]}}}
    with pytest.raises(ToolError, match="banking.accounts, banking.loans"):
        T._recipe_table(nested, None)


@pytest.mark.asyncio
async def test_failed_steps_are_an_error_naming_the_table(monkeypatch):
    async def access(caller, ds_id, *, query):
        return TWO_TABLES

    async def governed(caller):
        return caller

    async def preview(caller, req):
        assert req.table == "loans"
        return {"table": "loans", "rows": [], "columns": [],
                "step_errors": [{"step": 0, "message": 'column "outstanding" does not exist'}]}

    monkeypatch.setattr(T, "_require_access", access)
    monkeypatch.setattr(T, "_governed", governed)
    _fake_service(monkeypatch, preview=preview)
    with pytest.raises(ToolError, match=r'failed on table loans: step 0: column "outstanding"'):
        await T.preview_cleaning(_caller(), {"data_source_id": "ds", "table": "loans", "steps": [{"sql": {}}]})


@pytest.mark.asyncio
async def test_a_draft_goes_to_the_callers_project_on_the_named_table(monkeypatch):
    async def access(caller, ds_id, *, query):
        return TWO_TABLES

    saved = {}

    class _DB:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def add(self, obj):
            obj.id = uuid.uuid4()
            saved["recipe"] = obj

        async def commit(self):
            pass

        async def refresh(self, obj):
            pass

    import src.db.session as session

    trial = {"errors": []}

    async def preview(caller, req):
        assert req.table == "loans"
        return {"table": "loans", "rows": [{}], "step_errors": trial["errors"]}

    async def governed(caller):
        return caller

    monkeypatch.setattr(T, "_require_access", access)
    monkeypatch.setattr(T, "_governed", governed)
    monkeypatch.setattr(session, "async_session", lambda: _DB())
    _fake_service(monkeypatch, preview=preview)
    working_in = str(uuid.uuid4())
    out = await T.draft_recipe(_caller(working_in), {"data_source_id": "ds", "table": "loans", "name": "QC",
                                                    "steps": [{"sql": {"query": "SELECT * FROM {input}"}}]})
    recipe = saved["recipe"]
    assert str(recipe.project_id) == working_in and recipe.source_table == "loans"
    assert out["review_url"] == f"/prepare/{recipe.id}"

    with pytest.raises(ToolError, match="Name the table"):
        await T.draft_recipe(_caller(working_in), {"data_source_id": "ds", "name": "QC", "steps": []})

    # A recipe that does not run is not saved, and the reason comes back.
    saved.clear()
    trial["errors"] = [{"step": 0, "message": 'column "outstanding" does not exist'}]
    with pytest.raises(ToolError, match=r'Not saved: the steps fail on table loans: step 0: column "outstanding"'):
        await T.draft_recipe(_caller(working_in), {"data_source_id": "ds", "table": "loans", "name": "QC",
                                                  "steps": [{"sql": {"query": "SELECT outstanding FROM {input}"}}]})
    assert not saved
