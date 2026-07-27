"""Catalog: compact LLM-facing view of the semantic layer + sample refresh."""

import json

from ee.modules.semantic.catalog import (
    get_catalog,
    refresh_sample_values,
    render_for_prompt,
)


CATALOG = {
    "metrics": [
        {
            "name": "total_revenue",
            "label": "Total revenue",
            "description": "Booked revenue in USD, excluding refunds",
            "format": "currency_usd",
            "type": "simple",
            "certified": True,
        },
        {
            "name": "refund_rate",
            "label": "Refund rate",
            "description": "Share of revenue refunded",
            "format": "percent",
            "type": "ratio",
            "certified": True,
        },
    ],
    "dimensions": [
        {
            "name": "country",
            "description": "Shipping destination country",
            "sample_values": ["Cambodia", "Thailand"],
            "granularities": [],
        },
        {
            "name": "order_date",
            "description": "Date the order was placed",
            "sample_values": [],
            "granularities": ["day", "month", "year"],
        },
    ],
    "joins": [
        {"from_table": "order_items", "from_column": "order_id",
         "to_table": "orders", "to_column": "order_id", "cardinality": "many_to_one"},
    ],
}


def test_render_includes_metrics_with_format_and_description():
    text = render_for_prompt(CATALOG)
    assert "total_revenue" in text
    assert "currency_usd" in text
    assert "excluding refunds" in text


def test_render_includes_sample_values_and_granularities():
    text = render_for_prompt(CATALOG)
    assert "e.g. Cambodia, Thailand" in text
    assert "day|month|year" in text


def test_render_includes_joins_and_instruction():
    text = render_for_prompt(CATALOG)
    assert "order_items" in text
    assert "semantic_query_spec" in text


def test_render_is_token_bounded():
    big = {
        "metrics": [
            {"name": f"metric_{i}", "label": f"m{i}", "description": "x" * 80,
             "format": "number", "type": "simple", "certified": True}
            for i in range(40)
        ],
        "dimensions": [
            {"name": f"dim_{i}", "description": "y" * 80,
             "sample_values": ["a", "b"], "granularities": []}
            for i in range(40)
        ],
        "joins": [],
    }
    text = render_for_prompt(big, max_metrics=20, max_dimensions=20)
    assert "metric_19" in text and "metric_25" not in text
    assert len(text) < 6000


class FakeResult:
    def __init__(self, rows, keys=()):
        self._rows = rows
        self._keys = keys

    def fetchall(self):
        return self._rows

    def keys(self):
        return self._keys

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeSession:
    """Returns queued results in order; records calls."""

    def __init__(self, results):
        self._results = list(results)
        self.calls = []

    async def execute(self, sql, params=None):
        self.calls.append((str(sql), params or {}))
        return self._results.pop(0) if self._results else FakeResult([])

    async def commit(self):
        self.calls.append(("COMMIT", {}))


async def test_get_catalog_reads_metrics_dimensions_joins():
    metric_keys = ("name", "label", "description", "format", "metric_type", "certified")
    dim_keys = ("name", "description", "values_sample")
    spine_keys = ("name", "base_column", "grain")
    join_keys = ("from_table", "from_column", "to_table", "to_column", "cardinality")
    db = FakeSession([
        FakeResult(
            [("total_revenue", "Total revenue", "desc", "currency_usd", "simple", True)],
            metric_keys,
        ),
        FakeResult([("country", "desc", json.dumps(["Cambodia"]))], dim_keys),
        FakeResult([("order_date", "created_at", "day")], spine_keys),
        FakeResult(
            [("order_items", "order_id", "orders", "order_id", "many_to_one")],
            join_keys,
        ),
    ])
    catalog = await get_catalog(db, "ds-1")
    assert catalog["metrics"][0]["name"] == "total_revenue"
    assert catalog["dimensions"][0]["sample_values"] == ["Cambodia"]
    assert catalog["joins"][0]["cardinality"] == "many_to_one"


async def test_refresh_sample_values_bounded():
    executed = []

    async def execute_sql(sql):
        executed.append(sql)
        if "COUNT(DISTINCT" in sql:
            # branch has 12 distinct values, notes has 4000
            return [{"n": 4000 if "notes" in sql else 12}]
        return [{"v": "Phnom Penh"}, {"v": "Siem Reap"}]

    db = FakeSession([
        FakeResult(
            [("dim-1", "branch", "branch"), ("dim-2", "notes", "notes")],
            ("id", "name", "expression"),
        ),
    ])
    result = await refresh_sample_values(db, "ds-1", execute_sql)

    assert result["refreshed"] == 1 and result["skipped"] == 1
    distinct_probes = [s for s in executed if "COUNT(DISTINCT" in s]
    selects = [s for s in executed if "SELECT DISTINCT" in s]
    assert len(distinct_probes) == 2
    assert len(selects) == 1 and "LIMIT 25" in selects[0]
    updates = [(s, p) for s, p in db.calls if "UPDATE semantic_dimensions" in s]
    assert len(updates) == 1
    assert json.loads(updates[0][1]["vals"]) == ["Phnom Penh", "Siem Reap"]
