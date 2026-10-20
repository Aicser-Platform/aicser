from ee.modules.semantic.compiler import SemanticQueryCompiler
from ee.modules.semantic.query_spec import SemanticQuerySpec

SCHEMA = {"tables": [{"schema": "banking", "name": n, "columns": []} for n in ("accounts", "loans", "branches", "customers")]}
JOINS = [
    {"from_table": "loans", "from_column": "branch_id", "to_table": "branches", "to_column": "branch_id"},
    {"from_table": "accounts", "from_column": "customer_id", "to_table": "customers", "to_column": "customer_id"},
]


def compile_sql(metric_expr, dims=()):
    dimensions = [{"name": "region", "expression": "branches.region"}, {"name": "segment", "expression": "customers.segment"}]
    c = SemanticQueryCompiler(metrics=[{"name": "m", "expression": metric_expr}], dimensions=dimensions,
                              join_paths=JOINS, schema_info=SCHEMA, dialect="duckdb")
    return c.compile(SemanticQuerySpec(data_source_id="x", metric="m", dimensions=list(dims), limit=5)).sql


def test_no_joins_when_the_metric_needs_one_table():
    sql = compile_sql("SUM(banking.accounts.current_balance)")
    assert "FROM banking.accounts" in sql and "JOIN" not in sql


def test_joins_only_the_path_to_a_dimension_table_in_either_direction():
    sql = compile_sql("SUM(loans.amount)", dims=["region"])
    assert "FROM banking.loans LEFT JOIN banking.branches ON loans.branch_id = branches.branch_id" in sql
    assert "customers" not in sql

    sql = compile_sql("COUNT(DISTINCT customers.customer_id)", dims=[])
    assert "JOIN" not in sql
