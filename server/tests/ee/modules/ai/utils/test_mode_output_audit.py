"""Tests for shared mode_output_audit across Report / Business OS / analytics."""

from ee.modules.ai.utils.mode_output_audit import apply_light_output_audit


def test_light_audit_skips_without_digits():
    state = {
        "executive_summary": "Strategy looks solid for the next quarter.",
        "insights": [],
        "execution_metadata": {},
    }
    report = apply_light_output_audit(state, mode_label="business_journey:strategy")
    assert report["skipped"] is True
    assert state["execution_metadata"]["verification_tier"] == "T2"


def test_light_audit_t0_sets_limited_quality():
    state = {
        "executive_summary": "Revenue grew 99 percent overnight to 999999.",
        "query_result": [{"revenue": 100.0}],
        "insights": [],
        "recommendations": [],
        "execution_metadata": {"data_facts": ["revenue total is 100"]},
    }
    report = apply_light_output_audit(state, mode_label="analyse")
    assert report.get("skipped") is False
    assert state["execution_metadata"]["verification_tier"] == "T0"
    assert state["execution_metadata"]["quality_level"] == "limited"


def test_light_audit_t1_when_numbers_match():
    state = {
        "executive_summary": "Revenue is 1000 this period.",
        "query_result": [{"revenue": 1000.0}],
        "insights": [{"title": "Total", "what": "Revenue is 1000", "confidence": 0.9}],
        "execution_metadata": {"data_facts": ["revenue 1000"]},
    }
    report = apply_light_output_audit(state, mode_label="descriptive")
    assert report.get("skipped") is False
    assert state["execution_metadata"]["verification_tier"] == "T1"
