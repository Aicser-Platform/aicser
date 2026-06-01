"""Tests for mode quality and degradation surfacing."""

from src.modules.ai.utils.mode_quality import apply_mode_degradation, merge_quality_metadata


def test_apply_mode_degradation_sets_metadata():
    state = {"analytics_type": "diagnostic", "execution_metadata": {}}
    apply_mode_degradation(
        state,
        from_mode="diagnostic",
        to_mode="descriptive",
        reason="Missing dimension column",
    )
    assert state["mode_degraded"] is True
    assert state["mode_degraded_to"] == "descriptive"
    assert "Missing dimension" in state["degradation_reason"]
    assert state["execution_metadata"]["warnings"]


def test_merge_quality_metadata_includes_report_and_rag():
    result = {"execution_metadata": {}}
    final = {
        "report_plan": {"title": "Q1"},
        "report_sections": [{"id": "s1"}],
        "rag_citations": [{"source": "doc.pdf"}],
        "artifact_quality": {"score": 0.8},
        "mode_degraded": True,
        "mode_degraded_to": "descriptive",
        "degradation_reason": "timeout",
    }
    out = merge_quality_metadata(result, final)
    assert out["report_plan"]["title"] == "Q1"
    assert out["rag_citations"]
    assert out["artifact_quality"]["score"] == 0.8
    assert out["execution_metadata"]["mode_degraded"] is True
