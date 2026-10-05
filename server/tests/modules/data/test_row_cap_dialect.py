"""The hard row cap re-writes SQL; for DuckDB-run sources it must keep DuckDB syntax."""

from src.modules.data.services.multi_engine_query_service import cap_query_row_limit

# What the wizard's Semantic step runs: measures over the Silver columns of an Excel sheet
SILVER_MEASURE = (
    "SELECT COUNT(order_id) AS n FROM (SELECT TRY_STRPTIME(CAST(\"order_date\" AS VARCHAR), "
    "['%d-%m-%Y', '%Y-%m-%d']) AS \"order_date\", \"order_id\" FROM \"orders\") AS orders"
)


def test_duckdb_list_literals_survive_the_row_cap():
    out = cap_query_row_limit(SILVER_MEASURE, "duckdb")

    assert "['%d-%m-%Y', '%Y-%m-%d']" in out  # used to become ARRAY('%d-%m-%Y', ...): a DuckDB parse error
    assert "ARRAY(" not in out
    assert out.rstrip().upper().endswith("LIMIT 10000")


def test_duckdb_capped_sql_runs():
    import duckdb

    conn = duckdb.connect()
    conn.execute("CREATE TABLE orders AS SELECT * FROM (VALUES ('O1', '27-12-2024'), ('O2', '2025-03-20')) t(order_id, order_date)")

    assert conn.execute(cap_query_row_limit(SILVER_MEASURE, "duckdb")).fetchone()[0] == 2
