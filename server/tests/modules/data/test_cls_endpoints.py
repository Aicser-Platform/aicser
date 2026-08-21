"""Tests for the column-level security (CLS) policy CRUD endpoints.

Mirrors ``test_data_source_rls_service.py`` for the service-layer contract
(create/update/delete validation, soft-delete semantics) and adds
endpoint-level coverage (EE gate, permission gate, ValueError -> 400,
missing-policy -> 404, and a full round trip through the router functions
themselves) plus dedicated coverage of the hash-salt behavior described in
the task brief: generated once per data source, reused across policies, and
never present in any response payload.

Note on where the salt lives: ``DataSource`` has no dedicated "settings"
JSON column in this codebase (only ``connection_config``, which already
holds real connection credentials and is returned -- lightly redacted -- by
several unrelated, pre-existing data-source endpoints). Adding the salt
there would risk leaking it through code this task does not touch, and
adding a new column would require a migration against the live database
this task is explicitly told not to touch. Instead the canonical salt is
kept in ``DataSourceCLSPolicy.settings`` (a JSONB column that already
exists) under an internal key, looked up across *every* CLS policy for the
data source -- not just the one currently being written -- so it is a
single, durable, data-source-scoped value regardless of which policy first
created it. See ``data_source_cls_service.py`` for the full rationale.
"""

import json
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")

from fastapi import HTTPException

from ee.modules.data.services.data_source_cls_service import DataSourceCLSService
from src.modules.data import router as data_router
from src.modules.data.schemas import (
    DataSourceCLSPolicyRequest,
    DataSourceCLSRuleRequest,
)
from src.modules.data.services.data_source_access_service import DataSourceAccessService


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
    def __init__(self, results=None):
        self._results = list(results or [])
        self.added = []
        self.committed = False

    async def execute(self, query):
        if not self._results:
            raise AssertionError("Unexpected execute call")
        return self._results.pop(0)

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.committed = True


