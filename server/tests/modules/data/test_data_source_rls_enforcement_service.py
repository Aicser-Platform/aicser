import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401
pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")
from ee.modules.data.services import data_source_rls_enforcement_service as rls_mod
from src.modules.data.services.data_source_access_service import DataSourceAccessService
from ee.modules.data.services.data_source_rls_enforcement_service import (
    DataSourceRLSEnforcementService,
)


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _ExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarResult(self._rows)


class _Session:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _query):
        if not self._results:
            raise AssertionError("Unexpected execute call")
        return self._results.pop(0)


async def _user_attrs(*_args, **_kwargs):
    return {
        "user_id": "user-1",
        "region": "APAC",
        "organization_id": "org-1",
        "project_id": "project-1",
    }


@pytest.mark.asyncio
async def test_apply_sql_rls_wraps_query_with_policy_clause(monkeypatch):
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id,
        data_source_id="ds-1",
        enabled=True,
        default_deny=True,
    )
    rule = SimpleNamespace(
        policy_id=policy_id,
        column_name="region",
        operator="eq",
        value_type="user_attribute",
        value="region",
    )

    async def grants(*_args, **_kwargs):
        return [SimpleNamespace(rls_policy_id=policy_id)]

    monkeypatch.setattr(rls_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_applicable_grants",
        staticmethod(grants),
    )
    monkeypatch.setattr(
        DataSourceRLSEnforcementService,
        "_load_user_attributes",
        staticmethod(_user_attrs),
    )

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM orders",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session([_ExecuteResult([policy]), _ExecuteResult([rule])]),
    )

    assert applied is True
    assert query == "SELECT * FROM (SELECT * FROM orders) AS rls_q WHERE (region = 'APAC')"


@pytest.mark.asyncio
async def test_apply_sql_rls_bypasses_unrestricted_grant(monkeypatch):
    async def grants(*_args, **_kwargs):
        return [SimpleNamespace(rls_policy_id=None)]

    monkeypatch.setattr(rls_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_applicable_grants",
        staticmethod(grants),
    )

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM orders",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session([]),
    )

    assert applied is False
    assert query == "SELECT * FROM orders"


@pytest.mark.asyncio
async def test_apply_sql_rls_default_denies_missing_policy(monkeypatch):
    policy_id = uuid4()

    async def grants(*_args, **_kwargs):
        return [SimpleNamespace(rls_policy_id=policy_id)]

    monkeypatch.setattr(rls_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService,
        "get_applicable_grants",
        staticmethod(grants),
    )

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM orders",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session([_ExecuteResult([])]),
    )

    assert applied is True
    assert query == "SELECT * FROM (SELECT * FROM orders) AS rls_q WHERE 1 = 0"
