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
