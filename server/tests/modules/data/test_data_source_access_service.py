import os
import sys
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
        self.queries = []

    async def execute(self, query):
        self.queries.append(query)
        if not self._results:
            raise AssertionError("Unexpected execute call")
        return self._results.pop(0)

    def add(self, row):
        self.added.append(row)


def _mapped_project(monkeypatch):
    pytest.importorskip("ee.modules.project.models", reason="EE submodule not present")
    from ee.modules.project.models import Project as EEProject

    monkeypatch.setattr("src.modules.project.models.Project", EEProject)
    return EEProject


def _query_sql(query) -> str:
    compiled = query.compile(compile_kwargs={"literal_binds": True})
    return f"{compiled} {compiled.params}"


def _query_contains_uuid(sql: str, value) -> bool:
    compact = sql.replace("-", "").lower()
    return str(value).replace("-", "").lower() in compact


_UNSET = object()


class _SessionReturning:
    """Return a configured policy, then grantee, then the existing-grant row."""

    def __init__(
        self,
        *,
        policy=None,
        cls_policy=_UNSET,
        grantee=_UNSET,
        existing=None,
    ):
        self.added = []
        policy_value = policy if cls_policy is _UNSET else cls_policy
        grantee_value = object() if grantee is _UNSET else grantee
        self._results = [
            _ExecuteResult(scalar_one=policy_value),
            _ExecuteResult(scalar_one=grantee_value),
            _ExecuteResult(scalar_one=existing),
        ]

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
async def test_ee_owner_can_query_legacy_source_without_grant(monkeypatch):
    user_id = uuid4()
    organization_id = uuid4()
    project_id = uuid4()

    async def get_source(*_args, **_kwargs):
        return SimpleNamespace(
            user_id=user_id,
            organization_id=organization_id,
            project_id=project_id,
        )

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_data_source",
        staticmethod(get_source),
    )

    assert await DataSourceAccessService.can_query(
        str(user_id),
        "ds-1",
        session=_Session([]),
    )
    assert await DataSourceAccessService.can_manage(
        str(user_id),
        "ds-1",
        session=_Session([]),
    )


@pytest.mark.asyncio
async def test_ee_data_admin_accepts_concrete_data_permissions(monkeypatch):
    checked_permissions = []

    class FakeRBACService:
        @staticmethod
        async def check_permission(*, permission_code, **_kwargs):
            checked_permissions.append(permission_code)
            return permission_code == "data:edit"

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setitem(
        sys.modules,
        "src.modules.authentication.rbac.rbac_service",
        SimpleNamespace(RBACService=FakeRBACService),
    )

    assert await DataSourceAccessService._is_org_data_admin(
        str(uuid4()),
        str(uuid4()),
    )
    assert checked_permissions == ["data:*", "data:delete", "data:edit"]


@pytest.mark.asyncio
async def test_ee_effective_roles_include_ids_and_names(monkeypatch):
    org_role_id = uuid4()
    project_role_id = uuid4()

    class FakeRBACService:
        @staticmethod
        async def get_user_roles(_user_id, _organization_id, project_id):
            if project_id:
                return [SimpleNamespace(id=project_role_id, name="project_editor")]
            return [SimpleNamespace(id=org_role_id, name="org_admin")]

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setitem(
        sys.modules,
        "src.modules.authentication.rbac.rbac_service",
        SimpleNamespace(RBACService=FakeRBACService),
    )

    org_roles, project_roles = await DataSourceAccessService._effective_role_names(
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
    )

    assert org_roles == {"org_admin", str(org_role_id)}
    assert project_roles == {"project_editor", str(project_role_id)}


