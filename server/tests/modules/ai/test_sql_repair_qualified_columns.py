"""Prod bug: delegation context carried table-qualified names ("data.document_date") and the
DuckDB repair quoted them as ONE identifier, so every forecast on that source failed with
'Referenced column "data.document_date" not found'."""

import duckdb
import pandas as pd
import pytest

from ee.modules.ai.utils.sql_cleaner import (
    repair_diagnostic_duckdb_truncated_sql_from_context,
    repair_predictive_duckdb_sql_from_data,
)

SCHEMA = {"tables": [{"name": "data", "columns": [
    {"name": "document_date", "type": "DATE"},
    {"name": "Sales_Amount", "type": "DOUBLE"},
    {"name": "region", "type": "VARCHAR"},
]}]}
BROKEN = 'SELECT DATE_TRUNC(\'WEEK\', "data.document_date") AS period, SUM("data.Sales_Amount") AS value FROM "data" GROUP BY 1'


@pytest.fixture()
def con():
    c = duckdb.connect()
    c.register("data", pd.DataFrame({
        "document_date": pd.date_range("2025-01-01", periods=30, freq="D"),
        "Sales_Amount": range(30),
        "region": ["A", "B", "C"] * 10,
    }))
    return c


def test_predictive_repair_uses_bare_exact_column_names(con):
    sql = repair_predictive_duckdb_sql_from_data(BROKEN, SCHEMA, {
        "time_column": "data.document_date",
        "target_metric": "data.sales_amount",  # wrong case too: resolved to the real spelling
        "time_granularity": "weekly",
    })
    assert '"data.' not in sql
    assert '"Sales_Amount"' in sql
    rows = con.execute(sql).fetchall()
    assert len(rows) >= 4 and sum(r[1] for r in rows) == sum(range(30))


def test_diagnostic_repair_strips_table_prefix(con):
    truncated = "SELECT DATE_TRUNC('QUARTER"  # the shape this repair exists for
    sql = repair_diagnostic_duckdb_truncated_sql_from_context(truncated, SCHEMA, {
        "time_column": "data.document_date",
        "target_metric": "data.Sales_Amount",
        "focus_dimension": "data.region",
        "time_granularity": "monthly",
    })
    assert sql != truncated and '"data.' not in sql
    assert con.execute(sql).fetchall()
