"""Metric detection by column name must match words, not substrings: "count"
inside "country" made Forecast/Diagnose SUM() a text column and fail."""

import pytest

from ee.modules.ai.utils.mode_sql_builders import reconcile_timeseries_fields
from ee.modules.ai.utils.schema_normalization import (extract_columns_from_schema,
                                                      looks_like_metric_name)


@pytest.mark.parametrize("name,ctype", [
    ("total_amount", "double"),
    ("order_count", "int64"),
    ("subtotal", ""),
    ("UnitPrice", ""),
    ("amount", "VARCHAR"),  # CSV numbers typed as text still count by exact word
    ("discount_pct", "int64"),
])
def test_metric_names(name, ctype):
    assert looks_like_metric_name(name, ctype)


@pytest.mark.parametrize("name,ctype", [
    ("country", "string"),
    ("country", ""),
    ("account_name", "string"),
    ("summary", "string"),
    ("corporate_segment", "string"),
])
def test_non_metric_names(name, ctype):
    assert not looks_like_metric_name(name, ctype)


ECOMMERCE = {"tables": [
    {"name": "customers", "columns": [
        {"name": "customer_id", "type": "string"}, {"name": "country", "type": "string"},
        {"name": "signup_date", "type": "string"}]},
    {"name": "orders", "columns": [
        {"name": "order_id", "type": "string"}, {"name": "customer_id", "type": "string"},
        {"name": "order_date", "type": "string"}, {"name": "total_amount", "type": "double"}]},
]}


def test_country_is_a_dimension_not_a_metric():
    cols = extract_columns_from_schema(ECOMMERCE)
    assert "country" not in cols["metric_columns"]
    assert "total_amount" in cols["metric_columns"]


def test_reconcile_drops_a_text_typed_metric():
    time_col, metric = reconcile_timeseries_fields(ECOMMERCE, "order_date", "country")
    assert (time_col, metric) == ("order_date", "total_amount")


def test_fallback_dimension_is_categorical_not_a_text_date_or_a_person():
    from ee.modules.ai.utils.mode_sql_builders import infer_dimension_from_schema

    orders = {"tables": [{"name": "orders", "columns": [
        {"name": "order_id", "type": "string"}, {"name": "order_date", "type": "string"},
        {"name": "status", "type": "string"}, {"name": "total_amount", "type": "double"}]}]}
    assert infer_dimension_from_schema(orders) == "status"
    people = {"tables": [{"name": "customers", "columns": [
        {"name": "first_name", "type": "string"}, {"name": "email", "type": "string"},
        {"name": "country", "type": "string"}]}]}
    assert infer_dimension_from_schema(people) == "country"


def test_prescriptive_baseline_is_weighted_by_rows():
    """Per-lever averages must be weighted: the plain mean made a 1-order group
    count as much as a 100-order one (AOV $1,361 reported vs $720 actual)."""
    import pandas as pd

    from ee.modules.ai.utils.data_profiler import profile_dataframe
    from ee.modules.ai.utils.prescriptive_engine import run_prescriptive

    df = pd.DataFrame({"option": ["a", "b", "c"], "avg_value": [100.0, 1000.0, 1000.0], "rows": [98, 1, 1]})
    profile = profile_dataframe(df)
    result = run_prescriptive(df, profile, "avg_value")
    assert result.baseline["mean"] == pytest.approx((100 * 98 + 1000 + 1000) / 100)


