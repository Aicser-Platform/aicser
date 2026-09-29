"""Every mode that runs model-written SQL applies the Analyze path's pre-execution gate,
and mode queries over the `base` CTE use bare column names (context may carry
"table.column", which fails as one quoted identifier)."""

from ee.modules.ai.nodes.mode_query_planner_node import (
    _infer_dimension_candidates,
    _infer_metric,
    _infer_time_col,
)
from ee.modules.ai.utils.sql_gate import pre_execution_gate


def test_gate_allows_normal_sql():
    assert pre_execution_gate("SELECT region, SUM(sales) AS value FROM orders GROUP BY 1") is None


def test_gate_refuses_pii_placeholder_truncated_and_template_sql():
    assert pre_execution_gate("SELECT * FROM customers WHERE name = '<PERSON>'") == "pii_placeholder_in_sql"
    assert pre_execution_gate("SELECT DATE_TRUNC('QUARTER") is not None
    assert pre_execution_gate("") is not None


def test_planner_uses_bare_column_names():
    state = {"execution_metadata": {"mode_parameters": {
        "time_column": "data.document_date",
        "target_metric": '"data"."sales_amount"',
        "focus_dimension_candidates": ["data.region", "channel"],
    }}}
    assert _infer_time_col(state) == "document_date"
    assert _infer_metric(state) == "sales_amount"
    assert _infer_dimension_candidates(state) == ["region", "channel"]
