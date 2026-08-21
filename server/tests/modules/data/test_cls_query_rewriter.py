import os

import pytest

os.environ["DEBUG"] = "false"
import src.db.registry  # noqa: F401

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")
import duckdb

from ee.modules.data.services.cls_query_rewriter import apply_column_security
from ee.modules.data.services.cls_rule_resolver import ColumnDecision
from src.modules.data.services.query_identity import RowSecurityDenied

SCHEMA = {
    "users": {"id": "INT", "name": "VARCHAR", "password": "VARCHAR", "email": "VARCHAR"}
}
MASK_PW = {("users", "password"): ColumnDecision("mask", "fixed", {})}
DENY_PW = {("users", "password"): ColumnDecision("deny", None, {})}


@pytest.fixture
def con():
    c = duckdb.connect()
    c.execute(
        "CREATE TABLE users(id INT, name VARCHAR, password VARCHAR, email VARCHAR)"
    )
    c.execute("INSERT INTO users VALUES (1,'Ada','hunter2','ada@x.com')")
    return c


def _run(con, sql, decisions=None, schema=None):
    out, omitted = apply_column_security(
        sql,
        decisions if decisions is not None else MASK_PW,
        schema if schema is not None else SCHEMA,
        dialect="duckdb",
    )
    return con.execute(out).fetchall(), omitted


def test_a_masked_column_is_masked(con):
    rows, _ = _run(con, "SELECT password FROM users")
    assert rows == [("***MASKED***",)]


def test_an_alias_does_not_reveal_the_column(con):
    """The shipped mask_query_result_rows matched the OUTPUT name, so this leaked."""
    rows, _ = _run(con, "SELECT password AS pw FROM users")
    assert rows == [("***MASKED***",)]


def test_a_table_alias_does_not_reveal_the_column(con):
    rows, _ = _run(con, "SELECT u.password FROM users u")
    assert rows == [("***MASKED***",)]


def test_an_expression_over_a_masked_column_reads_the_mask(con):
    rows, _ = _run(con, "SELECT substr(password, 1, 3) FROM users")
    assert rows == [("***",)]


def test_select_star_expands_and_masks(con):
    rows, _ = _run(con, "SELECT * FROM users")
    assert "hunter2" not in str(rows)
    assert "Ada" in str(rows)


def test_select_star_omits_a_denied_column_and_reports_it(con):
    rows, omitted = _run(con, "SELECT * FROM users", decisions=DENY_PW)
    assert "hunter2" not in str(rows)
    assert omitted == ["users.password"]


def test_an_explicit_denied_column_rejects(con):
    """Asking for it by name is an error; getting it via `*` is an omission.

    qualify() erases the difference, so it is captured before qualifying.
    """
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT password FROM users", decisions=DENY_PW)


def test_a_star_omits_while_an_explicit_name_rejects_in_the_same_schema(con):
    rows, omitted = _run(con, "SELECT * FROM users", decisions=DENY_PW)
    assert omitted == ["users.password"]
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT id, password FROM users", decisions=DENY_PW)


def test_a_denied_column_in_where_rejects(con):
    """Filtering on an unreadable column enumerates it one guess at a time."""
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT id FROM users WHERE password = 'x'", decisions=DENY_PW)


def test_a_denied_column_in_group_by_rejects(con):
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT count(*) FROM users GROUP BY password", decisions=DENY_PW)


def test_a_fixed_masked_column_cannot_be_grouped(con):
    """A predicate on a fixed mask leaks the true value."""
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT count(*) FROM users GROUP BY password")


def test_a_hash_masked_column_can_be_grouped(con):
    """Correlating without revealing is the whole point of hash."""
    rows, _ = _run(
        con,
        "SELECT count(*) FROM users GROUP BY email",
        decisions={("users", "email"): ColumnDecision("mask", "hash", {"salt": "s"})},
    )
    assert rows == [(1,)]


def test_a_cte_is_masked_at_every_level(con):
    rows, _ = _run(con, "WITH t AS (SELECT * FROM users) SELECT password FROM t")
    assert "hunter2" not in str(rows)


def test_an_unresolvable_schema_denies(con):
    """A stale schema must deny rather than pass the column through."""
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT * FROM users", schema={})


def test_an_ungoverned_query_is_untouched(con):
    rows, omitted = _run(con, "SELECT name FROM users")
    assert rows == [("Ada",)] and omitted == []


def test_mysql_rewrite_uses_mysql_identifier_quotes():
    out, omitted = apply_column_security(
        "SELECT * FROM railway.user WHERE name = 'Makara'",
        {("user", "password"): ColumnDecision("mask", "fixed", {})},
        {
            "user": {
                "id": "INT",
                "name": "VARCHAR",
                "age": "INT",
                "password": "VARCHAR",
                "salary": "DECIMAL",
            }
        },
        dialect="mysql",
    )

    assert omitted == []
    assert "`railway`.`user`" in out
    assert "`user`.`id`" in out
    assert '."id"' not in out
    assert '"user"' not in out


def test_an_unmaskable_dialect_denies_rather_than_raising_valueerror():
    """build_mask raises ValueError for a dialect it cannot render (e.g. oracle).

    The enforcement path must never leak a raw ValueError to a caller — an
    unmaskable column has to deny instead.
    """
    with pytest.raises(RowSecurityDenied):
        apply_column_security(
            "SELECT password FROM users",
            {("users", "password"): ColumnDecision("mask", "hash", {})},
            SCHEMA,
            dialect="oracle",
        )
