"""Column lineage: recipe columns traced to their source columns; SQL columns read."""

import pytest

pytest.importorskip("duckdb")
pytest.importorskip("sqlglot")

from src.modules.catalog.column_lineage import recipe_column_sources, sql_columns  # noqa: E402

SOURCE = {"amt": "DOUBLE", "qty": "INTEGER", "d": "DATE", "region": "VARCHAR"}


def test_renames_and_new_columns_trace_to_source_columns():
    steps = [
        {"rename": {"columns": {"amt": "amount"}}},
        {"formula": {"into": "total", "expression": "amount * qty"}},
        {"window": {"calc": "running_total", "column": "amount", "into": "rt", "order_by": "d"}},
    ]
    out = recipe_column_sources(steps, SOURCE)
    assert out["traced"] is True
    cols = out["columns"]
    assert cols["amount"] == ["amt"]
    assert cols["total"] == ["amt", "qty"]
    assert "amt" in cols["rt"]
    assert cols["region"] == ["region"]
    assert "amt" not in cols


def test_a_step_it_cannot_bind_stops_the_trace_honestly():
    steps = [{"rename": {"columns": {"amt": "amount"}}}, {"join": {"asset": "other", "on": {"region": "region"}}}]
    out = recipe_column_sources(steps, SOURCE)
    assert out["traced"] is False and out["stopped_at"] == 1
    assert out["columns"]["amount"] == ["amt"]


def test_sql_columns_of_one_table():
    sql = "SELECT l.branch_id, SUM(l.amount) FROM loans l JOIN branches b ON b.id = l.branch_id GROUP BY 1"
    assert sql_columns(sql, "loans") >= {"branch_id", "amount"}
    assert sql_columns("SELECT x FROM other", "loans") == set()
    assert sql_columns("SUM(outstanding_principal) / COUNT(*)") == {"outstanding_principal"}
