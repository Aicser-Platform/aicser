"""The rewriter is the only thing standing between a user's SQL and their rows.

Every case here is a way the previous outer-wrapper implementation could be
walked around or made to fall over.
"""

import os

import duckdb
import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")
from ee.modules.data.services.rls_query_rewriter import (base_table_nodes,
                                                         inject_predicates,
                                                         parse_single_read)
from src.modules.data.services.query_identity import RowSecurityDenied


def test_accepts_a_plain_select():
    assert parse_single_read("SELECT * FROM fact_orders", "duckdb") is not None


def test_accepts_a_cte():
    assert (
        parse_single_read(
            "WITH t AS (SELECT * FROM fact_orders) SELECT * FROM t", "duckdb"
        )
        is not None
    )


@pytest.mark.parametrize(
    "query",
    [
        "DROP TABLE fact_orders",
        "DELETE FROM fact_orders",
        "UPDATE fact_orders SET amount = 0",
        "INSERT INTO fact_orders VALUES ('C001', 1)",
        "CREATE TABLE copy AS SELECT * FROM fact_orders",
        "SELECT * FROM fact_orders; DROP TABLE fact_orders",
        "SELECT * INTO copy FROM fact_orders",
        "this is not sql at all ((((",
        "",
        "   ",
        "WITH d AS (DELETE FROM fact_orders WHERE 1=1 RETURNING *) SELECT * FROM d",
        "WITH i AS (INSERT INTO fact_orders VALUES ('C001','P1',1) RETURNING *) SELECT * FROM i",
        "WITH u AS (UPDATE fact_orders SET amount = 0 RETURNING *) SELECT * FROM u",
    ],
)
def test_rejects_anything_that_is_not_one_read(query):
    with pytest.raises(RowSecurityDenied):
        parse_single_read(query, "duckdb")


def _names(query):
    return sorted(
        node.name.lower()
        for node in base_table_nodes(parse_single_read(query, "duckdb"))
    )


def test_finds_a_plain_table():
    assert _names("SELECT * FROM fact_orders") == ["fact_orders"]


def test_finds_both_sides_of_a_join():
    assert _names(
        "SELECT * FROM fact_orders f JOIN dim_product p ON f.product_id = p.product_id"
    ) == ["dim_product", "fact_orders"]


def test_cte_name_is_not_a_base_table():
    """`t` is a CTE, not a table. Filtering it would double-apply the predicate."""
    assert _names("WITH t AS (SELECT * FROM fact_orders) SELECT * FROM t") == [
        "fact_orders"
    ]


def test_nested_ctes():
    query = (
        "WITH a AS (SELECT * FROM fact_orders), "
        "b AS (SELECT * FROM a JOIN dim_product ON 1=1) "
        "SELECT * FROM b"
    )
    assert _names(query) == ["dim_product", "fact_orders"]


def test_finds_tables_inside_a_subquery():
    assert _names("SELECT * FROM (SELECT * FROM fact_orders) AS inner_q") == [
        "fact_orders"
    ]


def test_finds_tables_inside_a_where_subquery():
    assert _names(
        "SELECT * FROM fact_orders WHERE product_id IN (SELECT product_id FROM dim_product)"
    ) == ["dim_product", "fact_orders"]


def test_a_cte_named_after_its_source_table_does_not_hide_that_table():
    """Naming a CTE after the table it reads is a common convention.

    Matching CTE names globally dropped the real table too, leaving the query
    with nothing to filter — a total bypass on ordinary SQL.
    """
    assert _names(
        "WITH fact_orders AS (SELECT * FROM fact_orders) SELECT * FROM fact_orders"
    ) == ["fact_orders"]


def test_a_cte_in_one_scope_does_not_hide_a_real_table_in_another():
    assert _names(
        "SELECT * FROM orders WHERE 1 IN (WITH orders AS (SELECT 1) SELECT * FROM orders)"
    ) == ["orders"]


CUSTOMER_FILTER = {"fact_orders": "customer_id = 'C001'"}


@pytest.fixture
def con():
    """A real engine, because the bypass was invisible to string assertions."""
    connection = duckdb.connect()
    connection.execute(
        "CREATE TABLE fact_orders(customer_id VARCHAR, product_id VARCHAR, amount INT)"
    )
    connection.execute(
        "INSERT INTO fact_orders VALUES ('C001','P1',10),('C002','P2',999),('C003','P3',777)"
    )
    connection.execute("CREATE TABLE dim_product(product_id VARCHAR, name VARCHAR)")
    connection.execute("INSERT INTO dim_product VALUES ('P1','Widget'),('P2','Gadget')")
    return connection


def _run(con, query, predicates=None, deny_ungoverned=False):
    rewritten = inject_predicates(
        query,
        predicates if predicates is not None else CUSTOMER_FILTER,
        dialect="duckdb",
        deny_ungoverned=deny_ungoverned,
    )
    return con.execute(rewritten).fetchall()


def test_a_fabricated_filter_column_does_not_widen_access(con):
    """The bypass that motivated this rewrite.

    Under the old outer wrapper this returned all three rows: the predicate read
    the literal in the SELECT list rather than the column in the table.
    """
    rows = _run(con, "SELECT amount, 'C001' AS customer_id FROM fact_orders")
    assert [row[0] for row in rows] == [10]


def test_an_aggregate_is_computed_over_permitted_rows_only(con):
    """The old wrapper raised a binder error here — customer_id was not in scope."""
    assert _run(con, "SELECT SUM(amount) AS total FROM fact_orders") == [(10,)]


def test_a_projection_without_the_filter_column_still_works(con):
    """Also a binder error under the old wrapper."""
    assert _run(con, "SELECT amount FROM fact_orders") == [(10,)]


