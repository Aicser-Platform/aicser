"""File sources: dimension expressions must use DuckDB physical table names."""

import re

from ee.modules.semantic.compiler import SemanticQueryCompiler
from ee.modules.semantic.query_spec import SemanticQuerySpec


def test_rewrites_sheet1_to_physical_table_in_expressions():
    schema = {
        "duckdb_tables": {"Sheet1": "sheet_0_Sheet1"},
        "tables": [
            {
                "name": "sheet_0_Sheet1",
                "logical_name": "Sheet1",
                "columns": [{"name": "Class", "type": "VARCHAR"}],
            }
        ],
    }
    metrics = [
        {"name": "total_Sheet1", "expression": "COUNT(*)", "table": "Sheet1", "metric_type": "simple"},
    ]
    dimensions = [
        {"name": "Class", "expression": "Sheet1.Class"},
    ]
    compiler = SemanticQueryCompiler(
        metrics=metrics,
        dimensions=dimensions,
        join_paths=[],
        schema_info=schema,
        dialect="duckdb",
    )
    compiled = compiler.compile(
        SemanticQuerySpec(data_source_id="ds1", metric="total_Sheet1", dimensions=["Class"], limit=10),
    )
    assert "FROM sheet_0_Sheet1" in compiled.sql
    assert "sheet_0_Sheet1.Class" in compiled.sql
    assert re.search(r'(?<![\w_\"])Sheet1\.', compiled.sql) is None


def test_single_file_metric_reads_on_the_upload_name_and_runs_on_data():
    """A metric on an uploaded CSV is SUM(<upload>.col). The compiled SQL keeps the upload's
    name (what people see in the SQL editor), and the query engine runs it on "data"."""
    from ee.modules.ai.utils.schema_normalization import file_schema_with_tables
    from src.modules.data.services.multi_engine_query_service import rewrite_file_duckdb_table_refs

    stored = {"columns": [{"name": "amount", "type": "number"}, {"name": "province", "type": "string"}]}
    metrics = [{"name": "total_amount", "expression": "SUM(loans.amount)"}]
    dimensions = [{"name": "province", "expression": "loans.province", "dimension_type": "category"}]
    spec = SemanticQuerySpec(data_source_id="ds1", metric="total_amount", dimensions=["province"], limit=10)

    sql = SemanticQueryCompiler(
        metrics, dimensions, [], schema_info=file_schema_with_tables(stored, "loans"), dialect="file"
    ).compile(spec).sql
    assert "FROM loans" in sql and "SUM(loans.amount)" in sql
    assert '"data"' not in sql

    runs, error, _ = rewrite_file_duckdb_table_refs(sql, {"schema": stored})
    assert error is None
    assert 'FROM "data"' in runs and 'SUM("data".amount)' in runs and "loans." not in runs
