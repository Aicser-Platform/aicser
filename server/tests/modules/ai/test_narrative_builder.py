"""Tests for narrative_builder."""

from src.modules.ai.utils.narrative_builder import build_user_narrative, sync_narrative_fields


def test_build_user_narrative_prefers_executive_summary():
    text = build_user_narrative({"executive_summary": "Revenue grew 12% year over year in Q4."})
    assert "Revenue" in text


def test_sync_narrative_fields():
    state = {}
    sync_narrative_fields(state, "Hello user")
    assert state["message"] == "Hello user"
    assert state["narration"] == "Hello user"
    assert state["analysis"] == "Hello user"
