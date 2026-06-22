import pytest

from src.modules.nl2sql.dialect import get_dialect_rules, get_dialect_system_prompt_line
from src.modules.nl2sql.schema_context import get_relevant_schema_subset, has_usable_schema


def test_dialect_rules_duckdb():
    rules = get_dialect_rules("duckdb", "file")
    assert "DuckDB" in rules
    assert "data" in rules.lower()


def test_dialect_rules_clickhouse():
    line = get_dialect_system_prompt_line("clickhouse")
    assert "ClickHouse" in line


def test_schema_pruning_keeps_relevant_table():
    schema = {
        "tables": [
            {"name": "orders", "columns": [{"name": "id"}, {"name": "amount"}]},
            {"name": "customers", "columns": [{"name": "id"}, {"name": "name"}]},
            {"name": "products", "columns": [{"name": "sku"}]},
        ]
    }
    assert has_usable_schema(schema)
    subset = get_relevant_schema_subset(schema, "total order amount by customer", data_source_type="database")
    names = [t["name"] for t in (subset or {}).get("tables", [])]
    assert "orders" in names
