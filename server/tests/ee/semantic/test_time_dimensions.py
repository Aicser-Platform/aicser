from ee.modules.semantic.compiler import SemanticQueryCompiler, _date_trunc
from ee.modules.semantic.query_spec import SemanticQuerySpec
from src.modules.semantic_domains.core import clean_calendar


def test_fiscal_grains_and_week_start_follow_the_calendar():
    april = {"fiscal_year_start_month": 4, "week_start": "sunday"}
    assert _date_trunc("d", "fiscal_year", "duckdb", april) == "(DATE_TRUNC('year', d - INTERVAL '3 months') + INTERVAL '3 months')"
    assert _date_trunc("d", "fiscal_quarter", "duckdb", april).startswith("(DATE_TRUNC('quarter', d - INTERVAL '3 months')")
    assert _date_trunc("d", "fiscal_year", "duckdb", {}) == "DATE_TRUNC('year', d)"
    assert _date_trunc("d", "week", "duckdb", april) == "(DATE_TRUNC('week', d + INTERVAL '1 day') - INTERVAL '1 day')"
    assert _date_trunc("d", "week", "duckdb", {}) == "DATE_TRUNC('week', d)"


def test_declared_time_dimensions_use_their_default_grain():
    dims = [{"name": "ordered", "expression": "orders.ordered_at", "dimension_type": "time", "default_grain": "month"},
            {"name": "created_at", "expression": "orders.created_at", "dimension_type": "category"}]
    c = SemanticQueryCompiler(metrics=[{"name": "n", "expression": "COUNT(*)"}], dimensions=dims, join_paths=[],
                              schema_info={"tables": [{"name": "orders", "columns": []}]}, dialect="duckdb")
    sql = c.compile(SemanticQuerySpec(data_source_id="x", metric="n", dimensions=["ordered", "created_at"], limit=5)).sql
    assert "DATE_TRUNC('month', orders.ordered_at)" in sql
    assert "DATE_TRUNC('month', orders.created_at)" not in sql  # declared category: not bucketed


def test_calendar_values_are_checked():
    assert clean_calendar({"fiscal_year_start_month": 7, "week_start": "sunday"}) == {"fiscal_year_start_month": 7, "week_start": "sunday"}
    assert clean_calendar({"fiscal_year_start_month": 13, "week_start": "friday"}) == {"fiscal_year_start_month": 1, "week_start": "monday"}
