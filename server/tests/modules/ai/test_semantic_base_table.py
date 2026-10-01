"""Governed/inferred metrics compile against the table they measure — never the first table."""

import pytest

from ee.modules.semantic.compiler import _metric_base_table

MULTI = {"tables": [{"schema": "retail", "name": "inventory"}, {"schema": "retail", "name": "orders"}]}


def test_expression_qualifier_names_the_table():
    assert _metric_base_table({"name": "order_total", "expression": "SUM(orders.order_total)"}, MULTI) == ("retail", "orders")


def test_declared_table_wins():
    assert _metric_base_table({"name": "n", "expression": "COUNT(*)", "table": "orders"}, MULTI) == ("retail", "orders")


def test_ambiguous_metric_on_multi_table_source_is_refused():
    with pytest.raises(ValueError):
        _metric_base_table({"name": "total_orders", "expression": "COUNT(*)"}, MULTI)


def test_single_file_source_keeps_data_table():
    assert _metric_base_table({"name": "n", "expression": "COUNT(*)"}, {"columns": [{"name": "a"}]}) == ("main", "data")
