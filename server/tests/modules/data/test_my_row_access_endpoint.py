"""Tests for GET /data/sources/{id}/my-row-access.

This endpoint exists so a query-only user can see WHY their own results were
row-filtered, without needing the admin-gated rls-policies/access-grants/
preview endpoints. The entire point of the endpoint is that it can only ever
describe the AUTHENTICATED CALLER'S OWN access -- never anyone else's -- so
the cross-user leakage test below is the one that matters most.
"""

import inspect
import os
import uuid
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")

import src.db.registry  # noqa: F401
from ee.modules.data.services import data_source_rls_enforcement_service as rls_mod
from fastapi import HTTPException

from src.modules.data import router as data_router
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


class _RecordingSession:
    """Fake AsyncSession that filters canned rows by the ids the query actually binds.

    Real Postgres would filter ``DataSourceRLSPolicy.id.in_(policy_ids)`` at the
    database layer -- the point of this fake is to reproduce that filtering
    from the compiled statement's literal bind values, instead of trusting a
    hand-picked list of "expected" rows. That is what makes the cross-user
    leakage test meaningful: even though both users' policies live in
    ``all_policies``/``all_rules_by_policy`` here, only the ids actually bound
    into the query come back.
    """

    def __init__(
        self,
        all_policies,
        all_rules_by_policy,
        *,
        all_cls_policies=None,
        all_cls_rules_by_policy=None,
    ):
        self._all_policies = {policy.id: policy for policy in all_policies}
        self._all_rules_by_policy = all_rules_by_policy
        self._all_cls_policies = {
            policy.id: policy for policy in (all_cls_policies or [])
        }
        self._all_cls_rules_by_policy = all_cls_rules_by_policy or {}
        self.bound_policy_ids = None
        self.bound_cls_policy_ids = None

    async def execute(self, stmt):
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        # The UUID literal binds render as bare hex (no dashes), so match on
        # ``.hex`` rather than ``str(uuid)``.
        if "FROM data_source_rls_policies" in compiled:
            ids = [pid for pid in self._all_policies if pid.hex in compiled]
            self.bound_policy_ids = ids
            return _ExecuteResult([self._all_policies[pid] for pid in ids])
        if "FROM data_source_rls_rules" in compiled:
            ids = [pid for pid in self._all_rules_by_policy if pid.hex in compiled]
            rows = []
            for pid in ids:
                rows.extend(self._all_rules_by_policy[pid])
            return _ExecuteResult(rows)
        if "FROM data_source_cls_policies" in compiled:
            ids = [pid for pid in self._all_cls_policies if pid.hex in compiled]
            self.bound_cls_policy_ids = ids
            return _ExecuteResult([self._all_cls_policies[pid] for pid in ids])
        if "FROM data_source_cls_rules" in compiled:
            ids = [pid for pid in self._all_cls_rules_by_policy if pid.hex in compiled]
            rows = []
            for pid in ids:
                rows.extend(self._all_cls_rules_by_policy[pid])
            return _ExecuteResult(rows)
        raise AssertionError(f"Unexpected query:\n{compiled}")


