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
    assert (
        query == "SELECT * FROM (SELECT * FROM orders) AS rls_q WHERE (region = 'APAC')"
    )


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


@pytest.mark.asyncio
async def test_load_user_attributes_includes_project_settings():
    user_id = uuid4()
    organization_id = uuid4()
    project_id = uuid4()
    user = SimpleNamespace(
        id=user_id,
        user_id=user_id,
        email="analyst@example.com",
        username="analyst",
        first_name=None,
        last_name=None,
        role="member",
        status="active",
        tenant_id="default",
        company=None,
        location=None,
        timezone=None,
        job_role=None,
        industry=None,
        company_size=None,
        data_experience=None,
        primary_use_case=None,
        data_frequency=None,
        settings={"locale": "en"},
        onboarding_data=None,
    )
    organization = SimpleNamespace(
        id=organization_id,
        name="Acme",
        settings={"region": "APAC"},
    )
    project = SimpleNamespace(
        id=project_id,
        name="Sales",
        settings={"customer_name": "Alice Johnson"},
    )

    attrs = await DataSourceRLSEnforcementService._load_user_attributes(
        str(user_id),
        organization_id=str(organization_id),
        project_id=str(project_id),
        token_payload={},
        session=_Session(
            [
                _ExecuteResult([user]),
                _ExecuteResult([organization]),
                _ExecuteResult([project]),
            ]
        ),
    )

    assert attrs["user"]["email"] == "analyst@example.com"
    assert attrs["org"]["region"] == "APAC"
    assert attrs["project"]["customer_name"] == "Alice Johnson"


def test_project_attribute_rule_reads_loaded_project_namespace():
    rule = SimpleNamespace(
        column_name="customer_name",
        operator="eq",
        value_type="project_attribute",
        value="customer_name",
    )

    clause = DataSourceRLSEnforcementService._rule_clause(
        rule,
        {"project": {"customer_name": "Alice Johnson"}},
    )

    assert clause == "customer_name = 'Alice Johnson'"


def _scoped_rule(policy_id, table_name):
    return SimpleNamespace(
        policy_id=policy_id,
        table_name=table_name,
        column_name="customer_id",
        operator="eq",
        value_type="user_attribute",
        value="region",
    )


def _patch_common(monkeypatch, policy_id):
    async def grants(*_args, **_kwargs):
        return [SimpleNamespace(rls_policy_id=policy_id)]

    monkeypatch.setattr(rls_mod, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(
        DataSourceAccessService, "get_applicable_grants", staticmethod(grants)
    )
    monkeypatch.setattr(
        DataSourceRLSEnforcementService,
        "_load_user_attributes",
        staticmethod(_user_attrs),
    )


@pytest.mark.asyncio
async def test_policy_scoped_to_another_table_is_not_applied(monkeypatch):
    """A filter on fact_orders must not be injected into a dim_product query.

    Previously this produced: Binder Error: Referenced column "customer_id"
    not found in FROM clause.
    """
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=True
    )
    _patch_common(monkeypatch, policy_id)

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM dim_product LIMIT 1000",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session(
            [
                _ExecuteResult([policy]),
                _ExecuteResult([_scoped_rule(policy_id, "fact_orders")]),
            ]
        ),
    )

    assert applied is False
    assert query == "SELECT * FROM dim_product LIMIT 1000"


@pytest.mark.asyncio
async def test_policy_scoped_to_the_queried_table_still_applies(monkeypatch):
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=True
    )
    _patch_common(monkeypatch, policy_id)

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM fact_orders",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session(
            [
                _ExecuteResult([policy]),
                _ExecuteResult([_scoped_rule(policy_id, "fact_orders")]),
            ]
        ),
    )

    assert applied is True
    assert "customer_id = 'APAC'" in query


@pytest.mark.asyncio
async def test_scoping_tolerates_physical_table_prefixes(monkeypatch):
    """File sources materialise dim_product as sheet_2_dim_product.

    The rule stores the logical name from the schema, so matching must survive
    the physical prefix or scoping would silently disable every file-source policy.
    """
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=True
    )
    _patch_common(monkeypatch, policy_id)

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        'SELECT * FROM "sheet_2_dim_product" LIMIT 1000',
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session(
            [
                _ExecuteResult([policy]),
                _ExecuteResult([_scoped_rule(policy_id, "dim_product")]),
            ]
        ),
    )

    assert applied is True


@pytest.mark.asyncio
async def test_rule_without_a_table_name_still_applies_everywhere(monkeypatch):
    """Back-compat guard: unscoped rules predate table scoping.

    Treating a blank table_name as "matches nothing" would silently switch off
    every existing policy — a security regression, not a fix.
    """
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=True
    )
    _patch_common(monkeypatch, policy_id)

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM anything_at_all",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session(
            [_ExecuteResult([policy]), _ExecuteResult([_scoped_rule(policy_id, "")])]
        ),
    )

    assert applied is True
    assert "customer_id = 'APAC'" in query


@pytest.mark.asyncio
async def test_unparseable_query_falls_back_to_applying_the_filter(monkeypatch):
    """If the query cannot be parsed we cannot prove the table is unrelated,
    so the filter is applied rather than skipped. Fail closed."""
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=True
    )
    _patch_common(monkeypatch, policy_id)

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "!!! not sql at all !!!",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session(
            [
                _ExecuteResult([policy]),
                _ExecuteResult([_scoped_rule(policy_id, "fact_orders")]),
            ]
        ),
    )

    assert applied is True


@pytest.mark.asyncio
async def test_applicable_policy_that_resolves_to_nothing_still_denies(monkeypatch):
    """Fail closed when a policy governs this table but cannot be resolved.

    Distinct from "no policy targets this table", which legitimately means no
    filter. Here the policy applies and its rules produced nothing, so falling
    through unfiltered would hand over every row.
    """
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=False
    )
    _patch_common(monkeypatch, policy_id)

    # value_type user_attribute with a key that _user_attrs does not provide
    rule = SimpleNamespace(
        policy_id=policy_id,
        table_name="fact_orders",
        column_name="customer_id",
        operator="eq",
        value_type="user_attribute",
        value="nonexistent_attribute",
    )

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM fact_orders",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session([_ExecuteResult([policy]), _ExecuteResult([rule])]),
    )

    assert applied is True
    assert "1 = 0" in query


@pytest.mark.asyncio
async def test_no_applicable_policy_still_means_no_filter(monkeypatch):
    """The dim_product fix must survive the deny-on-failure change above."""
    policy_id = uuid4()
    policy = SimpleNamespace(
        id=policy_id, data_source_id="ds-1", enabled=True, default_deny=True
    )
    _patch_common(monkeypatch, policy_id)

    query, applied = await DataSourceRLSEnforcementService.apply_sql_rls(
        "SELECT * FROM dim_product",
        user_id="user-1",
        data_source_id="ds-1",
        organization_id="org-1",
        project_id="project-1",
        token_payload={},
        session=_Session(
            [
                _ExecuteResult([policy]),
                _ExecuteResult([_scoped_rule(policy_id, "fact_orders")]),
            ]
        ),
    )

    assert applied is False
    assert query == "SELECT * FROM dim_product"
