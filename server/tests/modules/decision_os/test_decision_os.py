"""Tests for DecisionOS module."""
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.decision_os.attachment_router import classify_attachment
from ee.modules.decision_os.confidence_policy import (
    ConfidencePolicy,
    confidence_policy_from_pack,
    infer_stakes_level,
)
from ee.modules.decision_os.completion_service import DecisionCompletionService
from ee.modules.decision_os.decision_synthesizer import (
    apply_brief_to_state,
    confidence_to_score,
    fallback_brief,
)
from ee.modules.decision_os.stakes_classifier import classify_stakes_level
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


@pytest.mark.asyncio
async def test_classify_stakes_level_uses_llm_result():
    mock_llm = AsyncMock()
    mock_llm.generate_completion.return_value = {
        "success": True,
        "content": '{"stakes_level": "critical"}',
    }
    level = await classify_stakes_level("Should we exit the Cambodia market?", litellm_service=mock_llm)
    assert level == "critical"
    mock_llm.generate_completion.assert_awaited_once()


@pytest.mark.asyncio
async def test_classify_stakes_level_falls_back_on_llm_failure():
    mock_llm = AsyncMock()
    mock_llm.generate_completion.side_effect = RuntimeError("timeout")
    level = await classify_stakes_level("This is a routine, minor, quick fix", litellm_service=mock_llm)
    assert level == infer_stakes_level("This is a routine, minor, quick fix")


@pytest.mark.asyncio
async def test_classify_stakes_level_falls_back_on_invalid_json():
    mock_llm = AsyncMock()
    mock_llm.generate_completion.return_value = {"success": True, "content": "not json"}
    level = await classify_stakes_level("some critical board decision", litellm_service=mock_llm)
    assert level == infer_stakes_level("some critical board decision")


@pytest.mark.asyncio
async def test_classify_stakes_level_empty_query_skips_llm():
    mock_llm = AsyncMock()
    level = await classify_stakes_level("", litellm_service=mock_llm)
    assert level == "medium"
    mock_llm.generate_completion.assert_not_awaited()


@pytest.mark.asyncio
async def test_case_intake_node_gathers_evidence_from_attached_kb():
    from ee.modules.decision_os.nodes.case_intake_node import case_intake_node
    from src.modules.knowledge.services.rag_retrieval_service import RetrievedChunk

    chunk = RetrievedChunk(
        chunk_id="c1",
        document_id="d1",
        content="Refund policy: customers may request a refund within 30 days.",
        score=0.91,
        token_count=12,
        document_filename="refund_policy.pdf",
    )
    state = {
        "query": "Should we extend the refund window?",
        "kb_data_source_ids": ["kb-1"],
    }
    with patch(
        "src.modules.knowledge.services.rag_retrieval_service.RAGRetrievalService.retrieve_multi",
        new=AsyncMock(return_value=[chunk]),
    ), patch("src.db.session.async_session"):
        result = await case_intake_node(state)

    evidence = result["case_file"]["evidence_items"]
    assert len(evidence) == 1
    assert evidence[0]["kind"] == "document"
    assert evidence[0]["citations"][0]["source"] == "refund_policy.pdf"


@pytest.mark.asyncio
async def test_case_intake_node_no_kb_attached_yields_no_evidence():
    from ee.modules.decision_os.nodes.case_intake_node import case_intake_node

    state = {"query": "Should we extend the refund window?"}
    result = await case_intake_node(state)
    assert result["case_file"]["evidence_items"] == []


@pytest.mark.asyncio
async def test_decision_workflow_node_surfaces_hitl_note_in_message():
    from ee.modules.decision_os.nodes.case_intake_node import decision_workflow_node

    state = {
        "query": "Should we shut down the Cambodia office?",
        "case_file": {"domain_pack_id": "generic", "evidence_items": []},
        "confidence_score": 0.4,
        "message": "Executive decision: proceed with caution.",
    }
    with patch(
        "ee.modules.decision_os.nodes.case_intake_node.classify_stakes_level",
        new=AsyncMock(return_value="critical"),
    ):
        result = await decision_workflow_node(state)

    assert result["hitl_required"] is True
    assert "Human review recommended" in result["message"]
    assert result["execution_metadata"]["decision_workflow"]["stakes_level"] == "critical"


@pytest.mark.asyncio
async def test_decision_workflow_node_no_hitl_note_when_confident():
    from ee.modules.decision_os.nodes.case_intake_node import decision_workflow_node

    state = {
        "query": "Minor routine tweak to a report layout",
        "case_file": {"domain_pack_id": "generic", "evidence_items": []},
        "confidence_score": 0.99,
        "message": "Executive decision: proceed.",
    }
    with patch(
        "ee.modules.decision_os.nodes.case_intake_node.classify_stakes_level",
        new=AsyncMock(return_value="low"),
    ):
        result = await decision_workflow_node(state)

    assert result["hitl_required"] is False
    assert "Human review recommended" not in result["message"]
