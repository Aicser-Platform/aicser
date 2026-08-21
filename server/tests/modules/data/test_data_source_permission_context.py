from types import SimpleNamespace

import pytest

from src.modules.data.services.data_source_access_service import DataSourceAccessService


@pytest.mark.asyncio
async def test_require_data_source_permission_uses_only_explicit_project(monkeypatch):
    from src.modules.data import router as data_router

    seen = {}

    async def active_source(_db, _data_source_id):
        return SimpleNamespace(id="ds-1", project_id="source-project")

    async def can_access(_user_id, _data_source_id, _permission, **kwargs):
        seen["project_id"] = kwargs.get("project_id")
        return True

    monkeypatch.setattr(data_router, "_get_active_data_source_or_404", active_source)
    monkeypatch.setattr(
        DataSourceAccessService,
        "can_access",
        staticmethod(can_access),
    )

    await data_router._require_data_source_permission(
        object(),
        "user-1",
        "ds-1",
        "query",
    )

    assert seen["project_id"] is None


@pytest.mark.asyncio
async def test_require_data_source_permission_passes_explicit_project(monkeypatch):
    from src.modules.data import router as data_router

    seen = {}

    async def active_source(_db, _data_source_id):
        return SimpleNamespace(id="ds-1", project_id="source-project")

    async def can_access(_user_id, _data_source_id, _permission, **kwargs):
        seen["project_id"] = kwargs.get("project_id")
        return True

    monkeypatch.setattr(data_router, "_get_active_data_source_or_404", active_source)
    monkeypatch.setattr(
        DataSourceAccessService,
        "can_access",
        staticmethod(can_access),
    )

    await data_router._require_data_source_permission(
        object(),
        "user-1",
        "ds-1",
        "query",
        project_id="request-project",
    )

    assert seen["project_id"] == "request-project"
