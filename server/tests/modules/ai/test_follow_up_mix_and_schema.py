"""Tests for per-mode follow-up mix and schema full-catalog threshold."""

from ee.modules.ai.utils.follow_up_mix import (
    discovery_mode_hint,
    follow_up_prompt_line,
    interleave_mix,
    slot_counts,
)
from ee.modules.ai.utils.schema_for_llm import get_relevant_schema_subset


def test_descriptive_slots_are_majority():
    desc, deepen = slot_counts("descriptive")
    assert desc >= 3 and deepen >= 1
    assert desc / (desc + deepen) >= 0.6


def test_interleave_descriptive_prefers_descriptive():
    out = interleave_mix(
        ["Trend of revenue", "Revenue by region", "Top 10 products", "Monthly compare"],
        ["Why did revenue change?", "Forecast revenue"],
        analytics_type="descriptive",
        total=5,
    )
    assert len(out) == 5
    # First 4 should be descriptive when enough are provided
    assert out[0] == "Trend of revenue"
    assert "Why did revenue change?" in out or "Forecast revenue" in out


def test_diagnostic_deepens_majority():
    out = interleave_mix(
        ["Revenue by region"],
        ["Top driver of drop", "Segment contribution", "Root cause of churn", "Driver waterfall"],
        analytics_type="diagnostic",
        total=5,
    )
    assert out[0] == "Top driver of drop"
    assert "Revenue by region" in out


def test_discovery_hint_mentions_descriptive_quota():
    hint = discovery_mode_hint("standard")
    assert "descriptive" in hint.lower()
    assert follow_up_prompt_line("descriptive")


def test_schema_under_15_returns_full_catalog():
    schema = {
        "tables": [
            {"name": f"t{i}", "columns": [{"name": "id", "type": "int"}, {"name": "v", "type": "float"}]}
            for i in range(12)
        ]
    }
    subset = get_relevant_schema_subset(schema, "show revenue", min_tables_to_filter=15, max_tables=8)
    assert subset is schema or len(subset.get("tables") or []) == 12


def test_schema_at_15_plus_can_subset():
    schema = {
        "tables": [
            {"name": f"orders_{i}" if i < 3 else f"dim_{i}", "columns": [{"name": "amount", "type": "float"}, {"name": "id", "type": "int"}]}
            for i in range(20)
        ]
    }
    subset = get_relevant_schema_subset(
        schema,
        "total amount from orders",
        min_tables_to_filter=15,
        max_tables=8,
    )
    assert subset is not None
    tables = subset.get("tables") or []
    assert 1 <= len(tables) <= 8
