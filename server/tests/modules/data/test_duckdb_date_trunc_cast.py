"""Tests for casting date_trunc arguments when running against DuckDB.

File-backed data sources (uploaded CSV/Excel) store date columns as VARCHAR, so
`date_trunc('month', disbursement_date)` fails in DuckDB with:
    Binder Error: No function matches 'date_trunc(VARCHAR, VARCHAR)'
The fix wraps the date argument in TRY_CAST(... AS TIMESTAMP) so time-bucketed
queries run instead of being dropped to the heuristic fallback.
"""

from src.modules.data.services.multi_engine_query_service import (
    cast_date_trunc_args_for_duckdb,
)


def test_wraps_bare_column():
    sql = "SELECT date_trunc('month', disbursement_date) AS x FROM \"data\""
    out = cast_date_trunc_args_for_duckdb(sql)
    assert "date_trunc('month', TRY_CAST(disbursement_date AS TIMESTAMP))" in out


def test_wraps_quoted_column():
    sql = 'SELECT date_trunc(\'month\', "disbursement_date") AS period FROM "data"'
    out = cast_date_trunc_args_for_duckdb(sql)
    assert 'date_trunc(\'month\', TRY_CAST("disbursement_date" AS TIMESTAMP))' in out


def test_rewrites_all_occurrences_consistently():
    # SELECT and GROUP BY must stay identical or DuckDB rejects the grouping.
    sql = (
        "SELECT date_trunc('month', disbursement_date) AS x, SUM(term_months) AS y_0 "
        "FROM \"data\" GROUP BY date_trunc('month', disbursement_date)"
    )
    out = cast_date_trunc_args_for_duckdb(sql)
    assert out.count("TRY_CAST(disbursement_date AS TIMESTAMP)") == 2


def test_idempotent_when_already_cast():
    sql = "SELECT date_trunc('month', TRY_CAST(disbursement_date AS TIMESTAMP)) FROM \"data\""
    assert cast_date_trunc_args_for_duckdb(sql) == sql


def test_skips_current_date_keyword():
    sql = "SELECT date_trunc('month', CURRENT_DATE) FROM \"data\""
    assert cast_date_trunc_args_for_duckdb(sql) == sql


def test_no_date_trunc_is_noop():
    sql = "SELECT product_type, SUM(term_months) FROM \"data\" GROUP BY product_type"
    assert cast_date_trunc_args_for_duckdb(sql) == sql
