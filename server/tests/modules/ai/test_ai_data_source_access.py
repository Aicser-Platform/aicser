"""The AI analyze path honours data-source grants, not just ownership.

`validate_data_source_access` predates data-source grants: it compared the
source's own project to the caller's and denied on any mismatch. Sharing a
source with another project therefore made it unusable from the chat panel —
the grantee was rejected before row security ever ran — while the SQL editor,
which goes through `DataSourceAccessService`, worked.
"""

import os

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401
from ee.modules.ai.services import data_source_access as dsa

OWNER_PROJECT = "11111111-1111-1111-1111-111111111111"
GRANTEE_PROJECT = "22222222-2222-2222-2222-222222222222"
STRANGER_PROJECT = "33333333-3333-3333-3333-333333333333"


class _DataService:
    def __init__(self, source):
        self._source = source

    async def get_data_source_by_id(self, _data_source_id):
        return self._source


def _shared_source():
    return {
        "id": "db_mysql_1",
        "user_id": "owner-1",
        "project_id": OWNER_PROJECT,
        "tenant_id": "org-1",
    }


def _grant_to(*projects):
    async def _can_access(
        user_id, data_source_id, permission, *, project_id=None, **_kw
    ):
        return str(project_id) in {str(p) for p in projects}

    return _can_access


@pytest.mark.asyncio
async def test_granted_project_may_use_a_source_owned_by_another_project(monkeypatch):
    monkeypatch.setattr(
        dsa.DataSourceAccessService,
        "can_access",
        staticmethod(_grant_to(GRANTEE_PROJECT)),
    )

    source, error = await dsa.validate_data_source_access(
        _DataService(_shared_source()),
        "db_mysql_1",
        user_id="member-2",
        organization_id="org-1",
        project_id=GRANTEE_PROJECT,
    )

    assert error is None
    assert source is not None


@pytest.mark.asyncio
async def test_project_without_a_grant_is_still_denied(monkeypatch):
    monkeypatch.setattr(
        dsa.DataSourceAccessService,
        "can_access",
        staticmethod(_grant_to(GRANTEE_PROJECT)),
    )

    source, error = await dsa.validate_data_source_access(
        _DataService(_shared_source()),
        "db_mysql_1",
        user_id="member-3",
        organization_id="org-1",
        project_id=STRANGER_PROJECT,
    )

    assert source is None
    assert error


@pytest.mark.asyncio
async def test_owning_project_still_passes_without_consulting_grants(monkeypatch):
    async def _explode(*_args, **_kwargs):
        raise AssertionError("owner access must not depend on the grant table")

    monkeypatch.setattr(
        dsa.DataSourceAccessService, "can_access", staticmethod(_explode)
    )

    source, error = await dsa.validate_data_source_access(
        _DataService(_shared_source()),
        "db_mysql_1",
        user_id="owner-1",
        organization_id="org-1",
        project_id=OWNER_PROJECT,
    )

    assert error is None
    assert source is not None


@pytest.mark.asyncio
async def test_a_failing_grant_lookup_denies_rather_than_allows(monkeypatch):
    """An unavailable grant service must not read as permission."""

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("grant table unreachable")

    monkeypatch.setattr(dsa.DataSourceAccessService, "can_access", staticmethod(_boom))

    source, error = await dsa.validate_data_source_access(
        _DataService(_shared_source()),
        "db_mysql_1",
        user_id="member-2",
        organization_id="org-1",
        project_id=GRANTEE_PROJECT,
    )

    assert source is None
    assert error


@pytest.mark.asyncio
async def test_a_user_grant_works_without_any_project_context(monkeypatch):
    """A grant to the person, reached via the org-mismatch branch."""

    async def _can_access(user_id, _data_source_id, _permission, **_kw):
        return str(user_id) == "member-2"

    monkeypatch.setattr(
        dsa.DataSourceAccessService, "can_access", staticmethod(_can_access)
    )

    source, error = await dsa.validate_data_source_access(
        _DataService(_shared_source()),
        "db_mysql_1",
        user_id="member-2",
        organization_id="other-org",
        project_id=None,
    )

    assert error is None
    assert source is not None
