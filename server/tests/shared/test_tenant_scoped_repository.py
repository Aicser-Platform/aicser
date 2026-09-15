"""TenantScopedRepository -- the base_repository.py class added to enforce
org-scoping structurally instead of relying on every call site remembering
a manual `.where(Model.organization_id == org_id)` filter. These tests
lock in the actual guarantee: a query built by this class is confined to
its organization_id at the SQL level, not just "usually filtered right"."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import Column, Integer, String
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base

from src.shared.repository import BaseRepository, TenantScopedRepository

# Isolated declarative base -- must not share metadata with the app's real
# models, or table registration collides with other test modules.
_TestBase = declarative_base()


class _ScopedWidget(_TestBase):
    __tablename__ = "test_tenant_scoped_widget"
    id = Column(UUID(as_uuid=True), primary_key=True)
    organization_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String)


class _UnscopedLookup(_TestBase):
    __tablename__ = "test_unscoped_lookup"
    id = Column(Integer, primary_key=True)
    name = Column(String)


def _compiled_where(query) -> str:
    return str(query.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_rejects_model_without_organization_id():
    with pytest.raises(TypeError, match="no organization_id column"):
        TenantScopedRepository(_UnscopedLookup, organization_id=1)


def test_rejects_missing_organization_id():
    with pytest.raises(ValueError, match="organization_id is required"):
        TenantScopedRepository(_ScopedWidget, organization_id=None)


def test_scoped_query_includes_organization_filter():
    org_id = uuid.uuid4()
    repo = TenantScopedRepository(_ScopedWidget, organization_id=org_id)
    sql = _compiled_where(repo.scoped_query())
    assert f"organization_id = '{org_id}'" in sql


def test_get_query_is_organization_scoped_not_just_by_id():
    """The regression this class exists to prevent: fetching by ID alone,
    with the org filter silently missing."""
    org_id = uuid.uuid4()
    repo = TenantScopedRepository(_ScopedWidget, organization_id=org_id)
    query = repo._build_base_query().where(_ScopedWidget.id == uuid.uuid4())
    sql = _compiled_where(query)
    assert "organization_id" in sql
    assert f"'{org_id}'" in sql


@pytest.mark.asyncio
async def test_create_stamps_organization_id_ignoring_caller_value():
    org_id = uuid.uuid4()
    other_org_id = uuid.uuid4()
    repo = TenantScopedRepository(_ScopedWidget, organization_id=org_id)

    session = AsyncMock()
    session.add = MagicMock()

    async def fake_refresh(obj):
        obj.id = uuid.uuid4()

    session.refresh = AsyncMock(side_effect=fake_refresh)

    # Caller tries to smuggle a different org_id in the payload -- the
    # repository's own scope must win.
    created = await repo.create({"name": "widget", "organization_id": other_org_id}, db=session)

    assert created.organization_id == org_id
    assert created.organization_id != other_org_id


@pytest.mark.asyncio
async def test_update_scopes_lookup_to_organization():
    org_id = uuid.uuid4()
    repo = TenantScopedRepository(_ScopedWidget, organization_id=org_id)

    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=None)  # row belongs to another org
    session.execute = AsyncMock(return_value=result)

    from types import SimpleNamespace

    update_payload = SimpleNamespace(model_dump=lambda exclude_unset=True: {"name": "renamed"})
    outcome = await repo.update(uuid.uuid4(), update_payload, db=session)

    # Not found (None) because the org-scoped query excluded the row --
    # this is the "structural" guarantee: no row leaks across the boundary.
    assert outcome is None
    session.execute.assert_awaited_once()
    executed_sql = _compiled_where(session.execute.await_args.args[0])
    assert "organization_id" in executed_sql


def test_base_repository_unaffected_for_non_tenant_models():
    """BaseRepository itself must remain usable as-is for models that are
    intentionally not tenant-scoped (e.g. global lookup tables)."""
    repo = BaseRepository(_UnscopedLookup)
    assert repo.model is _UnscopedLookup
