"""Tests for adaptive continuation action mapping."""

from ee.modules.ai.services.adaptive_continuation_service import (
    _prompt_to_continuation_action,
    apply_continuation,
)


def test_prompt_to_decision_intelligence_mode() -> None:
    action = _prompt_to_continuation_action(
        "Run a complete Decision Intelligence analysis",
        default_mode="auto",
    )
    assert action["analysis_mode"] == "decision_intelligence"
    assert action["type"] == "analytics"


def test_prompt_to_dashboard_mode() -> None:
    action = _prompt_to_continuation_action(
        "Build a dashboard from this analysis",
        default_mode="auto",
    )
    assert action["analysis_mode"] == "dashboard"
    assert action["type"] == "analytics"


def test_apply_continuation_sets_metadata() -> None:
    state = {
        "analytics_type": "diagnostic",
        "query_result": [{"x": 1}],
        "insights": [{"title": "Drop in sales"}],
        "follow_up_questions": [],
    }
    apply_continuation(state)
    assert state.get("continuation_actions")
    assert len(state["continuation_actions"]) >= 1
    meta = state.get("execution_metadata") or {}
    assert meta.get("continuation_actions")
