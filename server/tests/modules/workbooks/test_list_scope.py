"""Notebooks and sheets list only the current project's items, your own included (like dashboards)."""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from src.modules.notebooks import router as NB
from src.modules.workbooks import router as WB

ME, ORG, PROJ = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())


class CaptureDB:
    def __init__(self):
        self.stmt = None

    async def execute(self, stmt):
        self.stmt = stmt
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))


def _sql(stmt) -> str:
    compiled = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    return " ".join(compiled.split()).lower()


@pytest.fixture
def caller(monkeypatch):
    who = SimpleNamespace(user_id=ME, organization_id=ORG, project_id=PROJ)

    async def allow(*a, **k):
        return None

    for mod in (NB, WB):
        monkeypatch.setattr(mod, "caller_from_token", lambda token, project_id=None: who)
        monkeypatch.setattr(mod, "require_permission", allow)
    return who


@pytest.mark.asyncio
@pytest.mark.parametrize("mod,fn,table", [(NB, "list_notebooks", "notebooks"), (WB, "list_workbooks", "workbooks")])
async def test_own_items_are_scoped_to_the_current_project(caller, mod, fn, table):
    db = CaptureDB()
    await getattr(mod, fn)(project_id=PROJ, q=None, current_token={}, db=db)
    sql = _sql(db.stmt)
    where = sql.split(" where ", 1)[1]
    # The project and organization filters sit at the top level, so they apply to your own
    # items as well as shared ones (the old query OR'd "mine" past them).
    assert f"{table}.project_id = '{PROJ}'" in where
    assert f"{table}.organization_id = '{ORG}'" in where
    assert f"({table}.user_id = '{ME}' or {table}.visibility = 'project')" in where


@pytest.mark.asyncio
@pytest.mark.parametrize("mod,fn,table", [(NB, "list_notebooks", "notebooks"), (WB, "list_workbooks", "workbooks")])
async def test_search_by_title(caller, mod, fn, table):
    db = CaptureDB()
    await getattr(mod, fn)(project_id=PROJ, q="  budget ", current_token={}, db=db)
    # (the compiler escapes % as %% for the driver)
    assert f"{table}.title ilike '%%budget%%'" in _sql(db.stmt)
