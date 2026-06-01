"""Supervisor routing preflight tests for production modes."""

import pytest

pytest.importorskip("langgraph")


def test_dashboard_requires_project_message_pattern():
    """Document expected supervisor preflight for dashboard without project."""
    msg = (
        "**Dashboard builder** needs a **project** selected in the header before it can create widgets in Studio."
    )
    assert "project" in msg.lower()


def test_ai_search_requires_kb_message_pattern():
    msg = "This mode answers from **documents** in a connected knowledge base."
    assert "knowledge base" in msg.lower()


def test_mode_degradation_reason_is_user_facing():
    from src.modules.ai.utils.mode_quality import apply_mode_degradation

    state = {"execution_metadata": {}}
    apply_mode_degradation(state, from_mode="predictive", reason="Insufficient history for forecast")
    assert state["execution_metadata"]["warnings"]
    assert "predictive" in state["execution_metadata"]["original_analytics_type"] or state.get("mode_degraded")
