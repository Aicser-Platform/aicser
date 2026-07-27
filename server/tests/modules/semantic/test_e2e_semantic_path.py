"""End-to-end: NL question → LLM spec (mocked) → YAML-defined metric → SQL → rows.

Exercises the full governed chain without a database: YAML files are loaded and
mapped exactly as sync would write them, the compiler consumes that context, and
execution is mocked.
"""

import json

from ee.modules.semantic.loader import load_semantic_dir, parse_join_on
from ee.modules.semantic.runtime import parse_semantic_query_spec_from_text
from ee.modules.semantic.service import run_query
from ee.modules.semantic.sync import build_dimension_row, build_metric_row

from tests.modules.semantic.test_loader import _full_dir

# What the (mocked) LLM answers to:
#   "Total revenue by country, excluding refunds"
LLM_RESPONSE = """
Here is the governed query.
semantic_query_spec:
{"semantic_query_spec": true,
 "data_source_id": "ds-123",
 "metric": "total_revenue",
 "dimensions": ["country"],
 "filters": [],
 "limit": 100}
"""


def _context_from_yaml(tmp_path):
    """Assemble compiler context exactly as sync writes it to the DB."""
    manifest, issues = load_semantic_dir(_full_dir(tmp_path))
    assert issues == []

    metrics, dimensions, joins = [], [], []
    for table_file in manifest.tables:
        measures = {m.name: m for m in table_file.measures}
        for metric in table_file.metrics:
            row = build_metric_row(metric, measures)
            metrics.append({
                "name": row["name"],
                "expression": row["expression"],
                "metric_type": row["metric_type"],
                "type_params": row["type_params"],
                "certified": row["certified"],
            })
        for dim in table_file.dimensions:
            drow = build_dimension_row(dim)
            dimensions.append({"name": drow["name"], "expression": drow["expression"]})
    for join in manifest.joins:
        ft, fc, tt, tc = parse_join_on(join.on)
        joins.append({
            "from_table": ft, "from_column": fc, "to_table": tt, "to_column": tc,
            "join_type": "LEFT", "cardinality": join.type,
        })

    return {
        "metrics": metrics,
        "dimensions": dimensions,
        "join_paths": joins,
        "time_spines": [],
        "schema_info": {"tables": [{"name": "orders", "schema": "public"}]},
        "dialect": "postgres",
    }


async def test_nl_question_to_rows(tmp_path):
    spec = parse_semantic_query_spec_from_text(LLM_RESPONSE)
    assert spec and spec["metric"] == "total_revenue"

    ctx = _context_from_yaml(tmp_path)

    async def load_context(data_source_id, project_id=None):
        return ctx

    captured = {}

    async def execute(sql):
        captured["sql"] = sql
        return [
            {"country": "Cambodia", "metric_value": 1200.5},
            {"country": "Thailand", "metric_value": 830.0},
        ]

    result = await run_query(spec, _load_context=load_context, _execute=execute)

    assert result["success"] is True
    assert len(result["rows"]) == 2

    sql = captured["sql"]
    # metric filter from YAML materialized as a filtered aggregate
    assert "SUM(CASE WHEN status != 'refunded' THEN amount_usd END)" in sql
    # clean.map applied to the country dimension
    assert "CASE ship_country WHEN 'KH' THEN 'Cambodia' ELSE ship_country END" in sql
    assert "GROUP BY" in sql and "LIMIT 100" in sql


async def test_llm_typo_gets_recoverable_error(tmp_path):
    ctx = _context_from_yaml(tmp_path)

    async def load_context(data_source_id, project_id=None):
        return ctx

    result = await run_query(
        {"data_source_id": "ds-123", "metric": "total_revenu", "dimensions": []},
        _load_context=load_context,
        _execute=None,
    )
    assert result["success"] is False
    assert "unknown_metric" in result["error"]
    # the error lists valid metric names so the LLM can self-correct
    assert "total_revenue" in result["error"]
