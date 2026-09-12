"""Schema bind: LLM SQL must use columns that exist on the FROM/JOIN tables."""

from src.shared.sql_schema_bind import (
    bind_sql_to_schema,
    find_unbound_qualified_columns,
    format_join_paths_for_llm,
    is_unbound_column_error,
    rewrite_invented_join_tables,
)

BANKING_SAMPLE = {
    "tables": [
        {
            "name": "accounts",
            "schema": "banking",
            "columns": [
                {"name": "account_id"},
                {"name": "customer_id"},
                {"name": "current_balance"},
                {"name": "available_balance"},
            ],
        },
        {
            "name": "transactions",
            "schema": "banking",
            "columns": [
                {"name": "transaction_id"},
                {"name": "branch_id"},
                {"name": "transaction_type"},
                {"name": "amount"},
                {"name": "value_date"},
            ],
        },
        {
            "name": "payments",
            "schema": "banking",
            "columns": [
                {"name": "payment_id"},
                {"name": "account_id"},
                {"name": "total_amount"},
                {"name": "value_date"},
            ],
        },
        {
            "name": "customers",
            "schema": "banking",
            "columns": [
                {"name": "customer_id"},
                {"name": "name"},
            ],
        },
        {
            "name": "branches",
            "schema": "banking",
            "columns": [
                {"name": "branch_id"},
                {"name": "name"},
            ],
        },
    ]
}

INVENTED_JOIN_SQL = """
SELECT
  DATE_TRUNC('MONTH', "value_date") AS "month",
  COUNT(DISTINCT "customer_id") AS "total_customers"
FROM banking.accounts AS a
JOIN banking.transactions AS t ON a."account_id" = t."account_id"
WHERE NOT "value_date" IS NULL
GROUP BY 1
ORDER BY 1
LIMIT 100
"""

DUCKDB_BINDER = (
    'Binder Error: Table "t" does not have a column named "account_id" '
    'Candidate bindings: : "amount" LINE 1: ... AS a JOIN banking.transactions AS t '
    'ON a."account_id" = t."account_id" WHERE NOT "value_date" IS NULL GROUP BY 1... ^'
)


def test_detects_invented_join_column_on_wrong_table():
    issues = find_unbound_qualified_columns(INVENTED_JOIN_SQL, BANKING_SAMPLE)
    assert issues
    assert any(
        i.alias.lower() == "t" and i.column.lower() == "account_id" and i.in_on_clause
        for i in issues
    )


def test_does_not_flag_real_qualified_columns():
    sql = (
        'SELECT a."customer_id" FROM banking.accounts AS a '
        'JOIN banking.customers AS c ON a."customer_id" = c."customer_id"'
    )
    assert find_unbound_qualified_columns(sql, BANKING_SAMPLE) == []


def test_rewrite_substitutes_unique_table_that_has_the_key():
    sql, notes = rewrite_invented_join_tables(INVENTED_JOIN_SQL, BANKING_SAMPLE)
    assert notes
    assert "payments" in sql.lower()
    assert "transactions" not in sql.lower()
    bound = bind_sql_to_schema(sql, BANKING_SAMPLE, rewrite=False)
    assert bound.ok


def test_no_rewrite_when_alias_uses_columns_donor_lacks():
    sql = (
        'SELECT t."transaction_type", a."customer_id" '
        'FROM banking.accounts AS a '
        'JOIN banking.transactions AS t ON a."account_id" = t."account_id"'
    )
    rewritten, notes = rewrite_invented_join_tables(sql, BANKING_SAMPLE)
    assert notes == []
    assert "transactions" in rewritten.lower()
    issues = find_unbound_qualified_columns(rewritten, BANKING_SAMPLE)
    assert any(i.column.lower() == "account_id" for i in issues)


def test_no_rewrite_when_no_unique_donor():
    schema = {
        "tables": [
            BANKING_SAMPLE["tables"][0],  # accounts
            BANKING_SAMPLE["tables"][1],  # transactions — no account_id
        ]
    }
    sql, notes = rewrite_invented_join_tables(INVENTED_JOIN_SQL, schema)
    assert notes == []
    issues = find_unbound_qualified_columns(sql, schema)
    assert issues


def test_join_paths_list_shared_keys_only():
    text = format_join_paths_for_llm(BANKING_SAMPLE)
    assert "JOIN PATHS" in text
    assert "account_id" in text
    assert "payments" in text
    lower = text.lower()
    assert "banking.accounts" in lower and "banking.payments" in lower
    # accounts × transactions is not a listed path
    compact = text.replace(" ", "").lower()
    assert "accounts↔banking.transactions" not in compact
    assert "accounts ↔ banking.transactions" not in text.lower()


def test_join_paths_say_no_join_when_tables_share_nothing():
    schema = {
        "tables": [
            {"name": "alpha", "columns": [{"name": "x"}]},
            {"name": "beta", "columns": [{"name": "y"}]},
        ]
    }
    text = format_join_paths_for_llm(schema)
    assert "share no" in text.lower()
    assert "never invent" in text.lower()


def test_duckdb_binder_missing_column_is_unbound_error():
    assert is_unbound_column_error(DUCKDB_BINDER)
    assert is_unbound_column_error(
        'Binder Error: Referenced column "disbursement_date" not found in FROM clause!'
    )
    assert is_unbound_column_error('column "foo" does not exist')
    assert is_unbound_column_error("Unknown column 'bar' in 'field list'")
    assert is_unbound_column_error("invalid column name 'baz'")
    assert not is_unbound_column_error("syntax error at or near FROM")


def test_bind_sql_to_schema_rewrites_then_clears_issues():
    result = bind_sql_to_schema(INVENTED_JOIN_SQL, BANKING_SAMPLE)
    assert result.rewrites
    assert result.ok
    assert "payments" in result.sql.lower()


def test_empty_schema_is_noop():
    result = bind_sql_to_schema("SELECT 1 FROM t", None)
    assert result.ok
    assert result.sql == "SELECT 1 FROM t"


def test_schema_format_includes_join_paths():
    from ee.modules.ai.utils.schema_for_llm import format_schema_for_llm

    out = format_schema_for_llm(
        BANKING_SAMPLE,
        query="customers over time",
        max_tables=10,
        max_columns_per_table=20,
        include_summary_line=False,
    )
    assert "JOIN PATHS" in out
    assert "account_id" in out
    assert "transactions" in out
