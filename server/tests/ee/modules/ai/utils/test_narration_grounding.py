"""Tests for rules-based narration grounding (T1/T2/T0 + soft correct)."""

from ee.modules.ai.utils.narration_grounding import (
    aggregate_verification_tier,
    check_text_grounded,
    expand_derived_numbers,
    extract_numbers_from_data,
    extract_numbers_from_text,
    ground_insight_fields,
    ground_text_blob,
    soft_correct_text,
    verification_tier,
)
from ee.modules.ai.nodes.mode_query_planner_node import _apply_query_budgets


def test_check_grounded_exact_and_near():
    valid = extract_numbers_from_data([{"revenue": 1000.0, "prior": 920.0}], [])
    ok, ungrounded, _, total = check_text_grounded("Revenue is 1000", valid)
    assert ok and total >= 1 and not ungrounded


def test_compact_km_forms_match_facts():
    valid = extract_numbers_from_data([{"revenue": 5000.0}], ["Total revenue is 5.00K"])
    # Prose after ground_prose_pack often cites 5.00K
    tokens = extract_numbers_from_text("Revenue landed at 5.00K this period.")
    assert any(abs(float(t.replace(",", "")) - 5000) < 1 for t in tokens if t.replace(",", "").replace(".", "", 1).isdigit() or "e" in t.lower())
    ok, _, _, _ = check_text_grounded("Revenue landed at 5.00K this period.", valid)
    assert ok


def test_soft_correct_rounding_within_band():
    valid = {"9.0", "9", "9.00", "100"}
    text, corrections, remaining = soft_correct_text(
        "Growth was about 9.3 this quarter",
        valid,
        rel_tol=0.05,
    )
    assert corrections
    assert "9" in text or "9.0" in text


def test_soft_correct_does_not_invent_far_mismatch():
    valid = {"9.0", "9"}
    text, corrections, remaining = soft_correct_text("Revenue grew 12%", valid, rel_tol=0.05)
    assert "12" in text
    assert remaining


def test_insight_audit_default_does_not_rewrite():
    """Finalizer audits only — generation already ran ground_prose_pack."""
    valid = {"100", "100.0"}
    out = ground_insight_fields(
        {"title": "Spike", "what": "Metric jumped to 250 overnight", "confidence": 0.9},
        valid,
    )
    assert out["what"] == "Metric jumped to 250 overnight"  # unchanged
    assert out["verification_tier"] == "T0"
    assert out["data_grounded"] is False


def test_verification_tiers():
    assert verification_tier(has_numeric_claims=False, is_grounded=True) == "T2"
    assert verification_tier(has_numeric_claims=True, is_grounded=True, corrections_applied=0) == "T1"
    assert verification_tier(has_numeric_claims=True, is_grounded=True, corrections_applied=1) == "T2"
    assert verification_tier(has_numeric_claims=True, is_grounded=False) == "T0"
    assert aggregate_verification_tier(["T1", "T2", "T0"]) == "T0"


def test_ground_text_blob_t1_when_match():
    valid = {"42", "42.0"}
    blob = ground_text_blob("We saw 42 units sold.", valid)
    assert blob["data_grounded"] is True
    assert blob["verification_tier"] == "T1"


def test_expand_derived_is_linear_not_quadratic():
    nums = {str(float(i)) for i in range(50)}
    derived = expand_derived_numbers(nums, max_values=24)
    # Should be small; old O(n²) path produced thousands of strings
    assert len(derived) < 200


def test_apply_query_budgets_trims_optional_first():
    plan = {
        "queries": [
            {"id": "r1", "required": True},
            {"id": "r2", "required": True},
            {"id": "o1", "required": False},
            {"id": "o2", "required": False},
            {"id": "o3", "required": False},
        ],
        "budgets": {"max_queries": 3},
        "notes": [],
    }
    out = _apply_query_budgets(plan, {"execution_metadata": {}})
    assert len(out["queries"]) == 3
    ids = [q["id"] for q in out["queries"]]
    assert "r1" in ids and "r2" in ids
    assert sum(1 for i in ids if i.startswith("o")) == 1
