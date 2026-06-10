"""Tests for stream_event_builder partial_results contract."""

from src.modules.ai.services.stream_event_builder import (
    build_partial_results,
    enrich_partial_results_quality,
    is_final_state_update,
    resolve_sql_for_stream,
)


def test_build_partial_results_includes_quality_fields():
    state = {
        "message": "Done",
        "narration": "Done",
        "current_stage": "complete",
        "execution_metadata": {"mode_degraded": True, "warnings": ["test warn"]},
        "mode_degraded": True,
        "artifact_quality": {"score": 0.8},
    }
    pr = build_partial_results(state)
    assert pr.get("mode_degraded") is True
    assert pr.get("warnings") == ["test warn"]
    assert pr.get("artifact_quality") == {"score": 0.8}
    assert pr.get("content_state") == "final"


def test_is_final_state_update():
    assert is_final_state_update({"current_stage": "rag_complete"})
    assert not is_final_state_update({"current_stage": "nl2sql"})


def test_enrich_partial_results_skill_results():
    pr = {}
    state = {"skill_results": [{"skill": "run_sql", "success": True}]}
    out = enrich_partial_results_quality(pr, state, {})
    assert out["skill_results"][0]["skill"] == "run_sql"


def test_resolve_sql_hides_non_milestone():
    state = {"sql_query": "SELECT 1", "current_stage": "nl2sql"}
    assert resolve_sql_for_stream(state, {}) is None