CERTIFIED = [
    {"name": "net_revenue", "certified": True, "is_active": True,
     "expression": "SUM(CASE WHEN is_revenue THEN line_revenue ELSE 0 END)",
     "description": "Net revenue. Use for any 'revenue' or 'sales' question."},
    {"name": "gross_revenue", "certified": True, "is_active": True,
     "expression": "SUM(CASE WHEN is_revenue AND NOT is_return THEN line_revenue ELSE 0 END)",
     "description": "Revenue before returns."},
    {"name": "revenue_orders", "certified": True, "is_active": True,
     "expression": "COUNT(DISTINCT CASE WHEN is_revenue THEN order_id END)", "description": "Orders counting toward revenue."},
    {"name": "cancel_refund_rate", "certified": True, "is_active": True,
     "expression": "COUNT(DISTINCT CASE WHEN is_cancelled_or_refunded THEN order_id END) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0)",
     "description": "Share of orders cancelled or refunded."},
    {"name": "draft_metric", "certified": False, "is_active": True, "expression": "SUM(quantity)", "description": ""},
]
LINES = {"tables": [{"name": "order_items", "columns": [
    {"name": "order_item_id", "type": "string"}, {"name": "order_id", "type": "string"},
    {"name": "order_date", "type": "date32[day]"}, {"name": "status", "type": "string"},
    {"name": "payment_method", "type": "string"}, {"name": "category", "type": "string"},
    {"name": "line_revenue", "type": "decimal128(12, 2)"}, {"name": "is_revenue", "type": "bool"},
    {"name": "is_return", "type": "bool"}, {"name": "is_cancelled_or_refunded", "type": "bool"}]}]}


@pytest.mark.parametrize("question,expected", [
    ("Forecast monthly order revenue for the next 3 months", "net_revenue"),
    ("Animate total sales by payment method over time", "net_revenue"),
    ("Show gross revenue by month", "gross_revenue"),
    ("Why are so many orders cancelled or refunded?", "cancel_refund_rate"),
    ("How many customers signed up?", None),
])
def test_pick_certified_metric(question, expected):
    from ee.modules.ai.utils.mode_sql_builders import pick_certified_metric

    picked = pick_certified_metric(CERTIFIED, question)
    assert (picked or {}).get("name") == expected


def _lines_db():
    import duckdb

    c = duckdb.connect()
    c.execute("""CREATE TABLE order_items AS SELECT * FROM (VALUES
        ('l1','o1',DATE '2026-01-05','Shipped','Credit Card','Toys',100.00,true,false,false),
        ('l2','o1',DATE '2026-01-05','Shipped','Credit Card','Toys',-20.00,true,true,false),
        ('l3','o2',DATE '2026-01-09','Cancelled','Debit Card','Books',50.00,false,false,true),
        ('l4','o3',DATE '2026-02-02','Pending','Debit Card','Books',70.00,true,false,false))
        t(order_item_id, order_id, order_date, status, payment_method, category, line_revenue, is_revenue, is_return, is_cancelled_or_refunded)""")
    return c


def test_forecast_uses_the_certified_revenue_expression():
    from ee.modules.ai.utils.mode_sql_builders import build_mode_contract_sql

    sql = build_mode_contract_sql(
        "predictive", LINES, {"time_column": "order_date", "target_metric": "line_revenue"},
        db_type="duckdb", data_source_type="lakehouse_iceberg",
        certified_metrics=CERTIFIED, query="Forecast monthly revenue")
    rows = _lines_db().execute(sql).fetchall()
    # Net of the cancelled order (50) and the return (-20): Jan 80, Feb 70 -- not SUM(line_revenue)=130/70
    assert [float(v) for _, v in rows] == [80.0, 70.0]


def test_status_rate_is_not_broken_down_by_status():
    from ee.modules.ai.utils.mode_sql_builders import build_mode_contract_sql

    sql = build_mode_contract_sql(
        "diagnostic", LINES, {"time_column": "order_date", "focus_dimension": "status"},
        db_type="duckdb", data_source_type="lakehouse_iceberg",
        certified_metrics=CERTIFIED, query="Why are so many orders cancelled or refunded?")
    assert '"status" AS focus_dimension' not in sql
    assert '"payment_method" AS focus_dimension' in sql
    # A rate is one value per payment method, not per month (months get summed downstream)
    rows = dict(_lines_db().execute(sql).fetchall())
    assert {k: float(v) for k, v in rows.items()} == {"Debit Card": 0.5, "Credit Card": 0.0}


def test_uncertified_or_unmatched_metrics_keep_the_column_builders():
    from ee.modules.ai.utils.mode_sql_builders import build_mode_contract_sql

    sql = build_mode_contract_sql(
        "predictive", LINES, {"time_column": "order_date", "target_metric": "line_revenue"},
        db_type="duckdb", data_source_type="lakehouse_iceberg",
        certified_metrics=[m for m in CERTIFIED if not m["certified"]], query="Forecast monthly revenue")
    assert 'SUM("line_revenue")' in sql