def _policy(**kwargs):
    base = dict(
        id=uuid.uuid4(),
        data_source_id="ds-1",
        name="Region policy",
        enabled=True,
        default_deny=True,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def _rule(policy_id, **kwargs):
    base = dict(
        policy_id=policy_id,
        table_name="orders",
        column_name="region",
        operator="eq",
        value_type="user_attribute",
        value="region",
        sort_order=0,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def _cls_policy(**kwargs):
    base = dict(
        id=uuid.uuid4(),
        data_source_id="ds-1",
        name="PII policy",
        enabled=True,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def _cls_rule(policy_id, **kwargs):
    base = dict(
        policy_id=policy_id,
        table_name="users",
        column_name="email",
        action="mask",
        mask_strategy="hash",
        mask_config={},
        sort_order=0,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def _attrs_for(region: str):
    async def _load(*_args, **_kwargs):
        return {"user_id": "user-1", "region": region}

    return _load


def _fake_data_source():
    return SimpleNamespace(id="ds-1", type=None, db_type=None, organization_id=None)


def _patch_permission(monkeypatch, *, allow_user_id: str):
    async def active_source(_db, _data_source_id):
        return _fake_data_source()

    async def can_access(user_id, _data_source_id, _permission, **_kwargs):
        return str(user_id) == allow_user_id

    monkeypatch.setattr(data_router, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(data_router, "_get_active_data_source_or_404", active_source)
    monkeypatch.setattr(DataSourceAccessService, "can_access", staticmethod(can_access))


@pytest.mark.asyncio
async def test_caller_with_policy_grant_gets_that_policy_and_predicates(monkeypatch):
    policy_id = uuid.uuid4()
    policy = _policy(id=policy_id, name="APAC only")
    rule = _rule(policy_id, table_name="orders", column_name="region")

    _patch_permission(monkeypatch, allow_user_id="user-1")

    async def grants(user_id, _data_source_id, _permission, **_kwargs):
        assert user_id == "user-1"
        return [SimpleNamespace(rls_policy_id=policy_id, cls_policy_id=None)]

    monkeypatch.setattr(
        DataSourceAccessService, "get_applicable_grants", staticmethod(grants)
    )
    monkeypatch.setattr(
        rls_mod.DataSourceRLSEnforcementService,
        "_load_user_attributes",
        staticmethod(_attrs_for("APAC")),
    )

    session = _RecordingSession([policy], {policy_id: [rule]})

    result = await data_router.get_my_data_source_row_access(
        "ds-1",
        current_token={"id": "user-1"},
        db=session,
    )

    assert result["success"] is True
    assert result["unrestricted"] is False
    assert len(result["policies"]) == 1
    returned = result["policies"][0]
    assert returned["id"] == str(policy_id)
    assert returned["name"] == "APAC only"
    assert returned["default_deny"] is True
    assert returned["predicates"] == [{"table": "orders", "sql": "(region = 'APAC')"}]
    assert result["denies_ungoverned_tables"] is True
    assert result["columns"] == {"denied": [], "masked": []}


@pytest.mark.asyncio
async def test_caller_with_unrestricted_grant_gets_no_policies(monkeypatch):
    _patch_permission(monkeypatch, allow_user_id="user-1")

    async def grants(*_args, **_kwargs):
        return [SimpleNamespace(rls_policy_id=None)]

    monkeypatch.setattr(
        DataSourceAccessService, "get_applicable_grants", staticmethod(grants)
    )

    result = await data_router.get_my_data_source_row_access(
        "ds-1",
        current_token={"id": "user-1"},
        db=object(),  # must never be queried on the unrestricted path
    )

    assert result == {
        "success": True,
        "unrestricted": True,
        "policies": [],
        "denies_ungoverned_tables": False,
        "columns": {"denied": [], "masked": []},
    }


@pytest.mark.asyncio
async def test_caller_without_any_grant_is_rejected(monkeypatch):
    # can_access() denies everyone; this is the existing permission helper's
    # job, not something this endpoint reimplements.
    _patch_permission(monkeypatch, allow_user_id="__nobody__")

    with pytest.raises(HTTPException) as exc_info:
        await data_router.get_my_data_source_row_access(
            "ds-1",
            current_token={"id": "user-1"},
            db=object(),
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_another_users_policy_is_never_returned(monkeypatch):
    """The security test. A policy reachable only through USER-2's grant must
    never appear in USER-1's response, even though it lives in the same
    data-source's policy/rule tables that our SQL queries would scan.
    """
    user1_policy_id = uuid.uuid4()
    user2_policy_id = uuid.uuid4()
    user1_policy = _policy(id=user1_policy_id, name="User 1 policy")
    user2_policy = _policy(id=user2_policy_id, name="User 2 policy (not caller's)")
    user1_rule = _rule(user1_policy_id, table_name="orders", column_name="region")
    user2_rule = _rule(user2_policy_id, table_name="salaries", column_name="dept")

    _patch_permission(monkeypatch, allow_user_id="user-1")

    async def grants(user_id, _data_source_id, _permission, **_kwargs):
        # Simulate DataSourceAccessService correctly scoping grants per caller:
        # user-1's own grants only ever reference user-1's own policy.
        assert user_id == "user-1"
        return [SimpleNamespace(rls_policy_id=user1_policy_id, cls_policy_id=None)]

    monkeypatch.setattr(
        DataSourceAccessService, "get_applicable_grants", staticmethod(grants)
    )
    monkeypatch.setattr(
        rls_mod.DataSourceRLSEnforcementService,
        "_load_user_attributes",
        staticmethod(_attrs_for("APAC")),
    )

    # Both policies (and both policies' rules) exist in the underlying tables --
    # this reproduces a shared data-source with more than one grantee's policy
    # present, not a database that has been pre-filtered for the test.
    session = _RecordingSession(
        [user1_policy, user2_policy],
        {user1_policy_id: [user1_rule], user2_policy_id: [user2_rule]},
    )

    result = await data_router.get_my_data_source_row_access(
        "ds-1",
        current_token={"id": "user-1"},
        db=session,
    )

    policy_ids_returned = {p["id"] for p in result["policies"]}
    policy_names_returned = {p["name"] for p in result["policies"]}
    tables_touched = {
        predicate["table"]
        for policy in result["policies"]
        for predicate in policy["predicates"]
    }

    assert policy_ids_returned == {str(user1_policy_id)}
    assert str(user2_policy_id) not in policy_ids_returned
    assert "User 2 policy (not caller's)" not in policy_names_returned
    assert "salaries" not in tables_touched
    # Also prove it at the query layer: only user-1's policy id was ever bound
    # into the SQL sent to load policies.
    assert session.bound_policy_ids == [user1_policy_id]


@pytest.mark.asyncio
async def test_caller_with_column_policy_sees_denied_and_masked_columns(monkeypatch):
    deny_policy_id = uuid.uuid4()
    mask_policy_id = uuid.uuid4()
    deny_policy = _cls_policy(id=deny_policy_id, name="Deny secrets")
    mask_policy = _cls_policy(id=mask_policy_id, name="Hash emails")
    deny_rule = _cls_rule(
        deny_policy_id,
        table_name="users",
        column_name="password",
        action="deny",
        mask_strategy=None,
    )
    mask_rule = _cls_rule(
        mask_policy_id,
        table_name="users",
        column_name="email",
        action="mask",
        mask_strategy="hash",
    )

    _patch_permission(monkeypatch, allow_user_id="user-1")

    async def grants(user_id, _data_source_id, _permission, **_kwargs):
        assert user_id == "user-1"
        return [
            SimpleNamespace(rls_policy_id=None, cls_policy_id=deny_policy_id),
            SimpleNamespace(rls_policy_id=None, cls_policy_id=mask_policy_id),
        ]

    monkeypatch.setattr(
        DataSourceAccessService, "get_applicable_grants", staticmethod(grants)
    )

    session = _RecordingSession(
        [],
        {},
        all_cls_policies=[deny_policy, mask_policy],
        all_cls_rules_by_policy={
            deny_policy_id: [deny_rule],
            mask_policy_id: [mask_rule],
        },
    )

    result = await data_router.get_my_data_source_row_access(
        "ds-1",
        current_token={"id": "user-1"},
        db=session,
    )

    assert result["unrestricted"] is True
    assert result["policies"] == []
    assert result["columns"] == {
        "denied": ["users.password"],
        "masked": [{"column": "users.email", "strategy": "hash"}],
    }
    assert session.bound_cls_policy_ids == [deny_policy_id, mask_policy_id]


@pytest.mark.asyncio
async def test_another_users_column_policy_is_never_returned(monkeypatch):
    user1_policy_id = uuid.uuid4()
    user2_policy_id = uuid.uuid4()
    user1_policy = _cls_policy(id=user1_policy_id, name="User 1 columns")
    user2_policy = _cls_policy(id=user2_policy_id, name="User 2 columns")
    user1_rule = _cls_rule(user1_policy_id, table_name="users", column_name="email")
    user2_rule = _cls_rule(user2_policy_id, table_name="payroll", column_name="salary")

    _patch_permission(monkeypatch, allow_user_id="user-1")

    async def grants(user_id, _data_source_id, _permission, **_kwargs):
        assert user_id == "user-1"
        return [SimpleNamespace(rls_policy_id=None, cls_policy_id=user1_policy_id)]

    monkeypatch.setattr(
        DataSourceAccessService, "get_applicable_grants", staticmethod(grants)
    )

    session = _RecordingSession(
        [],
        {},
        all_cls_policies=[user1_policy, user2_policy],
        all_cls_rules_by_policy={
            user1_policy_id: [user1_rule],
            user2_policy_id: [user2_rule],
        },
    )

    result = await data_router.get_my_data_source_row_access(
        "ds-1",
        current_token={"id": "user-1"},
        db=session,
    )

    assert result["columns"] == {
        "denied": [],
        "masked": [{"column": "users.email", "strategy": "hash"}],
    }
    assert "payroll.salary" not in str(result["columns"])
    assert session.bound_cls_policy_ids == [user1_policy_id]


def test_endpoint_accepts_no_impersonation_parameter():
    params = inspect.signature(data_router.get_my_data_source_row_access).parameters
    allowed = {"data_source_id", "current_token", "db"}
    assert set(params) == allowed
    for suspicious in ("user_id", "project_id", "simulate_user_id", "as_user", "target_user_id"):
        assert suspicious not in params
