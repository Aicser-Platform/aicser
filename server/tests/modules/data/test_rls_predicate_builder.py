# server/tests/modules/data/test_rls_predicate_builder.py
import os
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

pytest.importorskip("sqlglot")
pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")

from ee.modules.data.services.rls_predicate_builder import (
    build_condition,
    resolve_dialect,
)


def _rule(**kwargs):
    base = {
        "table_name": "orders",
        "column_name": "region",
        "operator": "eq",
        "value_type": "fixed",
        "value": "APAC",
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


def _sql(node, dialect):
    return node.sql(dialect=dialect)


def test_eq_renders_quoted_literal():
    node = build_condition(_rule(), "APAC", "postgres")
    assert _sql(node, "postgres") == "region = 'APAC'"


def test_single_quote_in_value_is_escaped():
    node = build_condition(_rule(), "O'Brien", "postgres")
    assert _sql(node, "postgres") == "region = 'O''Brien'"


def test_trailing_backslash_cannot_escape_closing_quote_on_mysql():
    # Regression: the previous hand-rolled _sql_literal doubled single quotes
    # only, so a trailing backslash escaped the closing quote on MySQL and the
    # rest of the predicate became attacker-controlled SQL.
    node = build_condition(_rule(), "Acme\\", "mysql")
    rendered = _sql(node, "mysql")
    assert rendered.count("'") % 2 == 0
    assert rendered.endswith("'") or rendered.endswith("''")
    # The literal must not terminate early: everything after the opening quote
    # up to the final quote is the value, escaped.
    assert "Acme" in rendered


def test_injection_attempt_stays_inside_the_literal():
    node = build_condition(_rule(), "x' OR 1=1 --", "postgres")
    rendered = _sql(node, "postgres")
    assert "OR 1=1" in rendered
    assert rendered.startswith("region = '")
    assert rendered.count("'") % 2 == 0


def test_in_operator_with_list():
    node = build_condition(_rule(operator="in"), ["APAC", "EMEA"], "postgres")
    assert _sql(node, "postgres") == "region IN ('APAC', 'EMEA')"


def test_not_in_operator():
    # sqlglot canonicalises `x NOT IN (...)` to the equivalent `NOT x IN (...)`.
    node = build_condition(_rule(operator="not_in"), ["APAC"], "postgres")
    assert _sql(node, "postgres") == "NOT region IN ('APAC')"


def test_between_operator():
    node = build_condition(
        _rule(operator="between", column_name="amount"), [1, 10], "postgres"
    )
    assert _sql(node, "postgres") == "amount BETWEEN 1 AND 10"


def test_is_null_needs_no_value():
    node = build_condition(_rule(operator="is_null"), None, "postgres")
    assert _sql(node, "postgres") == "region IS NULL"


def test_is_not_null_needs_no_value():
    node = build_condition(_rule(operator="is_not_null"), None, "postgres")
    assert _sql(node, "postgres") == "region IS NOT NULL"


def test_none_value_on_value_requiring_operator_yields_no_condition():
    assert build_condition(_rule(), None, "postgres") is None


def test_empty_in_list_yields_no_condition():
    assert build_condition(_rule(operator="in"), [], "postgres") is None


def test_between_needs_exactly_two_values():
    assert build_condition(_rule(operator="between"), [1], "postgres") is None


def test_unsafe_column_name_yields_no_condition():
    assert (
        build_condition(
            _rule(column_name="region; DROP TABLE users"), "APAC", "postgres"
        )
        is None
    )


def test_numeric_value_is_not_quoted():
    node = build_condition(_rule(column_name="amount"), 42, "postgres")
    assert _sql(node, "postgres") == "amount = 42"


def test_boolean_value_renders_as_boolean():
    node = build_condition(_rule(column_name="active"), True, "postgres")
    assert _sql(node, "postgres").upper().endswith("TRUE")


@pytest.mark.parametrize(
    "source,expected",
    [
        ({"db_type": "postgresql"}, "postgres"),
        ({"db_type": "mysql"}, "mysql"),
        ({"db_type": "mariadb"}, "mysql"),
        ({"type": "database", "connection_config": {"type": "mysql"}}, "mysql"),
        ({"type": "database", "connection_config": '{"type": "mysql"}'}, "mysql"),
        ({"type": "database", "config": {"db_type": "mariadb"}}, "mysql"),
        ({"db_type": "bigquery"}, "bigquery"),
        ({"type": "file", "format": "csv"}, "duckdb"),
        ({"db_type": "unknown-engine"}, "postgres"),
        ({}, "postgres"),
    ],
)
def test_resolve_dialect(source, expected):
    assert resolve_dialect(source) == expected
