import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401
pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")
from ee.modules.data.services.data_source_rls_service import DataSourceRLSService


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ExecuteResult:
    def __init__(self, *, scalars=None, scalar_one=None):
        self._scalars = scalars or []
        self._scalar_one = scalar_one

    def scalars(self):
        return _ScalarResult(self._scalars)

    def scalar_one_or_none(self):
        return self._scalar_one


class _Session:
    def __init__(self, results):
        self._results = list(results)
        self.added = []
        self.executed = []

    async def execute(self, query):
        self.executed.append(query)
        if not self._results:
            raise AssertionError("Unexpected execute call")
        return self._results.pop(0)

    def add(self, row):
        self.added.append(row)


def _rule(**overrides):
    payload = {
        "table_name": "orders",
        "column_name": "region",
        "operator": "eq",
        "value_type": "user_attribute",
        "value": "region",
        "sort_order": 0,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


@pytest.mark.asyncio
async def test_create_policy_adds_policy_and_rules():
    organization_id = uuid4()
    user_id = uuid4()
    session = _Session([])

    policy, rules = await DataSourceRLSService.create_policy(
        data_source_id="ds-1",
        organization_id=str(organization_id),
        name="Regional sales",
        description="Limit rows by user region",
        enabled=True,
        default_deny=True,
        settings={"mode": "and"},
        rules=[_rule(), _rule(column_name="country", sort_order=1)],
        created_by=str(user_id),
        session=session,
    )

    assert session.added == [policy, *rules]
    assert policy.organization_id == organization_id
    assert policy.data_source_id == "ds-1"
    assert policy.name == "Regional sales"
    assert policy.created_by == user_id
    assert len(rules) == 2
    assert rules[0].policy_id == policy.id
    assert rules[1].sort_order == 1


@pytest.mark.asyncio
async def test_create_policy_rejects_invalid_operator():
    with pytest.raises(ValueError, match="Invalid RLS rule operator"):
        await DataSourceRLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            default_deny=True,
            settings={},
            rules=[_rule(operator="contains")],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_requires_fixed_value():
    with pytest.raises(ValueError, match="Fixed RLS rules require a value"):
        await DataSourceRLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            default_deny=True,
            settings={},
            rules=[_rule(value_type="fixed", value=None)],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_delete_policy_soft_deletes_policy_and_rules(monkeypatch):
    policy = SimpleNamespace(
        is_active=True,
        is_deleted=False,
        deleted_at=None,
    )
    rule = SimpleNamespace(
        is_active=True,
        is_deleted=False,
        deleted_at=None,
    )

    async def get_policy(*_args, **_kwargs):
        return policy, [rule]

    monkeypatch.setattr(
        DataSourceRLSService,
        "get_policy",
        staticmethod(get_policy),
    )

    assert await DataSourceRLSService.delete_policy(
        data_source_id="ds-1",
        policy_id=str(uuid4()),
        session=_Session([]),
    )
    assert policy.is_active is False
    assert policy.is_deleted is True
    assert policy.deleted_at is not None
    assert rule.is_active is False
    assert rule.is_deleted is True
    assert rule.deleted_at == policy.deleted_at


@pytest.mark.asyncio
async def test_update_policy_soft_deletes_replaced_rules(monkeypatch):
    policy = SimpleNamespace(
        id=uuid4(),
        name="Old name",
        description=None,
        enabled=True,
        default_deny=True,
        settings={},
    )
    old_rule = SimpleNamespace(
        is_active=True,
        is_deleted=False,
        deleted_at=None,
    )
    session = _Session([])

    async def get_policy(*_args, **_kwargs):
        return policy, [old_rule]

    monkeypatch.setattr(
        DataSourceRLSService,
        "get_policy",
        staticmethod(get_policy),
    )

    updated = await DataSourceRLSService.update_policy(
        data_source_id="ds-1",
        policy_id=str(policy.id),
        name="New name",
        description="Updated",
        enabled=False,
        default_deny=False,
        settings={"mode": "or"},
        rules=[_rule(column_name="country")],
        session=session,
    )

    assert updated is not None
    updated_policy, new_rules = updated
    assert updated_policy is policy
    assert policy.name == "New name"
    assert policy.enabled is False
    assert old_rule.is_active is False
    assert old_rule.is_deleted is True
    assert old_rule.deleted_at is not None
    assert len(new_rules) == 1
    assert session.added == new_rules
