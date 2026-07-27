"""Structural validation of the native semantic YAML schema (pydantic models)."""

import pytest
from pydantic import ValidationError

from ee.modules.semantic.yaml_schema import (
    Dimension,
    JoinDef,
    Measure,
    Metric,
    SourceBinding,
    TableFile,
)


def _orders_table(**overrides):
    doc = {
        "table": {
            "name": "orders",
            "source": "analytics.public.orders",
            "primary_key": "order_id",
            "description": "One row per customer order, all statuses",
        },
        "dimensions": [
            {
                "name": "order_date",
                "column": "created_at",
                "type": "time",
                "granularity": ["day", "week", "month", "year"],
                "description": "Date the order was placed",
            },
            {
                "name": "country",
                "column": "ship_country",
                "type": "categorical",
                "description": "Shipping destination country",
                "clean": {"map": {"KH": "Cambodia"}},
                "sample_values": ["Cambodia", "Thailand"],
            },
        ],
        "measures": [
            {
                "name": "revenue_amount",
                "column": "amount_usd",
                "agg": "sum",
                "description": "Raw summed order value in USD",
            }
        ],
        "metrics": [
            {
                "name": "total_revenue",
                "label": "Total revenue",
                "type": "simple",
                "measure": "revenue_amount",
                "filters": ["status != 'refunded'"],
                "format": "currency_usd",
                "description": "Booked revenue in USD, excluding refunds",
            },
            {
                "name": "refund_rate",
                "label": "Refund rate",
                "type": "ratio",
                "numerator": {
                    "measure": "revenue_amount",
                    "filters": ["status = 'refunded'"],
                },
                "denominator": {"measure": "revenue_amount"},
                "format": "percent",
                "description": "Share of revenue refunded",
            },
        ],
    }
    doc.update(overrides)
    return doc


def test_valid_table_file_parses():
    tf = TableFile(**_orders_table())
    assert tf.table.name == "orders"
    assert tf.dimensions[1].clean.map == {"KH": "Cambodia"}
    assert tf.metrics[0].type == "simple"
    assert tf.metrics[1].denominator.measure == "revenue_amount"


def test_missing_dimension_description_fails():
    doc = _orders_table()
    del doc["dimensions"][0]["description"]
    with pytest.raises(ValidationError, match="description"):
        TableFile(**doc)


def test_granularity_on_categorical_dimension_fails():
    with pytest.raises(ValidationError, match="granularity"):
        Dimension(
            name="country",
            column="ship_country",
            type="categorical",
            granularity=["month"],
            description="x",
        )


def test_unknown_granularity_fails():
    with pytest.raises(ValidationError, match="granularity"):
        Dimension(
            name="order_date",
            column="created_at",
            type="time",
            granularity=["fortnight"],
            description="x",
        )


def test_clean_map_on_time_dimension_fails():
    with pytest.raises(ValidationError, match="clean"):
        Dimension(
            name="order_date",
            column="created_at",
            type="time",
            clean={"map": {"a": "b"}},
            description="x",
        )


def test_unknown_agg_fails():
    with pytest.raises(ValidationError, match="agg"):
        Measure(name="m", column="c", agg="median", description="x")


def test_ratio_without_numerator_fails():
    with pytest.raises(ValidationError, match="numerator"):
        Metric(name="r", type="ratio", description="x")


def test_simple_without_measure_fails():
    with pytest.raises(ValidationError, match="measure"):
        Metric(name="s", type="simple", description="x")


def test_metric_referencing_missing_measure_fails():
    doc = _orders_table()
    doc["metrics"][0]["measure"] = "does_not_exist"
    with pytest.raises(ValidationError, match="does_not_exist"):
        TableFile(**doc)


def test_duplicate_measure_names_fail():
    doc = _orders_table()
    doc["measures"].append(dict(doc["measures"][0]))
    with pytest.raises(ValidationError, match="duplicate"):
        TableFile(**doc)


def test_many_to_many_join_fails():
    with pytest.raises(ValidationError):
        JoinDef(
            left="order_items",
            right="orders",
            on="order_items.order_id = orders.order_id",
            type="many_to_many",
        )


def test_non_snake_case_name_fails():
    with pytest.raises(ValidationError, match="snake_case"):
        Measure(name="Revenue Amount", column="amount_usd", agg="sum", description="x")


def test_extra_keys_rejected():
    with pytest.raises(ValidationError):
        SourceBinding(data_source_id="ds1", dialect="postgres", surprise=True)