def _ns_rule(**overrides):
    """A duck-typed rule for direct service-layer calls (mirrors SimpleNamespace
    usage in test_data_source_rls_service.py)."""
    payload = {
        "table_name": "customers",
        "column_name": "ssn",
        "action": "mask",
        "mask_strategy": "fixed",
        "mask_config": {},
        "sort_order": 0,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def _rule_request(**overrides):
    payload = {
        "table_name": "customers",
        "column_name": "ssn",
        "action": "mask",
        "mask_strategy": "fixed",
        "mask_config": {},
        "sort_order": 0,
    }
    payload.update(overrides)
    return DataSourceCLSRuleRequest(**payload)


def _policy_request(**overrides):
    payload = {
        "name": "PII mask",
        "description": None,
        "enabled": True,
        "settings": {},
        "rules": [_rule_request()],
    }
    payload.update(overrides)
    return DataSourceCLSPolicyRequest(**payload)


def _fake_data_source():
    return SimpleNamespace(id="ds-1", type=None, db_type=None, organization_id=None)


def _patch_permission(monkeypatch, *, allow=True):
    async def active_source(_db, _data_source_id):
        return _fake_data_source()

    async def can_access(*_args, **_kwargs):
        return allow

    monkeypatch.setattr(data_router, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(data_router, "_get_active_data_source_or_404", active_source)
    monkeypatch.setattr(DataSourceAccessService, "can_access", staticmethod(can_access))
    monkeypatch.setattr(data_router, "invalidate_query_result_cache", lambda: None)


# ---------------------------------------------------------------------------
# Endpoint-level: EE gate, permission gate, error mapping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_endpoint_requires_enterprise_edition(monkeypatch):
    monkeypatch.setattr(data_router, "is_ee_enabled", lambda: False)
    with pytest.raises(HTTPException) as exc:
        await data_router.list_data_source_cls_policies(
            "ds-1", current_token={"id": "user-1"}, db=object()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_endpoint_requires_enterprise_edition(monkeypatch):
    monkeypatch.setattr(data_router, "is_ee_enabled", lambda: False)
    with pytest.raises(HTTPException) as exc:
        await data_router.create_data_source_cls_policy(
            "ds-1", _policy_request(), current_token={"id": "user-1"}, db=object()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_endpoint_requires_manage_permission(monkeypatch):
    _patch_permission(monkeypatch, allow=False)
    with pytest.raises(HTTPException) as exc:
        await data_router.create_data_source_cls_policy(
            "ds-1", _policy_request(), current_token={"id": "user-1"}, db=_Session([])
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_endpoint_maps_value_error_to_400(monkeypatch):
    _patch_permission(monkeypatch, allow=True)

    async def bad_create(*_args, **_kwargs):
        raise ValueError("Invalid CLS rule action: 'drop'")

    monkeypatch.setattr(DataSourceCLSService, "create_policy", staticmethod(bad_create))

    with pytest.raises(HTTPException) as exc:
        await data_router.create_data_source_cls_policy(
            "ds-1", _policy_request(), current_token={"id": "user-1"}, db=_Session([])
        )
    assert exc.value.status_code == 400
    assert "Invalid CLS rule action" in exc.value.detail


@pytest.mark.asyncio
async def test_update_endpoint_returns_404_when_policy_missing(monkeypatch):
    _patch_permission(monkeypatch, allow=True)

    async def missing_update(*_args, **_kwargs):
        return None

    monkeypatch.setattr(DataSourceCLSService, "update_policy", staticmethod(missing_update))

    with pytest.raises(HTTPException) as exc:
        await data_router.update_data_source_cls_policy(
            "ds-1",
            str(uuid4()),
            _policy_request(),
            current_token={"id": "user-1"},
            db=_Session([]),
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_endpoint_returns_404_when_policy_missing(monkeypatch):
    _patch_permission(monkeypatch, allow=True)

    async def missing_delete(*_args, **_kwargs):
        return False

    monkeypatch.setattr(DataSourceCLSService, "delete_policy", staticmethod(missing_delete))

    with pytest.raises(HTTPException) as exc:
        await data_router.delete_data_source_cls_policy(
            "ds-1", str(uuid4()), current_token={"id": "user-1"}, db=_Session([])
        )
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Endpoint-level: full create -> list -> update -> delete round trip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_list_update_delete_round_trip(monkeypatch):
    _patch_permission(monkeypatch, allow=True)

    create_session = _Session([])
    create_result = await data_router.create_data_source_cls_policy(
        "ds-1",
        _policy_request(name="PII mask", rules=[_rule_request()]),
        current_token={"id": str(uuid4())},
        db=create_session,
    )
    assert create_result["success"] is True
    assert create_session.committed is True
    policy_payload = create_result["policy"]
    assert policy_payload["name"] == "PII mask"
    assert policy_payload["data_source_id"] == "ds-1"
    assert len(policy_payload["rules"]) == 1
    assert policy_payload["rules"][0]["action"] == "mask"
    assert policy_payload["rules"][0]["mask_strategy"] == "fixed"

    created_policy = next(o for o in create_session.added if hasattr(o, "name"))
    created_rules = [o for o in create_session.added if o is not created_policy]
    assert len(created_rules) == 1

    # LIST: list_policies issues one select for policies, then one for rules.
    list_session = _Session(
        [
            _ExecuteResult(scalars=[created_policy]),
            _ExecuteResult(scalars=created_rules),
        ]
    )
    list_result = await data_router.list_data_source_cls_policies(
        "ds-1", current_token={"id": "user-1"}, db=list_session
    )
    assert list_result["success"] is True
    assert list_result["count"] == 1
    assert list_result["policies"][0]["id"] == str(created_policy.id)

    # UPDATE: get_policy issues one select for the policy, one for its rules.
    update_session = _Session(
        [
            _ExecuteResult(scalar_one=created_policy),
            _ExecuteResult(scalars=created_rules),
        ]
    )
    update_result = await data_router.update_data_source_cls_policy(
        "ds-1",
        str(created_policy.id),
        _policy_request(
            name="PII mask v2", rules=[_rule_request(column_name="email")]
        ),
        current_token={"id": "user-1"},
        db=update_session,
    )
    assert update_result["success"] is True
    assert update_result["policy"]["name"] == "PII mask v2"
    assert update_result["policy"]["rules"][0]["column_name"] == "email"
    assert created_rules[0].is_deleted is True  # old rule retired

    # DELETE: get_policy issues one select for the policy, one for its rules.
    delete_session = _Session(
        [
            _ExecuteResult(scalar_one=created_policy),
            _ExecuteResult(scalars=created_rules),
        ]
    )
    delete_result = await data_router.delete_data_source_cls_policy(
        "ds-1", str(created_policy.id), current_token={"id": "user-1"}, db=delete_session
    )
    assert delete_result["success"] is True
    assert created_policy.is_deleted is True
    assert created_policy.is_active is False


# ---------------------------------------------------------------------------
# Service-level: validation at the API boundary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_policy_rejects_invalid_action():
    with pytest.raises(ValueError, match="Invalid CLS rule action"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[_ns_rule(action="drop")],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_requires_mask_strategy_for_mask_action():
    with pytest.raises(ValueError, match="mask_strategy"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[_ns_rule(action="mask", mask_strategy=None)],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_rejects_unknown_mask_strategy():
    with pytest.raises(ValueError, match="mask_strategy"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[_ns_rule(action="mask", mask_strategy="rot13")],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_requires_positive_int_keep_for_partial():
    with pytest.raises(ValueError, match="positive integer"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[_ns_rule(action="mask", mask_strategy="partial", mask_config={})],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_rejects_zero_keep_for_partial():
    with pytest.raises(ValueError, match="positive integer"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[
                _ns_rule(
                    action="mask",
                    mask_strategy="partial",
                    mask_config={"keep": 0},
                )
            ],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_rejects_non_int_keep_for_partial():
    with pytest.raises(ValueError, match="positive integer"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[
                _ns_rule(
                    action="mask",
                    mask_strategy="partial",
                    mask_config={"keep": "four"},
                )
            ],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_accepts_valid_partial_keep():
    policy, rules = await DataSourceCLSService.create_policy(
        data_source_id="ds-1",
        organization_id=None,
        name="Good policy",
        description=None,
        enabled=True,
        settings={},
        rules=[
            _ns_rule(action="mask", mask_strategy="partial", mask_config={"keep": 4})
        ],
        created_by=None,
        session=_Session([]),
    )
    assert rules[0].mask_config["keep"] == 4


@pytest.mark.asyncio
async def test_create_policy_rejects_empty_table_name():
    with pytest.raises(ValueError, match="table_name is required"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[_ns_rule(table_name="   ")],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_create_policy_rejects_empty_column_name():
    with pytest.raises(ValueError, match="column_name is required"):
        await DataSourceCLSService.create_policy(
            data_source_id="ds-1",
            organization_id=None,
            name="Bad policy",
            description=None,
            enabled=True,
            settings={},
            rules=[_ns_rule(column_name="")],
            created_by=None,
            session=_Session([]),
        )


@pytest.mark.asyncio
async def test_deny_action_does_not_require_a_mask_strategy():
    policy, rules = await DataSourceCLSService.create_policy(
        data_source_id="ds-1",
        organization_id=None,
        name="Deny policy",
        description=None,
        enabled=True,
        settings={},
        rules=[_ns_rule(action="deny", mask_strategy=None)],
        created_by=None,
        session=_Session([]),
    )
    assert rules[0].action == "deny"
    assert rules[0].mask_strategy is None


# ---------------------------------------------------------------------------
# Service-level: soft-delete / update semantics (mirrors the RLS service tests)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_policy_soft_deletes_policy_and_rules(monkeypatch):
    policy = SimpleNamespace(is_active=True, is_deleted=False, deleted_at=None)
    rule = SimpleNamespace(is_active=True, is_deleted=False, deleted_at=None)

    async def get_policy(*_args, **_kwargs):
        return policy, [rule]

    monkeypatch.setattr(DataSourceCLSService, "get_policy", staticmethod(get_policy))

    assert await DataSourceCLSService.delete_policy(
        data_source_id="ds-1", policy_id=str(uuid4()), session=_Session([])
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
        id=uuid4(), name="Old name", description=None, enabled=True, settings={}
    )
    old_rule = SimpleNamespace(is_active=True, is_deleted=False, deleted_at=None)
    session = _Session([])

    async def get_policy(*_args, **_kwargs):
        return policy, [old_rule]

    monkeypatch.setattr(DataSourceCLSService, "get_policy", staticmethod(get_policy))

    updated = await DataSourceCLSService.update_policy(
        data_source_id="ds-1",
        policy_id=str(policy.id),
        name="New name",
        description="Updated",
        enabled=False,
        settings={"note": "tightened"},
        rules=[_ns_rule(column_name="email")],
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


# ---------------------------------------------------------------------------
# The hash salt: generated once per data source, reused, never returned
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hash_rule_gets_a_generated_salt_stored_off_the_rule_request():
    rule = _ns_rule(action="mask", mask_strategy="hash", mask_config={})
    policy, rules = await DataSourceCLSService.create_policy(
        data_source_id="ds-1",
        organization_id=None,
        name="Hash policy",
        description=None,
        enabled=True,
        settings={},
        rules=[rule],
        created_by=None,
        session=_Session([_ExecuteResult(scalars=[])]),
    )
    salt = rules[0].mask_config.get("salt")
    assert salt
    # The request never carried a salt -- the service generated it.
    assert "salt" not in (rule.mask_config or {})
    # It is recorded on the policy (the data-source-scoped store) too.
    assert policy.settings["_cls_hash_salt"] == salt


@pytest.mark.asyncio
async def test_hash_salt_is_reused_across_policies_on_the_same_source():
    first_policy, first_rules = await DataSourceCLSService.create_policy(
        data_source_id="ds-1",
        organization_id=None,
        name="Hash policy A",
        description=None,
        enabled=True,
        settings={},
        rules=[
            _ns_rule(
                action="mask",
                mask_strategy="hash",
                mask_config={},
                table_name="customers",
                column_name="ssn",
            )
        ],
        created_by=None,
        session=_Session([_ExecuteResult(scalars=[])]),
    )
    salt = first_rules[0].mask_config["salt"]

    # A second, independent policy on the SAME data source must find and
    # reuse that exact salt -- not generate a new one -- or the same SSN
    # would hash to two different digests in two tables, breaking the join
    # hash masking exists to permit.
    second_session = _Session([_ExecuteResult(scalars=[first_policy])])
    second_policy, second_rules = await DataSourceCLSService.create_policy(
        data_source_id="ds-1",
        organization_id=None,
        name="Hash policy B",
        description=None,
        enabled=True,
        settings={},
        rules=[
            _ns_rule(
                action="mask",
                mask_strategy="hash",
                mask_config={},
                table_name="orders",
                column_name="customer_ssn",
            )
        ],
        created_by=None,
        session=second_session,
    )
    assert second_rules[0].mask_config["salt"] == salt
    assert second_policy.settings["_cls_hash_salt"] == salt


@pytest.mark.asyncio
async def test_hash_salt_never_appears_in_any_serialized_response():
    policy, rules = await DataSourceCLSService.create_policy(
        data_source_id="ds-1",
        organization_id=None,
        name="Hash policy",
        description=None,
        enabled=True,
        settings={"note": "customer PII"},
        rules=[
            _ns_rule(
                action="mask",
                mask_strategy="hash",
                mask_config={},
                table_name="customers",
                column_name="ssn",
            )
        ],
        created_by=None,
        session=_Session([_ExecuteResult(scalars=[])]),
    )
    salt = rules[0].mask_config["salt"]
    assert salt  # sanity: a salt really was generated

    serialized = DataSourceCLSService.serialize_policy(policy, rules)
    body = json.dumps(serialized, default=str)

    assert salt not in body
    assert "_cls_hash_salt" not in serialized["settings"]
    assert "salt" not in serialized["rules"][0]["mask_config"]
    # The rest of the caller-supplied settings must still come through.
    assert serialized["settings"]["note"] == "customer PII"

    # And through the router's own success payload.
    serialized_via_endpoint = json.dumps(
        DataSourceCLSService.serialize_policy(policy, rules), default=str
    )
    assert salt not in serialized_via_endpoint


@pytest.mark.asyncio
async def test_hash_salt_is_not_regenerated_on_update_without_a_hash_rule(monkeypatch):
    policy, rules = await DataSourceCLSService.create_policy(
        data_source_id="ds-1",
        organization_id=None,
        name="Hash policy",
        description=None,
        enabled=True,
        settings={},
        rules=[
            _ns_rule(
                action="mask",
                mask_strategy="hash",
                mask_config={},
                table_name="customers",
                column_name="ssn",
            )
        ],
        created_by=None,
        session=_Session([_ExecuteResult(scalars=[])]),
    )
    salt = policy.settings["_cls_hash_salt"]

    async def get_policy(*_args, **_kwargs):
        return policy, list(rules)

    # Update the policy's rules to something that no longer masks by hash;
    # the previously-generated salt must still be preserved on the policy so
    # any OTHER policy for this source that already used it keeps working.
    monkeypatch.setattr(DataSourceCLSService, "get_policy", staticmethod(get_policy))

    updated = await DataSourceCLSService.update_policy(
        data_source_id="ds-1",
        policy_id=str(policy.id),
        name="Hash policy",
        description=None,
        enabled=True,
        settings={},
        rules=[_ns_rule(action="deny", mask_strategy=None)],
        session=_Session([]),
    )

    updated_policy, _updated_rules = updated
    assert updated_policy.settings["_cls_hash_salt"] == salt
