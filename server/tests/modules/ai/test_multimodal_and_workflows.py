"""Tests for multimodal ingestion, org workflows, and journey continuation."""

from __future__ import annotations

import pytest

from ee.modules.ai.kernel.goal_resolver import resolve_goal_heuristic, should_use_agent_kernel
from ee.modules.ai.kernel.planner import build_plan
from ee.modules.ai.kernel.schemas import AgentGoal, DeliverableType
from ee.modules.ai.services.adaptive_continuation_service import compute_continuation
from ee.modules.ai.services.multimodal_ingestion import (
    MultimodalContext,
    augment_query_with_multimodal,
    ingest_attachments,
)
from ee.modules.ai.services.org_workflow_service import _WORKFLOW_CACHE, match_org_workflow


class _FakeVisionService:
    def __init__(self):
        self.calls: list = []

    async def generate_completion(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "success": True,
            "content": "- Four KPI cards across the top\n- Filter controls in the header\n- Green finance palette",
        }


def test_augment_query_with_multimodal_pdf_excerpt():
    ctx = MultimodalContext(
        text_excerpt="Revenue grew 12% QoQ.",
        modalities=["text", "pdf"],
        stt_transcript="",
    )
    out = augment_query_with_multimodal("Summarize the attachment", ctx)
    assert "Attached context" in out
    assert "Revenue grew" in out


def test_should_use_agent_kernel_with_image_and_dashboard_intent():
    state = {
        "query": "Build a dashboard from this chart screenshot",
        "data_source_id": "ds-1",
        "agent_context": {"analysis_mode": "standard"},
        "multimodal_context": {
            "modalities": ["text", "image"],
            "vision_model_hint": True,
        },
    }
    assert should_use_agent_kernel(state) is True


def test_resolve_goal_heuristic_multimodal_constraints():
    state = {
        "query": "Analyze the uploaded policy",
        "agent_context": {"analysis_mode": "standard"},
        "multimodal_context": {"modalities": ["text", "pdf"], "text_excerpt": "Policy text"},
    }
    goal = resolve_goal_heuristic(state)
    assert any("PDF" in c for c in goal.constraints)


@pytest.mark.asyncio
async def test_image_attachment_is_summarized_for_text_planners():
    vision_service = _FakeVisionService()
    ctx = await ingest_attachments(
        [
            {
                "type": "image",
                "mime_type": "image/png",
                "base64": "iVBORw0KGgo=",
                "name": "reference-dashboard.png",
            }
        ],
        litellm_service=vision_service,
    )

    assert "image" in ctx.modalities
    assert ctx.vision_model_hint is True
    assert "Reference image dashboard layout" in ctx.text_excerpt
    assert "Four KPI cards" in ctx.text_excerpt
    assert "Image layout summarized" in ctx.attachment_summaries
    # Regression: this call sends real image content and must resolve to a
    # vision-capable model tier -- NOT node_name="dashboard_layout", whose
    # "fast" tier on this platform's current provider config is a
    # confirmed-text-only model (deepseek-v4-flash; vision requires the
    # separate deepseek-v4-flash-vision-exp endpoint, not what's configured).
    assert len(vision_service.calls) == 1
    assert vision_service.calls[0].get("node_name") == "dashboard_reference_image_vision"


@pytest.mark.asyncio
async def test_match_org_workflow_and_build_plan():
    org_id = "org-test-1"
    _WORKFLOW_CACHE[org_id] = [
        {
            "id": "wf-1",
            "name": "Monthly review",
            "description": "Analyze then dashboard",
            "trigger_patterns": [r"monthly review"],
            "steps": [
                {"id": "a1", "capability": "analytics_pipeline", "label": "Analyze"},
                {"id": "d1", "capability": "create_dashboard", "label": "Dashboard", "depends_on": ["a1"]},
            ],
        }
    ]
    wf = match_org_workflow(org_id, "Run our monthly review for sales")
    assert wf is not None
    goal = AgentGoal(objective="Monthly review", deliverable_type=DeliverableType.multi_step)
    plan = await build_plan(goal, {"organization_id": org_id, "query": "monthly review for sales"}, litellm_service=None)
    assert len(plan.steps) == 2
    assert plan.steps[0].capability == "analytics_pipeline"
    assert plan.steps[1].capability == "create_dashboard"
    _WORKFLOW_CACHE.pop(org_id, None)


def test_adaptive_continuation_incomplete_dashboard_goal():
    cont = compute_continuation(
        {
            "agent_goal": {
                "objective": "Sales KPI dashboard",
                "deliverable_type": "dashboard",
            },
            "active_goal": {"status": "in_progress", "deliverable_type": "dashboard"},
            "current_stage": "agent_goal_partial",
        }
    )
    assert cont["suggestions"]
    assert "dashboard" in cont["proactive_message"].lower()
