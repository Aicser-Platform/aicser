import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

os.environ["DEBUG"] = "false"

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")

import src.db.registry  # noqa: F401
from ee.modules.data.services import data_source_rls_enforcement_service as rls_mod
from ee.modules.data.services.data_source_rls_enforcement_service import (
    DataSourceRLSEnforcementService,
)
from ee.modules.data.services.rls_predicate_builder import resolve_dialect
from src.modules.data.services.data_source_access_service import DataSourceAccessService


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _ScalarResult(self._rows)


class _Session:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _query):
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_file_source_dialect_reaches_the_predicate(monkeypatch):
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=True
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

    async def attrs(*_args, **_kwargs):
        return {"region": "Acme\\"}

    seen_dialects = []
    original_build_condition = rls_mod.build_condition

    def capture_build_condition(rule, value, dialect):
        seen_dialects.append(dialect)
        return original_build_condition(rule, value, dialect)

    monkeypatch.setattr(rls_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(rls_mod, "build_condition", capture_build_condition)
    monkeypatch.setattr(
        DataSourceAccessService, "get_applicable_grants", staticmethod(grants)
    )
    monkeypatch.setattr(
        DataSourceRLSEnforcementService, "_load_user_attributes", staticmethod(attrs)
    )

    file_source = {"type": "file", "format": "csv"}
    dialect = resolve_dialect(file_source)
    assert dialect == "duckdb"

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM orders",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id=None,
        token_payload={},
        session=_Session([_ExecuteResult([policy]), _ExecuteResult([rule])]),
        dialect=dialect,
    )

    assert applied is True
    assert seen_dialects == ["duckdb"]
    assert "Acme\\" in query
    assert query.count("'") % 2 == 0
