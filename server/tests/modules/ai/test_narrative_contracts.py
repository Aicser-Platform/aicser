"""Tests for narrative_contracts — shared fallbacks, humanize, slots, DI bind."""

from ee.modules.ai.utils.narrative_contracts import (
    build_mode_aware_fallback_insights,
    build_mode_aware_fallback_recommendations,
    evaluate_narrative_slots,
    format_verified_stats_for_prompt,
    is_decision_intelligence_bound,
    insights_from_report_sections,
)


def test_no_results_ready_filler():
    cards = build_mode_aware_fallback_insights(
        ["avg_x: Total=10, Avg=10, Min=10, Max=10"],
        query="show averages",
        n_rows=5,
    )
    assert cards == []
    assert all("results ready" not in str(c).lower() for c in cards)


def test_breakdown_card_is_mode_aware():
    facts = [
        "collateral_amount by branch_name: Branch 5=706,463.88 (23.7%), Branch 2=609,031.13 (20.4%)",
    ]
    cards = build_mode_aware_fallback_insights(
        facts, query="collateral by branch", n_rows=21, analytics_type="diagnostic"
    )
    assert len(cards) == 1
    assert "Investigate" in cards[0]["now_what"] or "driver" in cards[0]["now_what"].lower()


def test_prescriptive_fallback_recs_no_mode_cross_sell():
    recs = build_mode_aware_fallback_recommendations(
        "how do we improve", n_rows=10, analytics_type="prescriptive"
    )
    blob = " ".join(str(r) for r in recs).lower()
    assert "switch to" not in blob
    assert "prescriptive mode" not in blob
    assert "predictive mode" not in blob


def test_verified_stats_humanize_drops_zscore_token():
    block = format_verified_stats_for_prompt(
        "diagnostic",
        {"anomaly_confirmed": True, "anomaly_zscore": 3.2, "anomaly_scope": "time"},
    )
    assert "z-score" not in block.lower()
    assert "zscore" not in block.lower()
    assert "unusual" in block.lower() or "typical" in block.lower()


def test_decision_intelligence_bound_detects_composite():
    assert is_decision_intelligence_bound({"analytics_type": "decision_intelligence"})
    assert is_decision_intelligence_bound(
        {
            "analytics_type": "diagnostic_prescriptive_predictive",
            "execution_metadata": {"analysis_mode": "decision_intelligence"},
        }
    )
    assert not is_decision_intelligence_bound({"analytics_type": "descriptive"})


def test_five_slot_rubric_scores_thin_summary():
    ev = evaluate_narrative_slots(
        summary="Revenue looks fine.",
        insights=[],
        recommendations=[],
        analytics_type="descriptive",
        n_rows=12,
    )
    assert ev["filled"] < 5
    assert ev["slots"]["answer"] is True


def test_report_insights_from_sections():
    cards = insights_from_report_sections(
        [
            {
                "title": "Revenue",
                "narrative": "Revenue rose 12% this quarter. Enterprise drove most of the lift.",
            }
        ]
    )
    assert len(cards) == 1
    assert cards[0]["title"] == "Revenue"
    assert "12%" in cards[0]["what"]
