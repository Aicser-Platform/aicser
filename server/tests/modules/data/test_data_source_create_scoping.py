"""create_data_source() must not silently reassign an explicitly-scoped source
to an arbitrary project. Regression test for the knowledge-library backing
data source misattribution bug: a project- or organization-scoped caller
(e.g. KnowledgeLibraryService._create_backing_data_source) passes project_id
and/or organization_id explicitly, and that must be respected verbatim rather
than falling back to "the user's first project" (which silently pinned every
KB library's backing source to whatever project the user happened to create
most recently, unrelated to the library's actual scope)."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from src.modules.data.services.data_sources_crud import DataSourcesCRUD, DataSourceCreate


def _mock_session():
    session = AsyncMock()
    added = []
    session.add = lambda obj, *_args, **_kwargs: added.append(obj)
    session.added = added
    session.flush = AsyncMock(return_value=None)
    return session


@pytest.mark.asyncio
async def test_explicit_project_id_is_used_verbatim_no_fallback():
    project_id = uuid4()
    user_id = str(uuid4())
    crud = DataSourcesCRUD()
    session = _mock_session()

    create_data = DataSourceCreate(
        name="lib-backing",
        type="knowledge_base",
        format="knowledge_base",
        connection_config={"library_backing": True},
        project_id=str(project_id),
    )

    with patch("src.modules.data.services.data_sources_crud.is_ee_enabled", return_value=True), patch(
        "src.modules.project.service.ProjectService.get_user_projects",
        new=AsyncMock(side_effect=AssertionError("fallback must not run when project_id is explicit")),
    ), patch(
        "src.modules.data.services.data_source_access_service.DataSourceAccessService.grant_project_access",
        new=AsyncMock(return_value=None),
    ), patch.object(
        crud.real_data_manager, "test_connection", new=AsyncMock(side_effect=Exception("no real connection in test"))
    ):
        result = await crud.create_data_source(create_data, user_id=user_id, session=session)

    assert str(result.project_id) == str(project_id)


@pytest.mark.asyncio
async def test_explicit_organization_id_with_no_project_skips_fallback():
    org_id = uuid4()
    user_id = str(uuid4())
    crud = DataSourcesCRUD()
    session = _mock_session()

    create_data = DataSourceCreate(
        name="org-lib-backing",
        type="knowledge_base",
        format="knowledge_base",
        connection_config={"library_backing": True},
        organization_id=str(org_id),
    )

    with patch("src.modules.data.services.data_sources_crud.is_ee_enabled", return_value=True), patch(
        "src.modules.project.service.ProjectService.get_user_projects",
        new=AsyncMock(side_effect=AssertionError("fallback must not run when organization_id is explicit")),
    ), patch.object(
        crud.real_data_manager, "test_connection", new=AsyncMock(side_effect=Exception("no real connection in test"))
    ):
        result = await crud.create_data_source(create_data, user_id=user_id, session=session)

    assert result.project_id is None
    persisted = session.added[0]
    assert persisted.project_id is None
    assert str(persisted.organization_id) == str(org_id)


@pytest.mark.asyncio
async def test_no_scope_at_all_still_falls_back_to_first_project():
    """Preserves existing behavior for the public POST /sources endpoint, where a
    human creating a data source with no project selected gets a sensible default."""
    project_id = uuid4()
    user_id = str(uuid4())
    crud = DataSourcesCRUD()
    session = _mock_session()

    create_data = DataSourceCreate(
        name="unscoped",
        type="file_storage",
        format="csv",
        connection_config={},
    )

    fake_project = AsyncMock()
    fake_project.id = project_id

    with patch("src.modules.data.services.data_sources_crud.is_ee_enabled", return_value=True), patch(
        "src.modules.project.service.ProjectService.get_user_projects",
        new=AsyncMock(return_value=([fake_project], 1)),
    ), patch(
        "src.modules.data.services.data_source_access_service.DataSourceAccessService.grant_project_access",
        new=AsyncMock(return_value=None),
    ):
        result = await crud.create_data_source(create_data, user_id=user_id, session=session)

    assert str(result.project_id) == str(project_id)
