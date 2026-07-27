"""Lineage payload builder: manifest + schema columns → graph dict."""

from pathlib import Path

from ee.modules.semantic.lineage import build_lineage

SOURCE_YML = """\
data_source_id: ds-123
dialect: duckdb
description: Orders analytics source
"""

ORDERS_YML = """\
table:
  name: orders
  source: analytics.public.orders
  primary_key: order_id
  description: One row per customer order, all statuses

measures:
  - name: revenue_amount
    column: amount_usd
    agg: sum
    description: Raw summed order value in USD

metrics:
  - name: total_revenue
    type: simple
    measure: revenue_amount
    format: currency_usd
    description: Booked revenue in USD
"""

ITEMS_YML = """\
table:
  name: order_items
  source: analytics.public.order_items
  primary_key: item_id
  description: One row per line item
"""

JOINS_YML = """\
joins:
  - left: order_items
    right: orders
    on: order_items.order_id = orders.order_id
    type: many_to_one
"""

SCHEMA_INFO = {
    "tables": [
        {"name": "orders", "columns": [
            {"name": "order_id", "type": "VARCHAR"},
            {"name": "amount_usd", "type": "DOUBLE"},
        ]},
        {"name": "order_items", "columns": [{"name": "item_id", "type": "VARCHAR"}]},
    ]
}


def _write_dir(root: Path) -> None:
    d = root / "orders-source"
    d.mkdir(parents=True)
    (d / "_source.yml").write_text(SOURCE_YML)
    (d / "orders.yml").write_text(ORDERS_YML)
    (d / "order_items.yml").write_text(ITEMS_YML)
    (d / "joins.yml").write_text(JOINS_YML)


def test_build_lineage_full_graph(tmp_path):
    _write_dir(tmp_path)
    result = build_lineage(tmp_path, "ds-123", SCHEMA_INFO, "AccountingDataSet")
    assert result is not None
    assert result["source"] == {"id": "ds-123", "name": "AccountingDataSet"}
    assert [t["name"] for t in result["tables"]] == ["order_items", "orders"]
    orders = next(t for t in result["tables"] if t["name"] == "orders")
    assert {"name": "amount_usd", "type": "DOUBLE"} in orders["columns"]
    assert result["joins"] == [{
        "from_table": "order_items", "from_column": "order_id",
        "to_table": "orders", "to_column": "order_id",
        "join_type": "many_to_one",
    }]
    assert result["metrics"] == [{
        "name": "total_revenue", "table": "orders", "type": "simple",
        "format": "currency_usd", "certified": True,
        "description": "Booked revenue in USD",
    }]


def test_build_lineage_unknown_source_returns_none(tmp_path):
    _write_dir(tmp_path)
    assert build_lineage(tmp_path, "ds-other", {}, "X") is None


def test_build_lineage_no_schema_columns(tmp_path):
    _write_dir(tmp_path)
    result = build_lineage(tmp_path, "ds-123", {}, "AccountingDataSet")
    assert result is not None
    assert all(t["columns"] == [] for t in result["tables"])
