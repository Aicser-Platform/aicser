"""Tests for CE NL2SQL schema normalization and resolution."""

import pytest

from src.modules.nl2sql.schema_context import has_usable_schema, normalize_schema, format_schema_for_llm
from src.modules.nl2sql.schema_resolver import infer_file_schema_from_source


def test_legacy_root_columns_file_schema():
    legacy = {
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "amount", "type": "number"},
        ],
        "row_count": 42,
    }
    assert has_usable_schema(legacy)
    normalized = normalize_schema(legacy)
    assert normalized["tables"][0]["name"] == "data"
    assert len(normalized["tables"][0]["columns"]) == 2


def test_nested_schema_by_database():
    nested = {
        "public": {
            "tables": [
                {"name": "orders", "columns": [{"name": "id", "type": "int"}]},
            ]
        }
    }
    assert has_usable_schema(nested)
    tables = normalize_schema(nested)["tables"]
    assert tables[0]["name"] == "orders"
    assert tables[0].get("schema") == "public"


def test_legacy_per_table_dict():
    legacy = {
        "customers": {
            "columns": [{"name": "id"}, {"name": "email"}],
            "rowCount": 100,
        }
    }
    assert has_usable_schema(legacy)
    assert normalize_schema(legacy)["tables"][0]["name"] == "customers"


def test_infer_file_schema_from_sample_data():
    source = {
        "type": "file",
        "schema": {},
        "sample_data": [
            {"product": "Widget", "price": 9.99, "active": True},
            {"product": "Gadget", "price": 14.5, "active": False},
        ],
    }
    schema = infer_file_schema_from_source(source)
    assert has_usable_schema(schema)
    assert schema["tables"][0]["name"] == "data"
    assert len(schema["tables"][0]["columns"]) == 3


def test_format_schema_for_llm_file_source():
    schema = normalize_schema({
        "columns": [{"name": "region", "type": "string"}, {"name": "sales", "type": "number"}],
    })
    text = format_schema_for_llm(schema, query="sales by region")
    assert "data(" in text
    assert "region" in text
