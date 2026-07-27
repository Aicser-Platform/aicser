"""Workbook authoring: programmatic YAML upsert with comment preservation."""

from pathlib import Path

from ee.modules.semantic.member_edit import upsert_member

SOURCE_YML = """\
data_source_id: ds-123
dialect: duckdb
description: Orders analytics source
"""

ORDERS_YML = """\
# Orders fact table — reviewed 2026-07
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


def _write_dir(root: Path) -> Path:
    d = root / "orders-source"
    d.mkdir(parents=True)
    (d / "_source.yml").write_text(SOURCE_YML)
    (d / "orders.yml").write_text(ORDERS_YML)
    return d


def test_insert_new_metric(tmp_path):
    d = _write_dir(tmp_path)
    result = upsert_member(tmp_path, "ds-123", "orders", "metric", {
        "name": "order_count",
        "type": "simple",
        "measure": "revenue_amount",
        "format": "number",
        "description": "Number of orders",
    })
    assert result["success"] is True
    assert result["issues"] == []
    content = (d / "orders.yml").read_text()
    assert "order_count" in content
    # comment survived the round trip
    assert "# Orders fact table — reviewed 2026-07" in content


def test_update_existing_metric_in_place(tmp_path):
    d = _write_dir(tmp_path)
    result = upsert_member(tmp_path, "ds-123", "orders", "metric", {
        "name": "total_revenue",
        "type": "simple",
        "measure": "revenue_amount",
        "format": "number",
        "description": "Updated description",
    })
    assert result["success"] is True
    content = (d / "orders.yml").read_text()
    assert content.count("total_revenue") == 1
    assert "Updated description" in content
    assert "currency_usd" not in content  # replaced, not duplicated


def test_insert_new_measure(tmp_path):
    d = _write_dir(tmp_path)
    result = upsert_member(tmp_path, "ds-123", "orders", "measure", {
        "name": "order_tally",
        "column": "order_id",
        "agg": "count",
        "description": "Row count",
    })
    assert result["success"] is True
    assert "order_tally" in (d / "orders.yml").read_text()


def test_invalid_definition_writes_nothing(tmp_path):
    d = _write_dir(tmp_path)
    before = (d / "orders.yml").read_text()
    result = upsert_member(tmp_path, "ds-123", "orders", "metric", {
        "name": "bad_metric",
        "type": "simple",
        "measure": "nonexistent_measure",
        "description": "refs unknown measure",
    })
    assert result["success"] is False
    assert result["issues"]  # readable validation issues
    assert (d / "orders.yml").read_text() == before  # untouched


def test_invalid_filter_grammar_rejected(tmp_path):
    d = _write_dir(tmp_path)
    before = (d / "orders.yml").read_text()
    result = upsert_member(tmp_path, "ds-123", "orders", "metric", {
        "name": "bad_filter_metric",
        "type": "simple",
        "measure": "revenue_amount",
        "filters": ["status != 'x' OR 1=1"],
        "description": "filter smuggles OR",
    })
    assert result["success"] is False
    assert (d / "orders.yml").read_text() == before


def test_unknown_table_raises(tmp_path):
    _write_dir(tmp_path)
    import pytest
    with pytest.raises(ValueError):
        upsert_member(tmp_path, "ds-123", "nope", "metric", {"name": "m"})


def test_unknown_kind_raises(tmp_path):
    _write_dir(tmp_path)
    import pytest
    with pytest.raises(ValueError):
        upsert_member(tmp_path, "ds-123", "orders", "dimension", {"name": "d"})
