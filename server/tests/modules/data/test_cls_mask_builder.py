import os

import pytest

os.environ["DEBUG"] = "false"
import src.db.registry  # noqa: F401

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")
import duckdb
from sqlglot import exp

from ee.modules.data.services.cls_mask_builder import (MASK_PRECEDENCE,
                                                       build_mask)


def _sql(strategy, config=None):
    col = exp.column("ssn", table="customers")
    return build_mask(col, strategy, config or {}, "duckdb").sql(dialect="duckdb")


def test_fixed_is_a_constant():
    assert _sql("fixed") == "'***MASKED***'"


def test_null_is_null():
    assert _sql("null") == "NULL"


def test_hash_actually_executes_and_hides_the_value():
    """The old assertion only checked that the string 'sha256' appeared.

    That was true on every dialect while the SQL was invalid on four of them.
    """
    con = duckdb.connect()
    con.execute("CREATE TABLE customers(ssn VARCHAR)")
    con.execute("INSERT INTO customers VALUES ('123-45-6789')")
    sql = build_mask(
        exp.column("ssn", table="customers"), "hash", {"salt": "s"}, "duckdb"
    )
    value = con.execute(
        f"SELECT {sql.sql(dialect='duckdb')} FROM customers"
    ).fetchone()[0]
    assert "123-45-6789" not in str(value)
    assert len(str(value)) >= 32


def test_partial_actually_executes_and_keeps_only_the_tail():
    con = duckdb.connect()
    con.execute("CREATE TABLE customers(ssn VARCHAR)")
    con.execute("INSERT INTO customers VALUES ('123-45-6789')")
    sql = build_mask(
        exp.column("ssn", table="customers"), "partial", {"keep": 4}, "duckdb"
    )
    value = con.execute(
        f"SELECT {sql.sql(dialect='duckdb')} FROM customers"
    ).fetchone()[0]
    assert value == "****6789"


@pytest.mark.parametrize(
    "dialect", ["duckdb", "postgres", "mysql", "snowflake", "bigquery"]
)
def test_every_supported_dialect_renders_a_hash(dialect):
    out = build_mask(
        exp.column("ssn", table="customers"), "hash", {"salt": "s"}, dialect
    ).sql(dialect=dialect)
    assert "customers" in out and out.strip() != ""


def test_an_unsupported_dialect_raises_rather_than_emitting_wrong_sql():
    with pytest.raises(ValueError):
        build_mask(exp.column("ssn", table="customers"), "hash", {}, "oracle")


def test_unknown_strategy_raises():
    with pytest.raises(ValueError):
        _sql("teleport")


def test_precedence_is_a_total_order():
    """No ties: two grants disagreeing must resolve deterministically."""
    order = [MASK_PRECEDENCE[s] for s in ("null", "fixed", "partial", "hash")]
    assert order == sorted(order, reverse=True)
    assert len(set(order)) == 4
