"""Tests for DecisionOS module."""
import pytest

from ee.modules.decision_os.attachment_router import classify_attachment
from ee.modules.decision_os.confidence_policy import ConfidencePolicy, confidence_policy_from_pack
from ee.modules.decision_os.completion_service import DecisionCompletionService
from ee.modules.decision_os.decision_synthesizer import (
    apply_brief_to_state,
    confidence_to_score,
    fallback_brief,
)
from src.modules.ai.schemas.workflow_result import DeliverableKind
from src.modules.ai.services.deliverable_validator import infer_deliverable_kind, validate_deliverable


def test_classify_attachment():
    assert classify_attachment("data.csv") == "data_source"
    assert classify_attachment("policy.pdf") == "knowledge_doc"
    assert classify_attachment("photo.png") == "image"


def test_confidence_policy_cambodia_pack():
    policy = confidence_policy_from_pack("cambodia_default")
    assert policy.cold_start_phase == 1
    assert policy.effective_auto_threshold() >= 0.95


def test_confidence_policy_evaluate_hitl():
    policy = ConfidencePolicy(cold_start_phase=1, min_confidence_auto=0.95)
    result = policy.evaluate(confidence_score=0.7, evidence_count=0)
    assert result["hitl_required"] is True


def test_fallback_brief():
    brief = fallback_brief("Why did revenue drop?", {})
    assert brief["executive_decision"]
    assert brief["confidence_score"] == 0.55


def test_apply_brief_to_state():
    state = {}
    brief = fallback_brief("test", {})
    brief["options"] = [{"label": "Base", "recommended": True, "description": "Do X"}]
    apply_brief_to_state(state, brief)
    assert state["decision_brief"] == brief
    assert state["confidence_score"] == 0.55
    assert state["insights"]


def test_deliverable_kind_decision_case():
    state = {
        "decision_brief": {"executive_decision": "Act now"},
        "confidence_score": 0.8,
        "executive_summary": "x" * 60,
        "execution_metadata": {"analysis_mode": "decision_intelligence"},
    }
    kind = infer_deliverable_kind(state)
    assert kind == DeliverableKind.decision_case
    passed, issues = validate_deliverable(state, kind)
    assert passed is True
    assert not issues


def test_completion_service_incomplete():
    svc = DecisionCompletionService()
    state = {"decision_brief": None, "execution_metadata": {}}
    result = svc.check_complete(state)
    assert result["complete"] is False