@pytest.mark.asyncio
async def test_ee_data_admin_still_needs_query_grant(monkeypatch):
    organization_id = uuid4()

    async def get_source(*_args, **_kwargs):
        return SimpleNamespace(organization_id=organization_id)

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_data_source",
        staticmethod(get_source),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_is_org_data_admin",
        staticmethod(_true),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_effective_role_names",
        staticmethod(_empty_roles),
    )

    assert await DataSourceAccessService.can_manage(
        str(uuid4()),
        "ds-1",
        session=_Session([]),
    )
    assert not await DataSourceAccessService.can_query(
        str(uuid4()),
        "ds-1",
        session=_Session([_ExecuteResult(scalars=[])]),
    )


@pytest.mark.asyncio
async def test_ee_data_admin_list_bypass_is_management_only(monkeypatch):
    organization_id = uuid4()
    user_id = uuid4()

    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "_is_org_data_admin",
        staticmethod(_true),
    )
    monkeypatch.setattr(
        DataSourceAccessService,
        "_effective_role_names",
        staticmethod(_empty_roles),
    )

    assert await DataSourceAccessService.list_accessible_source_ids(
        str(user_id),
        str(organization_id),
        permission=DATA_SOURCE_PERMISSION_MANAGE,
        session=_Session([_ExecuteResult(scalars=["ds-admin"])]),
    ) == ["ds-admin"]

    assert await DataSourceAccessService.list_accessible_source_ids(
        str(user_id),
        str(organization_id),
        permission=DATA_SOURCE_PERMISSION_VIEW,
        session=_Session([_ExecuteResult(scalars=[]), _ExecuteResult(rows=[])]),
    ) == []


@pytest.mark.asyncio
async def test_ee_list_accessible_source_ids_includes_owned_legacy_sources(monkeypatch):
    organization_id = uuid4()
    user_id = uuid4()

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

    assert await DataSourceAccessService.list_accessible_source_ids(
        str(user_id),
        str(organization_id),
        permission=DATA_SOURCE_PERMISSION_QUERY,
        session=_Session(
            [_ExecuteResult(scalars=["ds-owned"]), _ExecuteResult(rows=[])]
        ),
    ) == ["ds-owned"]


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
            _ExecuteResult(scalars=[]),
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
async def test_auto_project_grant_does_not_convey_unfiltered_reads(monkeypatch):
    """An auto-created grant must not silently bypass row filters.

    A grant with no rls_policy_id means "all rows". Combined with `query`, that
    is a bypass nobody chose. Reading rows becomes something an admin grants
    deliberately through the Permissions tab.
    """
    monkeypatch.setattr(access_mod, "is_ee_enabled", lambda: True)
    session = _Session([_ExecuteResult(scalar_one=None)])
    await DataSourceAccessService.grant_project_access(
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        created_by=None,
        session=session,
    )
    granted = session.added[0]
    assert "query" not in granted.permissions
    assert set(granted.permissions) == {"view", "edit", "manage"}


@pytest.mark.asyncio
async def test_upsert_grant_creates_normalized_active_grant():
    organization_id = uuid4()
    user_id = uuid4()
    session = _Session(
        [
            _ExecuteResult(scalar_one=user_id),
            _ExecuteResult(scalar_one=None),
        ]
    )

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
async def test_upsert_grant_reactivates_existing_grant(monkeypatch):
    _mapped_project(monkeypatch)
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
    session = _Session(
        [
            _ExecuteResult(scalar_one=uuid4()),
            _ExecuteResult(scalar_one=existing),
        ]
    )

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


@pytest.mark.asyncio
async def test_upsert_grant_rejects_a_policy_from_another_data_source():
    with pytest.raises(ValueError, match="policy"):
        await DataSourceAccessService.upsert_grant(
            data_source_id="ds-1",
            organization_id="org-1",
            grantee_type="user",
            grantee_id=str(uuid4()),
            permissions=["view", "query"],
            created_by=None,
            rls_policy_id=str(uuid4()),  # belongs to ds-2
            session=_SessionReturning(policy=None),
        )


