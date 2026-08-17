import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401
from src.modules.data.services import data_source_access_service as access_mod
from src.modules.data.services.data_source_access_service import (
    DATA_SOURCE_PERMISSION_EDIT,
    DATA_SOURCE_PERMISSION_MANAGE,
    DATA_SOURCE_PERMISSION_QUERY,
    DATA_SOURCE_PERMISSION_SHARE,
    DATA_SOURCE_PERMISSION_VIEW,
    DataSourceAccessService,
)


async def _false(*_args, **_kwargs):
    return False


async def _true(*_args, **_kwargs):
    return True


async def _empty_roles(*_args, **_kwargs):
    return set(), set()


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ExecuteResult:
    def __init__(self, *, scalars=None, rows=None, scalar_one=None):
        self._scalars = scalars or []
        self._rows = rows or []
        self._scalar_one = scalar_one

    def scalars(self):
        return _ScalarResult(self._scalars)

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._scalar_one


class _Session:
    def __init__(self, results):
        self._results = list(results)
        self.added = []

    async def execute(self, _query):
        if not self._results:
            raise AssertionError("Unexpected execute call")
        return self._results.pop(0)

    def add(self, row):
        self.added.append(row)


@pytest.mark.asyncio
async def test_ce_shared_sources_are_readable_but_not_manageable(monkeypatch):
    async def get_source(*_args, **_kwargs):
        return SimpleNamespace(user_id=None)

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: False)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_data_source",
        staticmethod(get_source),
    )

    assert await DataSourceAccessService.can_view("user-1", "ds-1", session=_Session([]))
    assert await DataSourceAccessService.can_query("user-1", "ds-1", session=_Session([]))
    assert not await DataSourceAccessService.can_edit("user-1", "ds-1", session=_Session([]))
    assert not await DataSourceAccessService.can_manage("user-1", "ds-1", session=_Session([]))


@pytest.mark.asyncio
async def test_ce_owner_can_manage_own_source(monkeypatch):
    user_id = uuid4()

    async def get_source(*_args, **_kwargs):
        return SimpleNamespace(user_id=user_id)

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: False)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_data_source",
        staticmethod(get_source),
    )

    assert await DataSourceAccessService.can_manage(str(user_id), "ds-1", session=_Session([]))
    assert not await DataSourceAccessService.can_manage(str(uuid4()), "ds-1", session=_Session([]))


@pytest.mark.asyncio
async def test_ee_project_grant_requires_membership_and_permission(monkeypatch):
    organization_id = uuid4()
    project_id = uuid4()
    grant = SimpleNamespace(permissions=[DATA_SOURCE_PERMISSION_VIEW, DATA_SOURCE_PERMISSION_QUERY])

    async def get_source(*_args, **_kwargs):
        return SimpleNamespace(
            user_id=uuid4(),
            organization_id=organization_id,
            project_id=project_id,
        )

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_data_source",
        staticmethod(get_source),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_is_org_data_admin",
        staticmethod(_false),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_effective_role_names",
        staticmethod(_empty_roles),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_has_project_membership",
        staticmethod(_true),
    )

    session = _Session([_ExecuteResult(scalars=[grant])])
    assert await DataSourceAccessService.can_query(
        str(uuid4()),
        "ds-1",
        project_id=str(project_id),
        session=session,
    )

    session = _Session([_ExecuteResult(scalars=[grant])])
    assert not await DataSourceAccessService.can_edit(
        str(uuid4()),
        "ds-1",
        project_id=str(project_id),
        session=session,
    )

    monkeypatch.setattr(
        DataSourceAccessService,
        "_has_project_membership",
        staticmethod(_false),
    )
    session = _Session([_ExecuteResult(scalars=[])])
    assert not await DataSourceAccessService.can_query(
        str(uuid4()),
        "ds-1",
        project_id=str(project_id),
        session=session,
    )


