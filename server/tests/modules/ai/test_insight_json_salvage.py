"""Salvage truncated insight JSON; keep fallback summaries number-first."""

from ee.modules.ai.utils.llm_parsing import salvage_partial_insight_payload
from ee.modules.ai.nodes.insight_synthesizer_node import _build_fallback_summary


def test_salvage_truncated_executive_summary():
    raw = (
        '{"executive_summary": "Revenue ranged from 80,000 to 140,000 across 12 months, '
        'ending up 5% versus the prior month.", "insights": [{"title": "Upward trend"'
        # truncated mid-array on purpose
    )
    salvaged = salvage_partial_insight_payload(raw)
    assert salvaged is not None
    assert "80,000" in salvaged["executive_summary"]
    assert "140,000" in salvaged["executive_summary"]


def test_fallback_summary_leads_with_numbers_not_stands_out():
    summary = _build_fallback_summary(
        "What's my monthly revenue trend over the last 12 months",
        12,
        [
            "Total Rows: 12",
            "revenue_usd: Total=1,200,000, Avg=100,000, Min=80,000, Max=140,000",
            "Time Range: 2024-01-01 to 2024-12-01",
        ],
        "",
        analytics_metadata={
            "trend": {"direction": "up", "slope_per_period": 2.1},
            "period_over_period": {
                "direction": "up",
                "pct_change": 5.2,
                "last_value": 140000,
                "previous_value": 133000,
            },
        },
    )
    assert "stands out" not in summary.lower()
    assert "5.2%" in summary or "+5.2%" in summary
    assert "80,000" in summary or "140,000" in summary or "up" in summary.lower()


def test_fallback_prefers_primary_metric_over_budget_pct():
    summary = _build_fallback_summary(
        "monthly revenue trend",
        12,
        [
            "revenue_vs_budget_pct: Total=12, Avg=1, Min=-5, Max=8",
            "revenue_usd: Total=1,200,000, Avg=100,000, Min=80,000, Max=140,000",
        ],
    )
    assert "stands out" not in summary.lower()
    assert "Revenue Usd" in summary or "revenue" in summary.lower()
    assert "80,000" in summary and "140,000" in summary
