from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.data import model_router
from src.modules.data.services.data_source_access_service import (
    DATA_SOURCE_PERMISSION_EDIT,
    DATA_SOURCE_PERMISSION_VIEW,
)


@pytest.mark.asyncio
async def test_model_router_requires_view_permission(monkeypatch):
    calls = []

    async def get_source(*_args, **_kwargs):
        return SimpleNamespace(id="ds-1", is_active=True, project_id=uuid4())

    async def can_access(*args, **kwargs):
        calls.append((args, kwargs))
        return True

    monkeypatch.setattr(
        model_router.DataSourceAccessService,
        "get_data_source",
        staticmethod(get_source),
    )
    monkeypatch.setattr(
        model_router.DataSourceAccessService,
        "can_access",
        staticmethod(can_access),
    )

    result = await model_router._require_data_source_access(
        SimpleNamespace(),
        "ds-1",
        {"sub": "user-1"},
    )

    assert result.id == "ds-1"
    assert calls[0][0][2] == DATA_SOURCE_PERMISSION_VIEW


@pytest.mark.asyncio
async def test_model_router_requires_edit_permission_for_writes(monkeypatch):
    calls = []

    async def get_source(*_args, **_kwargs):
        return SimpleNamespace(id="ds-1", is_active=True, project_id=uuid4())

    async def can_access(*args, **kwargs):
        calls.append((args, kwargs))
        return False

    monkeypatch.setattr(
        model_router.DataSourceAccessService,
        "get_data_source",
        staticmethod(get_source),
    )
    monkeypatch.setattr(
        model_router.DataSourceAccessService,
        "can_access",
        staticmethod(can_access),
    )

    with pytest.raises(HTTPException) as exc:
        await model_router._require_data_source_access(
            SimpleNamespace(),
            "ds-1",
            {"sub": "user-1"},
            write=True,
        )

    assert exc.value.status_code == 403
    assert calls[0][0][2] == DATA_SOURCE_PERMISSION_EDIT
