import pytest

from src.modules.data.services import project_scope
from src.modules.data.services.project_scope import CrossProjectSourceError, ensure_source_in_project


@pytest.mark.asyncio
async def test_same_project_is_allowed(monkeypatch):
    async def owner(_db, _ds):
        return "p1"

    monkeypatch.setattr(project_scope, "data_source_project", owner)
    await ensure_source_in_project(object(), "ds-1", "p1")


@pytest.mark.asyncio
async def test_another_projects_source_is_refused(monkeypatch):
    async def owner(_db, _ds):
        return "p2"

    async def not_shared(_db, _ds, _p):
        return False

    monkeypatch.setattr(project_scope, "data_source_project", owner)
    monkeypatch.setattr(project_scope, "_shared_into_project", not_shared)
    with pytest.raises(CrossProjectSourceError):
        await ensure_source_in_project(object(), "ds-1", "p1")


@pytest.mark.asyncio
async def test_unscoped_rows_are_not_blocked(monkeypatch):
    async def owner(_db, _ds):
        return None

    monkeypatch.setattr(project_scope, "data_source_project", owner)
    await ensure_source_in_project(object(), "ds-1", "p1")  # source without a project
    await ensure_source_in_project(object(), "ds-1", None)  # chart without a project (CE)


@pytest.mark.asyncio
async def test_source_added_to_the_project_is_allowed(monkeypatch):
    async def owner(_db, _ds):
        return "p2"

    async def shared(_db, _ds, project):
        return project == "p1"

    monkeypatch.setattr(project_scope, "data_source_project", owner)
    monkeypatch.setattr(project_scope, "_shared_into_project", shared)
    await ensure_source_in_project(object(), "ds-1", "p1")
