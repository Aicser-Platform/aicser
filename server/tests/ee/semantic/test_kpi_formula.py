import pytest

from ee.modules.semantic.compiler import SemanticQueryCompiler, _compile_metric_expression
from ee.modules.semantic.formula import FormulaError, check_formula, expand
from ee.modules.semantic.query_spec import SemanticQuerySpec

METRICS = [
    {"name": "revenue", "expression": "SUM(orders.amount)"},
    {"name": "orders", "expression": "COUNT(DISTINCT orders.id)"},
    {"name": "aov", "expression": "x", "metric_type": "derived", "type_params": {"formula": "{revenue} / NULLIF({orders}, 0)"}},
    {"name": "aov_pct", "expression": "x", "type_params": {"formula": "{aov} * 100"}},
]
BY_NAME = {m["name"]: m for m in METRICS}


def compile_kpi(name):
    return _compile_metric_expression(BY_NAME[name], BY_NAME)


def test_kpis_expand_into_their_metrics_even_nested():
    assert compile_kpi("aov") == "(SUM(orders.amount)) / NULLIF((COUNT(DISTINCT orders.id)), 0)"
    assert compile_kpi("aov_pct") == "((SUM(orders.amount)) / NULLIF((COUNT(DISTINCT orders.id)), 0)) * 100"


def test_formulas_allow_only_names_numbers_and_arithmetic():
    assert check_formula("({revenue} - {cost}) / NULLIF({revenue}, 0)") == ["revenue", "cost"]
    for bad in ("", "{revenue}; DROP TABLE x", "SUM(amount)", "{revenue} / (", "42"):
        with pytest.raises(FormulaError):
            check_formula(bad)


def test_unknown_and_circular_references_are_refused():
    with pytest.raises(FormulaError):
        expand("{nope}", BY_NAME, lambda m, seen: _compile_metric_expression(m, BY_NAME, seen))
    loop = {"a": {"name": "a", "type_params": {"formula": "{b}"}}, "b": {"name": "b", "type_params": {"formula": "{a}"}}}
    with pytest.raises(FormulaError):
        _compile_metric_expression(loop["a"], loop)


def test_a_kpi_compiles_into_a_query():
    c = SemanticQueryCompiler(metrics=METRICS, dimensions=[], join_paths=[], schema_info={"tables": [{"name": "orders", "columns": []}]}, dialect="duckdb")
    sql = c.compile(SemanticQuerySpec(data_source_id="x", metric="aov", dimensions=[], limit=1)).sql
    assert "SUM(orders.amount)) / NULLIF((COUNT(DISTINCT orders.id)), 0) AS metric_value" in sql
