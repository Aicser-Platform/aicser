"""Compiler must join only referenced tables, in a connected order."""
import pytest

from ee.modules.semantic.compiler import SemanticQueryCompiler, _build_from_clause
from ee.modules.semantic.query_spec import SemanticQuerySpec

SCHEMA = {"tables": [{"name": "fact_sales", "schema": "public",
                      "columns": [{"name": "amount"}, {"name": "device_key"}, {"name": "store_key"}]}]}
JOINS = [
    {"from_table": "fact_sales", "from_column": "device_key",
     "to_table": "dim_device", "to_column": "device_key", "join_type": "LEFT",
     "cardinality": "one_to_many"},
    {"from_table": "fact_sales", "from_column": "store_key",
     "to_table": "dim_store", "to_column": "store_key", "join_type": "LEFT",
     "cardinality": "one_to_many"},
    # disconnected edge: neither side reachable from fact_sales
    {"from_table": "orphan_a", "from_column": "x",
     "to_table": "orphan_b", "to_column": "x", "join_type": "LEFT",
     "cardinality": "one_to_many"},
]
METRICS = [{"id": "m1", "name": "total_sales", "expression": "SUM(fact_sales.amount)",
            "metric_type": "simple", "certified": True}]
DIMS = [
    {"id": "d1", "name": "device_name", "expression": "dim_device.device_name"},
    {"id": "d2", "name": "plain_dim", "expression": "region"},
]


def _compiler():
    return SemanticQueryCompiler(metrics=METRICS, dimensions=DIMS, join_paths=JOINS,
                                 schema_info=SCHEMA, dialect="postgres")


def test_no_joins_when_no_cross_table_reference():
    sql = _compiler().compile(SemanticQuerySpec(
        data_source_id="ds1", metric="total_sales", dimensions=["plain_dim"])).sql
    assert "JOIN" not in sql.upper()


def test_only_needed_join_included():
    compiled = _compiler().compile(SemanticQuerySpec(
        data_source_id="ds1", metric="total_sales", dimensions=["device_name"]))
    assert "JOIN dim_device" in compiled.sql
    assert "dim_store" not in compiled.sql
    assert "orphan" not in compiled.sql
    assert compiled.explain["joins_used"] == 1
    assert compiled.explain["fanout_risk"] is True   # one_to_many join in use


def test_build_from_clause_never_references_missing_table():
    clause, used = _build_from_clause("fact_sales", JOINS, needed_tables={"orphan_b"})
    # orphan_b is unreachable from fact_sales → no join emitted for it
    assert "orphan" not in clause
    assert used == []


def test_diamond_topology_joins_only_one_path():
    diamond_joins = [
        {"from_table": "fact_sales", "from_column": "a_key", "to_table": "path_a",
         "to_column": "a_key", "join_type": "LEFT", "cardinality": "one_to_many"},
        {"from_table": "fact_sales", "from_column": "b_key", "to_table": "path_b",
         "to_column": "b_key", "join_type": "LEFT", "cardinality": "one_to_many"},
        {"from_table": "path_a", "from_column": "target_key", "to_table": "target",
         "to_column": "target_key", "join_type": "LEFT", "cardinality": "one_to_many"},
        {"from_table": "path_b", "from_column": "target_key", "to_table": "target",
         "to_column": "target_key", "join_type": "LEFT", "cardinality": "one_to_many"},
    ]
    clause, used = _build_from_clause("fact_sales", diamond_joins, needed_tables={"target"})
    joined_tables = {j["to_table"] for j in used} | {j["from_table"] for j in used}
    assert "target" in joined_tables
    assert not ("path_a" in joined_tables and "path_b" in joined_tables), (
        "only one branch of the diamond should be joined, not both"
    )
