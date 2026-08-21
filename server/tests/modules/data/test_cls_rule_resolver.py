import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

os.environ["DEBUG"] = "false"
import src.db.registry  # noqa: F401

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")
from ee.modules.data.services.cls_rule_resolver import resolve_decisions


def _policy(pid, enabled=True):
    return SimpleNamespace(id=pid, enabled=enabled)


def _rule(pid, table, column, action, strategy=None, config=None):
    return SimpleNamespace(
        policy_id=pid,
        table_name=table,
        column_name=column,
        action=action,
        mask_strategy=strategy,
        mask_config=config or {},
    )


def test_a_single_mask_rule():
    p = uuid4()
    d = resolve_decisions(
        [_policy(p)], {p: [_rule(p, "customers", "ssn", "mask", "fixed")]}
    )
    assert d[("customers", "ssn")].action == "mask"
    assert d[("customers", "ssn")].strategy == "fixed"


def test_deny_beats_mask_across_grants():
    """Column policies union MOST RESTRICTIVE — the inverse of row policies."""
    a, b = uuid4(), uuid4()
    d = resolve_decisions(
        [_policy(a), _policy(b)],
        {
            a: [_rule(a, "customers", "ssn", "mask", "hash")],
            b: [_rule(b, "customers", "ssn", "deny")],
        },
    )
    assert d[("customers", "ssn")].action == "deny"


def test_less_revealing_mask_wins():
    a, b = uuid4(), uuid4()
    d = resolve_decisions(
        [_policy(a), _policy(b)],
        {
            a: [_rule(a, "customers", "ssn", "mask", "hash")],
            b: [_rule(b, "customers", "ssn", "mask", "fixed")],
        },
    )
    assert d[("customers", "ssn")].strategy == "fixed"


def test_names_are_normalised():
    p = uuid4()
    d = resolve_decisions(
        [_policy(p)], {p: [_rule(p, "Customers", "SSN", "mask", "fixed")]}
    )
    assert ("customers", "ssn") in d


def test_a_disabled_policy_contributes_nothing():
    p = uuid4()
    d = resolve_decisions(
        [_policy(p, enabled=False)], {p: [_rule(p, "customers", "ssn", "deny")]}
    )
    assert d == {}


def test_a_mask_rule_without_a_strategy_denies():
    """A broken rule must not silently become 'no restriction'."""
    p = uuid4()
    d = resolve_decisions(
        [_policy(p)], {p: [_rule(p, "customers", "ssn", "mask", None)]}
    )
    assert d[("customers", "ssn")].action == "deny"
