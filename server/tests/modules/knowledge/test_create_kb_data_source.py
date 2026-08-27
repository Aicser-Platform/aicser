"""_create_kb_data_source() used to never pass project_id into DataSourceCreate
at all. DataSourcesCRUD.create_data_source() falls back to the user's *first*
project when no project_id/organization_id is given at all (a legitimate
fallback for other callers with no scoping info) - but the knowledge-base
upload UI always has a real currentProject in scope, so omitting it here
silently landed every KB upload in whichever project happened to be first,
not the project the user was actually working in. Looked like uploading a KB
"created a new project space"."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.knowledge.router import _create_kb_data_source


def _mock_session_factory():
    db = MagicMock()
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=db)
    cm.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=cm)


@pytest.mark.asyncio
async def test_create_kb_data_source_forwards_project_id():
    captured = {}

    async def fake_create_data_source(self, data_source_data, user_id, session=None):
        captured["project_id"] = data_source_data.project_id
        result = MagicMock()
        result.id = "ds-123"
        return result

    with patch(
        "src.modules.data.services.data_sources_crud.DataSourcesCRUD.create_data_source",
        new=fake_create_data_source,
    ), patch("src.db.session.async_session", new=_mock_session_factory()):
        ds_id = await _create_kb_data_source(
            "My KB", "user-1", "desc", project_id="proj-42"
        )

    assert ds_id == "ds-123"
    assert captured["project_id"] == "proj-42"


@pytest.mark.asyncio
async def test_create_kb_data_source_project_id_defaults_to_none():
    captured = {}

    async def fake_create_data_source(self, data_source_data, user_id, session=None):
        captured["project_id"] = data_source_data.project_id
        result = MagicMock()
        result.id = "ds-456"
        return result

    with patch(
        "src.modules.data.services.data_sources_crud.DataSourcesCRUD.create_data_source",
        new=fake_create_data_source,
    ), patch("src.db.session.async_session", new=_mock_session_factory()):
        await _create_kb_data_source("My KB", "user-1", "desc")

    assert captured["project_id"] is None
