import os
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")

from ee.modules.data.services.data_source_rls_preview_service import (
    attribute_path,
    compile_preview,
)


def _rule(**kwargs):
    base = {
        "table_name": "dim_customer",
        "column_name": "customer_name",
        "operator": "eq",
        "value_type": "fixed",
        "value": "ACME",
        "sort_order": 0,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


def test_fixed_rule_compiles_to_escaped_predicate():
    result = compile_preview(
        [_rule()],
        default_deny=True,
        attributes={},
        dialect="postgres",
        mask_values=False,
    )
    assert result.predicate == "(customer_name = 'ACME')"
    assert result.effect == "filtered"
    assert result.unresolved == []


def test_dialect_is_honoured():
    result = compile_preview(
        [_rule(value="Acme\\")],
        default_deny=True,
        attributes={},
        dialect="mysql",
        mask_values=False,
    )
    assert result.predicate == "(customer_name = 'Acme\\\\')"


def test_rules_are_and_ed():
    rules = [_rule(), _rule(column_name="region", value="APAC")]
    result = compile_preview(
        rules, default_deny=True, attributes={}, dialect="postgres", mask_values=False
    )
    assert result.predicate == "(customer_name = 'ACME' AND region = 'APAC')"


def test_unresolved_attribute_is_reported_and_denies():
    rule = _rule(value_type="user_attribute", value="region")
    result = compile_preview(
        [rule], default_deny=True, attributes={}, dialect="postgres", mask_values=False
    )
    assert result.unresolved == ["user.region"]
    assert result.effect == "deny_all"
    assert result.predicate == "1 = 0"


def test_unresolved_without_default_deny_yields_no_filter():
    rule = _rule(value_type="user_attribute", value="region")
    result = compile_preview(
        [rule], default_deny=False, attributes={}, dialect="postgres", mask_values=False
    )
    assert result.effect == "no_filter"
    assert result.predicate is None


def test_resolved_attribute_is_rendered_when_not_masked():
    rule = _rule(value_type="user_attribute", value="region")
    result = compile_preview(
        [rule],
        default_deny=True,
        attributes={"region": "APAC"},
        dialect="postgres",
        mask_values=False,
    )
    assert result.predicate == "(customer_name = 'APAC')"


def test_masking_hides_other_users_values_but_keeps_structure():
    rule = _rule(value_type="user_attribute", value="region")
    result = compile_preview(
        [rule],
        default_deny=True,
        attributes={"region": "APAC"},
        dialect="postgres",
        mask_values=True,
    )
    assert result.predicate == "(customer_name = ‹user.region›)"
    assert "APAC" not in result.predicate
    assert result.effect == "filtered"


def test_masking_leaves_fixed_values_visible():
    result = compile_preview(
        [_rule()],
        default_deny=True,
        attributes={},
        dialect="postgres",
        mask_values=True,
    )
    assert result.predicate == "(customer_name = 'ACME')"


def test_nullary_operator_needs_no_value():
    result = compile_preview(
        [_rule(operator="is_null", value=None)],
        default_deny=True,
        attributes={},
        dialect="postgres",
        mask_values=False,
    )
    assert result.predicate == "(customer_name IS NULL)"


def test_unsafe_column_is_dropped_and_reported():
    result = compile_preview(
        [_rule(column_name="x; DROP TABLE users")],
        default_deny=True,
        attributes={},
        dialect="postgres",
        mask_values=False,
    )
    assert result.effect == "deny_all"
    assert result.unresolved == ["dim_customer.x; DROP TABLE users"]


def test_no_rules_yields_deny_when_default_deny():
    result = compile_preview(
        [], default_deny=True, attributes={}, dialect="postgres", mask_values=False
    )
    assert result.effect == "deny_all"


@pytest.mark.parametrize(
    "value_type,expected",
    [
        ("user_attribute", "user.region"),
        ("org_attribute", "org.region"),
        ("project_attribute", "project.region"),
        ("group_attribute", "group.region"),
        ("fixed", None),
    ],
)
def test_attribute_path(value_type, expected):
    assert attribute_path(_rule(value_type=value_type, value="region")) == expected


def test_preview_is_identical_to_enforcement_output():
    from ee.modules.data.services.data_source_rls_enforcement_service import (
        DataSourceRLSEnforcementService as Enforcement,
    )

    rules = [
        _rule(),
        _rule(column_name="region", value_type="user_attribute", value="region"),
    ]
    attrs = {"region": "APAC"}
    policy = SimpleNamespace(enabled=True, default_deny=True)

    preview = compile_preview(
        rules,
        default_deny=True,
        attributes=attrs,
        dialect="postgres",
        mask_values=False,
    )
    enforced = Enforcement._policy_clause(policy, rules, attrs, "postgres")

    assert preview.predicate == enforced


def test_preview_matches_enforcement_when_denying():
    from ee.modules.data.services.data_source_rls_enforcement_service import (
        DataSourceRLSEnforcementService as Enforcement,
    )

    rules = [_rule(value_type="user_attribute", value="missing")]
    policy = SimpleNamespace(enabled=True, default_deny=True)

    preview = compile_preview(
        rules, default_deny=True, attributes={}, dialect="postgres", mask_values=False
    )
    enforced = Enforcement._policy_clause(policy, rules, {}, "postgres")

    assert preview.predicate == enforced == "1 = 0"