@pytest.mark.asyncio
async def test_ee_list_accessible_source_ids_filters_by_permission(monkeypatch):
    organization_id = uuid4()
    user_id = uuid4()
    project_id = uuid4()

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "_is_org_data_admin",
        staticmethod(_false),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_effective_role_names",
        staticmethod(_empty_roles),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_has_project_membership",
        staticmethod(_true),
    )

    session = _Session(
        [
            _ExecuteResult(
                rows=[
                    ("ds-view", [DATA_SOURCE_PERMISSION_VIEW]),
                    ("ds-query", [DATA_SOURCE_PERMISSION_QUERY]),
                    ("ds-manage", [DATA_SOURCE_PERMISSION_MANAGE]),
                ]
            )
        ]
    )

    assert await DataSourceAccessService.list_accessible_source_ids(
        str(user_id),
        str(organization_id),
        project_id=str(project_id),
        permission=DATA_SOURCE_PERMISSION_QUERY,
        session=session,
    ) == ["ds-manage", "ds-query"]


@pytest.mark.asyncio
async def test_upsert_grant_creates_normalized_active_grant():
    organization_id = uuid4()
    user_id = uuid4()
    session = _Session([_ExecuteResult(scalar_one=None)])

    grant = await DataSourceAccessService.upsert_grant(
        data_source_id="ds-1",
        organization_id=str(organization_id),
        grantee_type="user",
        grantee_id=str(user_id),
        permissions=[
            DATA_SOURCE_PERMISSION_SHARE,
            DATA_SOURCE_PERMISSION_VIEW,
            DATA_SOURCE_PERMISSION_EDIT,
            DATA_SOURCE_PERMISSION_VIEW,
        ],
        created_by=str(user_id),
        session=session,
    )

    assert session.added == [grant]
    assert grant.organization_id == organization_id
    assert grant.grantee_type == "user"
    assert grant.grantee_id == str(user_id)
    assert grant.permissions == [
        DATA_SOURCE_PERMISSION_EDIT,
        DATA_SOURCE_PERMISSION_SHARE,
        DATA_SOURCE_PERMISSION_VIEW,
    ]
    assert grant.is_active is True
    assert grant.is_deleted is False


@pytest.mark.asyncio
async def test_upsert_grant_reactivates_existing_grant():
    existing = SimpleNamespace(
        organization_id=None,
        permissions=[],
        rls_policy_id=None,
        created_by=None,
        is_active=False,
        is_deleted=True,
        deleted_at=object(),
    )
    organization_id = uuid4()
    user_id = uuid4()
    session = _Session([_ExecuteResult(scalar_one=existing)])

    grant = await DataSourceAccessService.upsert_grant(
        data_source_id="ds-1",
        organization_id=str(organization_id),
        grantee_type="project",
        grantee_id="project-1",
        permissions=[DATA_SOURCE_PERMISSION_QUERY],
        created_by=str(user_id),
        session=session,
    )

    assert grant is existing
    assert session.added == []
    assert existing.organization_id == organization_id
    assert existing.permissions == [DATA_SOURCE_PERMISSION_QUERY]
    assert existing.created_by == user_id
    assert existing.is_active is True
    assert existing.is_deleted is False
    assert existing.deleted_at is None


@pytest.mark.asyncio
async def test_revoke_grant_soft_deletes_existing_grant():
    grant_id = uuid4()
    existing = SimpleNamespace(
        is_active=True,
        is_deleted=False,
        deleted_at=None,
    )
    session = _Session([_ExecuteResult(scalar_one=existing)])

    assert await DataSourceAccessService.revoke_grant(
        data_source_id="ds-1",
        grant_id=str(grant_id),
        session=session,
    )
    assert existing.is_active is False
    assert existing.is_deleted is True
    assert existing.deleted_at is not None


@pytest.mark.asyncio
async def test_upsert_grant_rejects_invalid_permission():
    with pytest.raises(ValueError, match="Invalid data source permissions"):
        await DataSourceAccessService.upsert_grant(
            data_source_id="ds-1",
            organization_id=None,
            grantee_type="user",
            grantee_id="user-1",
            permissions=["owner"],
            created_by=None,
            session=_Session([]),
        )