def test_a_join_filters_each_governed_table_independently(con):
    rows = _run(
        con,
        "SELECT f.amount, p.name FROM fact_orders f JOIN dim_product p ON f.product_id = p.product_id",
    )
    assert rows == [(10, "Widget")]


def test_an_alias_survives_the_rewrite(con):
    """Outer references to `f` must still resolve after the table is wrapped."""
    assert _run(con, "SELECT f.amount FROM fact_orders AS f WHERE f.amount > 0") == [
        (10,)
    ]


def test_a_cte_body_is_filtered_and_the_cte_reference_is_not(con):
    assert _run(con, "WITH t AS (SELECT * FROM fact_orders) SELECT amount FROM t") == [
        (10,)
    ]


def test_a_subquery_is_filtered(con):
    assert _run(con, "SELECT amount FROM (SELECT * FROM fact_orders) AS q") == [(10,)]


def test_two_policies_on_one_table_union(con):
    rows = _run(
        con,
        "SELECT amount FROM fact_orders ORDER BY amount",
        predicates={"fact_orders": "(customer_id = 'C001') OR (customer_id = 'C003')"},
    )
    assert [row[0] for row in rows] == [10, 777]


def test_an_ungoverned_table_passes_through_when_deny_is_off(con):
    assert _run(con, "SELECT name FROM dim_product ORDER BY name") == [
        ("Gadget",),
        ("Widget",),
    ]


def test_an_ungoverned_table_is_denied_when_deny_is_on(con):
    with pytest.raises(RowSecurityDenied) as caught:
        _run(con, "SELECT name FROM dim_product", deny_ungoverned=True)
    assert caught.value.table == "dim_product"
    assert "dim_product" in str(caught.value)


def test_matching_is_case_insensitive(con):
    assert _run(con, "SELECT amount FROM FACT_ORDERS") == [(10,)]


def test_a_rule_for_orders_does_not_govern_fact_orders(con):
    """The old fuzzy suffix match filtered any table ending in `_orders`."""
    rows = _run(
        con,
        "SELECT amount FROM fact_orders ORDER BY amount",
        predicates={"orders": "1 = 0"},
    )
    assert [row[0] for row in rows] == [10, 777, 999]


def test_a_parenthesized_join_does_not_leave_the_leading_table_unfiltered(con):
    """The leading table of `FROM (a JOIN b)` is invisible to scope.tables.

    It was returned completely unfiltered, and default_deny did not help because
    the query need not mention any ungoverned table.
    """
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT * FROM (fact_orders a JOIN fact_orders b ON 1=1) x")


def test_a_pivot_is_denied_rather_than_silently_mis_shaped(con):
    with pytest.raises(RowSecurityDenied):
        _run(
            con,
            "SELECT * FROM fact_orders PIVOT (SUM(amount) FOR product_id IN ('P1','P2'))",
        )


def test_a_schema_qualified_policy_matches_a_schema_qualified_table():
    from ee.modules.data.services.rls_query_rewriter import inject_predicates

    rewritten = inject_predicates(
        "SELECT amount FROM analytics.fact_orders",
        {"analytics.fact_orders": "customer_id = 'C001'"},
        dialect="duckdb",
        deny_ungoverned=False,
    )
    assert "customer_id = 'C001'" in rewritten


def test_an_empty_predicate_denies_rather_than_passing_through(con):
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT amount FROM fact_orders", predicates={"fact_orders": ""})


def test_a_wildcard_predicate_filters_any_table(con):
    rows = _run(
        con,
        "SELECT amount FROM fact_orders",
        predicates={"*": "customer_id = 'C001'"},
    )
    assert rows == [(10,)]


def test_a_malformed_predicate_denies_rather_than_raising_a_parse_error(con):
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT amount FROM fact_orders", predicates={"fact_orders": "a)b("})


def test_quoting_is_preserved_so_the_rewrite_reads_the_table_the_user_named():
    """Postgres folds unquoted identifiers to lowercase.

    Rebuilding the identifier from the bare name dropped the quotes, so the
    rewritten query read a different relation than the user asked for.
    """
    from ee.modules.data.services.rls_query_rewriter import inject_predicates

    rewritten = inject_predicates(
        'SELECT amount FROM "Fact_Orders"',
        {"fact_orders": "customer_id = 'C001'"},
        dialect="postgres",
        deny_ungoverned=False,
    )
    assert '"Fact_Orders"' in rewritten


def test_a_null_predicate_denies_rather_than_reading_every_row(con):
    """A policy that resolved to nothing is broken, not absent.

    Collapsing it to "no policy" returned the table completely unfiltered.
    """
    with pytest.raises(RowSecurityDenied):
        _run(
            con,
            "SELECT amount FROM fact_orders WHERE amount > 0",
            predicates={"fact_orders": None},
        )


def test_an_alias_column_list_is_denied_rather_than_silently_renaming_columns(con):
    with pytest.raises(RowSecurityDenied):
        _run(con, "SELECT * FROM fact_orders AS f(a, b, c)")


def test_a_cte_named_after_a_governed_table_still_runs_and_filters(con):
    """End-to-end version of test_a_cte_named_after_its_source_table_...

    That test calls base_table_nodes directly. This one goes through
    inject_predicates, which is where the verification pass wrongly denied it.
    """
    assert _run(
        con,
        "WITH fact_orders AS (SELECT * FROM fact_orders) SELECT amount FROM fact_orders",
    ) == [(10,)]


def test_a_cte_shadowing_in_another_scope_still_runs_and_filters(con):
    assert _run(
        con,
        "SELECT amount FROM fact_orders "
        "WHERE 1 IN (WITH fact_orders AS (SELECT 1) SELECT * FROM fact_orders)",
    ) == [(10,)]
