"""Sync: SemanticManifest → deterministic upserts into the semantic tables."""

import uuid

import pytest

from ee.modules.semantic.loader import load_semantic_dir
from ee.modules.semantic.sync import (
    build_dimension_row,
    build_metric_row,
    deterministic_id,
    sync_manifest,
)
from ee.modules.semantic.yaml_schema import Dimension, Measure, Metric, MetricRef

from tests.modules.semantic.test_loader import _full_dir


REVENUE = Measure(
    name="revenue_amount", column="amount_usd", agg="sum", description="USD revenue"
)
MEASURES = {"revenue_amount": REVENUE}


def test_simple_metric_no_filter():
    metric = Metric(
        name="gross_revenue",
        type="simple",
        measure="revenue_amount",
        description="d",
        drill_fields=["order_id", "customer_name"],
        meta={"ai_context": "Use only for completed orders."},
    )
    row = build_metric_row(metric, MEASURES)
    assert row["expression"] == "SUM(amount_usd)"
    assert row["metric_type"] == "simple"
    assert row["certified"] is True
    assert row["filter"] == []
    assert row["type_params"] == {
        "measure": "revenue_amount",
        "drill_fields": ["order_id", "customer_name"],
        "ai_context": "Use only for completed orders.",
    }


def test_simple_metric_with_table_qualifies_expression_and_metadata():
    metric = Metric(
        name="gross_revenue", type="simple", measure="revenue_amount", description="d"
    )
    row = build_metric_row(metric, MEASURES, table_name="orders")
    assert row["expression"] == "SUM(orders.amount_usd)"
    assert row["type_params"] == {"measure": "revenue_amount", "table": "orders"}


def test_simple_metric_with_filter_materializes_case():
    metric = Metric(
        name="total_revenue",
        type="simple",
        measure="revenue_amount",
        filters=["status != 'refunded'"],
        format="currency_usd",
        description="d",
    )
    row = build_metric_row(metric, MEASURES)
    assert row["expression"] == "SUM(CASE WHEN status != 'refunded' THEN amount_usd END)"
    assert row["filter"] == [{"field": "status", "op": "!=", "value": "refunded"}]
    assert row["format"] == "currency_usd"


def test_ratio_metric_type_params():
    metric = Metric(
        name="refund_rate",
        type="ratio",
        numerator=MetricRef(measure="revenue_amount", filters=["status = 'refunded'"]),
        denominator=MetricRef(measure="revenue_amount"),
        format="percent",
        description="d",
    )
    row = build_metric_row(metric, MEASURES)
    assert row["metric_type"] == "ratio"
    assert row["type_params"] == {
        "numerator": "SUM(CASE WHEN status = 'refunded' THEN amount_usd END)",
        "denominator": "SUM(amount_usd)",
    }


def test_metric_unknown_measure_raises():
    metric = Metric(name="x", type="simple", measure="revenue_amount", description="d")
    with pytest.raises(KeyError):
        build_metric_row(metric, {})


def test_dimension_row_clean_map_case():
    dim = Dimension(
        name="country",
        column="ship_country",
        type="categorical",
        description="d",
        clean={"map": {"KH": "Cambodia"}},
        sample_values=["Cambodia"],
    )
    row = build_dimension_row(dim)
    assert row["expression"] == (
        "CASE ship_country WHEN 'KH' THEN 'Cambodia' ELSE ship_country END"
    )
    assert row["values_sample"] == ["Cambodia"]


def test_dimension_row_plain_column():
    dim = Dimension(name="order_date", column="created_at", type="time", description="d")
    assert build_dimension_row(dim)["expression"] == "created_at"


def test_deterministic_ids_stable():
    a = deterministic_id("ds-123", "metric", "total_revenue")
    b = deterministic_id("ds-123", "metric", "total_revenue")
    assert a == b == str(uuid.uuid5(uuid.NAMESPACE_DNS, "ds-123:metric:total_revenue"))


class FakeSession:
    def __init__(self):
        self.calls = []

    async def execute(self, sql, params=None):
        self.calls.append((str(sql), params or {}))

        class _R:
            def fetchall(self):
                return []

        return _R()

    async def commit(self):
        self.calls.append(("COMMIT", {}))


@pytest.fixture
def manifest(tmp_path):
    m, issues = load_semantic_dir(_full_dir(tmp_path))
    assert issues == []
    return m


async def test_sync_upserts_all_object_kinds(manifest):
    db = FakeSession()
    counts = await sync_manifest(manifest, db)
    joined = "\n".join(sql for sql, _ in db.calls)
    assert counts["entities"] == 2
    assert counts["measures"] == 2
    assert counts["metrics"] == 2
    assert counts["dimensions"] == 2
    assert counts["joins"] == 1
    assert counts["time_spines"] == 1
    for table in (
        "semantic_entities",
        "semantic_measures",
        "semantic_metrics",
        "semantic_dimensions",
        "semantic_time_spines",
        "data_model_relationships",
    ):
        assert table in joined


async def test_sync_join_row_cardinality(manifest):
    db = FakeSession()
    await sync_manifest(manifest, db)
    join_calls = [p for sql, p in db.calls if "data_model_relationships" in sql and p]
    assert any(
        p.get("cardinality") == "many_to_one"
        and p.get("from_table") == "order_items"
        and p.get("to_table") == "orders"
        for p in join_calls
    )


async def test_sync_deactivates_stale_yaml_rows_only(manifest):
    db = FakeSession()
    await sync_manifest(manifest, db)
    deact = [
        (sql, p)
        for sql, p in db.calls
        if "is_active = false" in sql.replace("is_active=false", "is_active = false")
    ]
    assert deact, "expected stale-row deactivation statements"
    for sql, _ in deact:
        assert "source = 'yaml'" in sql or "source='yaml'" in sql
        # time spines have no source column — they must never be bulk-deactivated
        assert "semantic_time_spines" not in sql


async def test_sync_idempotent_ids(manifest):
    db1, db2 = FakeSession(), FakeSession()
    await sync_manifest(manifest, db1)
    await sync_manifest(manifest, db2)
    ids1 = [p.get("id") for _, p in db1.calls if p and p.get("id")]
    ids2 = [p.get("id") for _, p in db2.calls if p and p.get("id")]
    assert ids1 == ids2 and ids1


async def test_sync_metric_ids_include_table_name(manifest):
    db = FakeSession()
    await sync_manifest(manifest, db)
    metric_params = [
        p for sql, p in db.calls
        if "semantic_metrics" in sql and p.get("id") and p.get("name")
    ]
    expected = {
        deterministic_id("ds-123", "metric", "orders.total_revenue"),
        deterministic_id("ds-123", "metric", "order_items.total_items"),
    }
    assert {p["id"] for p in metric_params} == expected