@pytest.mark.asyncio
async def test_upsert_grant_accepts_a_policy_on_this_data_source():
    policy_id = uuid4()
    grant = await DataSourceAccessService.upsert_grant(
        data_source_id="ds-1",
        organization_id="org-1",
        grantee_type="user",
        grantee_id=str(uuid4()),
        permissions=["view", "query"],
        created_by=None,
        rls_policy_id=str(policy_id),
        session=_SessionReturning(policy=SimpleNamespace(id=policy_id)),
    )
    assert grant.rls_policy_id == policy_id


@pytest.mark.asyncio
async def test_upsert_grant_accepts_a_column_policy_on_this_source():
    policy_id = uuid4()
    grant = await DataSourceAccessService.upsert_grant(
        data_source_id="ds-1",
        organization_id="org-1",
        grantee_type="user",
        grantee_id=str(uuid4()),
        permissions=["view", "query"],
        created_by=None,
        cls_policy_id=str(policy_id),
        session=_SessionReturning(cls_policy=SimpleNamespace(id=policy_id)),
    )
    assert grant.cls_policy_id == policy_id


@pytest.mark.asyncio
async def test_upsert_grant_rejects_a_column_policy_from_another_source():
    with pytest.raises(ValueError, match="column"):
        await DataSourceAccessService.upsert_grant(
            data_source_id="ds-1",
            organization_id="org-1",
            grantee_type="user",
            grantee_id=str(uuid4()),
            permissions=["view", "query"],
            created_by=None,
            cls_policy_id=str(uuid4()),
            session=_SessionReturning(cls_policy=None),
        )


@pytest.mark.asyncio
async def test_upsert_grant_rejects_a_grantee_that_does_not_exist():
    with pytest.raises(ValueError, match="exists"):
        await DataSourceAccessService.upsert_grant(
            data_source_id="ds-1",
            organization_id="org-1",
            grantee_type="user",
            grantee_id=str(uuid4()),
            permissions=["view"],
            created_by=None,
            session=_SessionReturning(policy=None, grantee=None),
        )


@pytest.mark.asyncio
async def test_upsert_grant_still_accepts_group_grantees():
    """Groups have no membership model yet, so they cannot be checked."""
    grant = await DataSourceAccessService.upsert_grant(
        data_source_id="ds-1",
        organization_id="org-1",
        grantee_type="group",
        grantee_id="group-1",
        permissions=["view"],
        created_by=None,
        session=_SessionReturning(policy=None, grantee=None),
    )
    assert grant.grantee_type == "group"


@pytest.mark.asyncio
async def test_upsert_grant_rejects_project_when_model_has_no_id(monkeypatch):
    class _Placeholder:
        pass

    monkeypatch.setattr("src.modules.project.models.Project", _Placeholder)
    session = _Session([])

    with pytest.raises(ValueError, match="exists"):
        await DataSourceAccessService.upsert_grant(
            data_source_id="ds-1",
            organization_id=str(uuid4()),
            grantee_type="project",
            grantee_id=str(uuid4()),
            permissions=["view"],
            created_by=None,
            session=session,
        )
    assert session.queries == []


@pytest.mark.asyncio
async def test_upsert_grant_rejects_a_project_from_another_organization(monkeypatch):
    _mapped_project(monkeypatch)
    organization_id = uuid4()
    project_id = uuid4()
    session = _Session([_ExecuteResult(scalar_one=None)])

    with pytest.raises(ValueError, match="exists"):
        await DataSourceAccessService.upsert_grant(
            data_source_id="ds-1",
            organization_id=str(organization_id),
            grantee_type="project",
            grantee_id=str(project_id),
            permissions=["view"],
            created_by=None,
            session=session,
        )

    assert len(session.queries) == 1
    sql = _query_sql(session.queries[0])
    assert "organization_id" in sql
    assert _query_contains_uuid(sql, organization_id)
    assert _query_contains_uuid(sql, project_id)
