"""Tests for deliverable contract validation."""

from src.modules.ai.services.deliverable_validator import (
    apply_deliverable_metadata,
    infer_deliverable_kind,
    validate_deliverable,
)
from src.modules.ai.schemas.workflow_result import DeliverableKind


def test_infer_dashboard():
    assert infer_deliverable_kind({"current_stage": "dashboard_generation_complete", "dashboard_created": {"dashboard_id": "1"}}) == DeliverableKind.dashboard


def test_infer_kb_answer():
    assert infer_deliverable_kind({"current_stage": "rag_complete", "message": "Answer from docs"}) == DeliverableKind.kb_answer


def test_validate_chart_analysis_passes_with_chart():
    ok, issues = validate_deliverable(
        {"echarts_config": {"series": []}, "message": "Here is your chart analysis result."},
        DeliverableKind.chart_analysis,
    )
    assert ok
    assert not issues


def test_validate_chart_analysis_fails_empty():
    ok, issues = validate_deliverable({"message": "hi"}, DeliverableKind.chart_analysis)
    assert not ok
    assert issues


def test_apply_deliverable_metadata_attaches_kind():
    state = apply_deliverable_metadata(
        {"current_stage": "skill_complete", "skill_results": [{"success": True}], "message": "Skills done successfully."}
    )
    assert state["execution_metadata"]["deliverable_kind"] == "agent_skills"


def test_validate_dashboard_requires_min_widgets():
    ok, issues = validate_deliverable(
        {
            "dashboard_created": {"dashboard_id": "d1", "widget_count": 1, "status": "partial"},
            "message": "Dashboard created with limited widgets.",
        },
        DeliverableKind.dashboard,
    )
    assert not ok
    assert any("widget" in i for i in issues)
