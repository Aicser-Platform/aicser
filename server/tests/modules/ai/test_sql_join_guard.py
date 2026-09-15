"""JOIN-key guard: do not treat customer_id = branch_id as a valid FK."""

from ee.modules.ai.utils.sql_join_guard import (
    find_mismatched_id_joins,
    join_equality_is_plausible,
    prefer_shared_join_key,
    rewrite_mismatched_id_joins,
)

BANKING_SCHEMA = {
    "tables": [
        {
            "name": "loans",
            "schema": "banking",
            "columns": [
                {"name": "loan_id"},
                {"name": "customer_id"},
                {"name": "branch_id"},
                {"name": "amount"},
            ],
        },
        {
            "name": "customers",
            "schema": "banking",
            "columns": [
                {"name": "customer_id"},
                {"name": "name"},
                {"name": "branch_id"},
            ],
        },
        {
            "name": "branches",
            "schema": "banking",
            "columns": [
                {"name": "branch_id"},
                {"name": "branch_name"},
            ],
        },
    ]
}

USER_SQL = (
    'SELECT c."name", SUM(l."amount") AS total '
    'FROM banking.loans l '
    'JOIN banking.customers c ON c."customer_id" = l."branch_id" '
    "GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
)


def test_customer_id_equals_branch_id_is_not_plausible():
    assert not join_equality_is_plausible(
        "customer_id", "branch_id", "customers", "loans"
    )


def test_pk_fk_id_pair_is_plausible():
    assert join_equality_is_plausible("id", "customer_id", "customers", "loans")
    assert join_equality_is_plausible("customer_id", "id", "loans", "customers")
    assert join_equality_is_plausible("customer_id", "customer_id", "loans", "customers")


def test_prefer_key_matching_dimension_table():
    assert prefer_shared_join_key(["branch_id", "customer_id"], "customers") == "customer_id"
    assert prefer_shared_join_key(["branch_id", "customer_id"], "branches") == "branch_id"


def test_detects_mismatched_join_in_user_sql():
    found = find_mismatched_id_joins(USER_SQL, BANKING_SCHEMA)
    assert found
    assert found[0]["left_col"].lower() == "customer_id"
    assert found[0]["right_col"].lower() == "branch_id"


def test_rewrites_customer_id_joined_to_branch_id():
    sql, notes = rewrite_mismatched_id_joins(USER_SQL, BANKING_SCHEMA)
    assert notes
    assert "branch_id" not in sql.split("ON", 1)[1].split("GROUP")[0].lower() or (
        "customer_id" in sql.split("ON", 1)[1].split("GROUP")[0].lower()
        and sql.split("ON", 1)[1].count("customer_id") >= 2
    )
    on_clause = sql.split("ON", 1)[1].split("GROUP", 1)[0].lower()
    assert "customer_id" in on_clause
    assert "l." in on_clause and "c." in on_clause
    # Both sides of the equality must be customer_id, not mixed with branch_id.
    assert "branch_id" not in on_clause


def test_leaves_correct_join_unchanged():
    good = (
        "SELECT c.name FROM banking.loans l "
        "JOIN banking.customers c ON c.customer_id = l.customer_id"
    )
    sql, notes = rewrite_mismatched_id_joins(good, BANKING_SCHEMA)
    assert sql == good
    assert notes == []
