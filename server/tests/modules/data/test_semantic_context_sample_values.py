"""prompt_hint surfaces dimension sample values so the LLM filters on real values."""

import json

from src.modules.data.services.semantic_context_service import get_unified_semantic_context


class FakeResult:
    def __init__(self, rows=(), keys=()):
        self._rows = list(rows)
        self._keys = tuple(keys)

    def fetchall(self):
        return self._rows

    def keys(self):
        return self._keys

    def scalars(self):
        class _S:
            def all(self):
                return []

        return _S()


class FakeSession:
    """Serves the metric/dimension/time-spine queries; joins query raises → []."""

    def __init__(self):
        self.metric_keys = (
            "id", "name", "expression", "description", "category",
            "certified", "metric_type", "source", "source_ref", "type_params",
        )
        self.dim_keys = ("id", "name", "expression", "description", "certified", "values_sample")

    async def execute(self, sql, params=None):
        text = str(sql)
        if "semantic_metrics" in text:
            return FakeResult(
                [("m1", "total_revenue", "SUM(amount_usd)", "Revenue", "general",
                  True, "simple", "yaml", "orders.yml", json.dumps({
                      "ai_context": "Use for booked revenue.",
                      "drill_fields": ["order_id", "country"],
                  }))],
                self.metric_keys,
            )
        if "semantic_dimensions" in text:
            return FakeResult(
                [("d1", "country", "ship_country", "Ship country", True,
                  json.dumps(["Cambodia", "Thailand", "Laos"]))],
                self.dim_keys,
            )
        if "semantic_time_spines" in text:
            return FakeResult([], ("id", "name", "base_column", "grain", "sql_template", "is_active"))
        return FakeResult()

    async def get(self, model, pk):
        return None


async def test_prompt_hint_includes_sample_values():
    ctx = await get_unified_semantic_context(FakeSession(), data_source_id="ds-1")
    hint = ctx["prompt_hint"]
    assert "country" in hint
    assert "e.g. Cambodia, Thailand" in hint
    # certified metric expression still present
    assert "total_revenue: SUM(amount_usd)" in hint
    assert "Use for booked revenue" in hint
    assert "order_id, country" in hint
