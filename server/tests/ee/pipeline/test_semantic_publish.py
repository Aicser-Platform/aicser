import os

os.environ.setdefault("AISER_EDITION", "enterprise")

from src.modules.pipeline.semantic_publish import metric_to_sql_expression, metrics_from_transform_yaml


def test_metric_to_sql_expression_sum():
    assert metric_to_sql_expression({"type": "sum", "column": "amount"}) == "SUM(amount)"


def test_metrics_from_yaml():
    yaml_text = """
version: 1
transform: []
output: {layer: silver, table: orders, write_mode: merge}
semantic:
  fact_table: orders
  metrics:
    - name: total_amount
      type: sum
      column: amount
"""
    metrics = metrics_from_transform_yaml(yaml_text)
    assert len(metrics) == 1
    assert metrics[0]["name"] == "total_amount"
