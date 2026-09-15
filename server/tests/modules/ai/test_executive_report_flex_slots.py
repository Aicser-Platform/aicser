"""Report planner fills flex slots from schema instead of blocking on LLM."""

from ee.modules.ai.config.report_templates import get_tier_config
from ee.modules.ai.nodes.executive_report_planner_node import (
    _fill_flex_slots_deterministic,
    _heuristic_report_title,
)


def test_heuristic_title_uses_data_source_for_canned_composer_line():
    title = _heuristic_report_title(
        "Full performance narrative with KPIs and recommendations...",
        "Banking Sample",
    )
    assert title == "Banking Sample Performance Report"


def test_heuristic_title_never_echoes_user_prompt():
    title = _heuristic_report_title(
        "Show me top SKUs revenue last quarter with margins",
        "Retail Sample",
    )
    assert title == "Retail Sample Revenue Overview"
    assert "Show me" not in title
    assert "SKU" not in title


def test_flex_slots_bind_unused_dimension_from_schema():
    sections = [
        {
            "id": "kpi_overview",
            "type": "kpi",
            "title": "Key Metrics",
            "sql": "SELECT 1",
        },
        {
            "id": "trend_analysis",
            "type": "timeseries",
            "title": "Trend",
            "sql": "SELECT 1",
        },
    ]
    classified = {
        "numeric": ["amount", "balance"],
        "temporal": ["disbursed_at"],
        "categorical": ["product", "region", "status"],
    }
    out = _fill_flex_slots_deterministic(
        sections,
        get_tier_config("standard"),
        classified,
        table="banking.loans",
        dialect="postgresql",
        report_run_id="run-1",
    )
    flex = [s for s in out if str(s.get("id") or "").startswith("flex_")]
    assert flex, out
    for s in flex:
        assert s.get("sql")
        assert "banking.loans" in s["sql"] or "loans" in s["sql"].lower()
