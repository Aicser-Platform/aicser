"""One access rule for knowledge documents: library roles in EE, ownership/grants otherwise."""

import sys
import types
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.knowledge import access


def _fake_ee(library, *, view=False, manage=False, create=False):
    """Stand-ins for the EE library model and service, loaded through the importlib seam."""
    models = types.ModuleType("ee.modules.knowledge.models")

    class _Col:
        def __eq__(self, other):
            return True

        def is_(self, other):
            return True

    models.KnowledgeLibrary = SimpleNamespace(data_source_id=_Col(), is_deleted=_Col())
    service = types.ModuleType("ee.modules.knowledge.library_service")
    service.KnowledgeLibraryService = SimpleNamespace(
        user_can_view_library=AsyncMock(return_value=view),
        user_can_manage_library=AsyncMock(return_value=manage),
    )
    service.RBACService = SimpleNamespace(check_permission=AsyncMock(return_value=create))
    return {"ee.modules.knowledge.models": models, "ee.modules.knowledge.library_service": service}


def _session_with(library):
    session = MagicMock()
    session.scalar = AsyncMock(return_value=library)
    return session


@pytest.fixture
def select_passthrough(monkeypatch):
    # The fake model has no real columns; the query itself is irrelevant to these tests.
    fake = MagicMock()
    fake.return_value.where.return_value.limit.return_value = "stmt"
    monkeypatch.setattr(access, "select", fake)


@pytest.mark.asyncio
async def test_org_library_members_can_view_documents(monkeypatch, select_passthrough):
    """A library visible to a member must not refuse its documents (the old mismatch)."""
    monkeypatch.setattr(access, "is_ee_enabled", lambda: True)
    library = SimpleNamespace(organization_id=uuid.uuid4(), project_id=None, scope="organization")
    with patch.dict(sys.modules, _fake_ee(library, view=True)):
        assert await access.can_use_knowledge_source(_session_with(library), uuid.uuid4(), "ds-1", "view")


@pytest.mark.asyncio
async def test_viewers_cannot_upload_without_create_in_the_library_scope(monkeypatch, select_passthrough):
    monkeypatch.setattr(access, "is_ee_enabled", lambda: True)
    library = SimpleNamespace(organization_id=uuid.uuid4(), project_id=uuid.uuid4(), scope="project")
    fakes = _fake_ee(library, view=True, manage=False, create=False)
    with patch.dict(sys.modules, fakes):
        assert not await access.can_use_knowledge_source(_session_with(library), uuid.uuid4(), "ds-1", "contribute")
    # Checked in the library's own org and project, not globally.
    kwargs = fakes["ee.modules.knowledge.library_service"].RBACService.check_permission.call_args.kwargs
    assert kwargs["permission_code"] == "knowledge:create"
    assert kwargs["organization_id"] == str(library.organization_id)
    assert kwargs["project_id"] == str(library.project_id)


@pytest.mark.asyncio
async def test_contributors_can_upload_but_not_manage(monkeypatch, select_passthrough):
    monkeypatch.setattr(access, "is_ee_enabled", lambda: True)
    library = SimpleNamespace(organization_id=uuid.uuid4(), project_id=None, scope="organization")
    with patch.dict(sys.modules, _fake_ee(library, view=True, manage=False, create=True)):
        session = _session_with(library)
        assert await access.can_use_knowledge_source(session, uuid.uuid4(), "ds-1", "contribute")
        assert not await access.can_use_knowledge_source(session, uuid.uuid4(), "ds-1", "manage")


@pytest.mark.asyncio
async def test_other_organizations_library_is_refused(monkeypatch, select_passthrough):
    monkeypatch.setattr(access, "is_ee_enabled", lambda: True)
    library = SimpleNamespace(organization_id=uuid.uuid4(), project_id=None, scope="organization")
    with patch.dict(sys.modules, _fake_ee(library)):
        session = _session_with(library)
        for action in ("view", "contribute", "manage"):
            assert not await access.can_use_knowledge_source(session, uuid.uuid4(), "ds-1", action)


@pytest.mark.asyncio
async def test_non_library_source_falls_back_to_ownership_then_explicit_grant(monkeypatch):
    monkeypatch.setattr(access, "is_ee_enabled", lambda: False)
    monkeypatch.setattr(access, "user_can_access_data_source", AsyncMock(return_value=False))
    grant = AsyncMock(return_value=True)
    with patch(
        "src.modules.data.services.data_source_access_service.DataSourceAccessService.can_access", new=grant
    ):
        assert await access.can_use_knowledge_source(MagicMock(), uuid.uuid4(), "ds-1", "contribute")
    assert grant.call_args.args[2] == "data:edit"


@pytest.mark.asyncio
async def test_missing_source_id_is_refused():
    assert not await access.can_use_knowledge_source(MagicMock(), uuid.uuid4(), "", "view")
