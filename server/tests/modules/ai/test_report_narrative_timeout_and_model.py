"""Regression tests: every LLM call in the executive report pipeline must
get a realistic timeout budget and respect the user's selected model.

Root cause, live-reproduced while auditing executive_report mode: an
explicit "generate an executive report on student performance" request
completed the full pipeline (routing, planning, execution, synthesis) but
timed out repeatedly at the 25s default (tuned for quick routing/
classification calls, not for planning a multi-section report or writing a
full analytical narrative from real data) -- first in report planning
(_llm_refine_plan), then again in every one of the 4 sections'
narrative generation (_generate_section_narrative), producing a report with
zero real content (artifact quality gate scored 0.00). None of these calls
(nor _llm_correct_sql's SQL-repair call, nor synthesis's final-summary call)
accepted or passed a model_id either, so they also always ignored an
explicit model selection the same way the nine agent_context["model_id"]
sites did elsewhere in the codebase.

Fixed by giving each call an explicit, complexity-appropriate timeout (45s
for full-report/section generation, 35s for the narrower SQL-repair task)
and threading model_id through each call chain down to generate_completion.

Later consolidated further: the hand-picked per-call timeout=45.0/35.0
values were superseded by ee.modules.ai.utils.llm_call_budget.timeout_for
(see test_llm_call_budget.py), which derives a budget from each call's own
max_tokens instead of a value someone had to remember to hardcode. These
call sites now correctly pass no explicit timeout at all — asserted below
as `timeout is None`, which is what lets generate_completion's own default
resolution take over.
"""

from typing import Optional
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.executive_report_execution_node import (
    _generate_section_narrative,
    _llm_correct_sql,
)
from ee.modules.ai.nodes.executive_report_planner_node import _llm_refine_plan


@pytest.mark.asyncio
async def test_narrative_call_delegates_timeout_and_passes_user_model():
    captured = {}

    async def fake_generate_completion(self, **kwargs):
        captured.update(kwargs)
        return {"success": True, "content": '{"narrative": "Scores trended up 4% this term."}'}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=fake_generate_completion,
    ):
        result = await _generate_section_narrative(
            section_type="kpi",
            section_title="Average Score",
            rows=[{"grade_letter": "A", "score": 91.2}],
            columns=["grade_letter", "score"],
            data_source_name="Education",
            report_title="Student Performance Report",
            model_id="byok_ollama_qwen",
        )

    assert captured.get("timeout") is None
    assert captured.get("model_id") == "byok_ollama_qwen"
    assert result.get("narrative")


@pytest.mark.asyncio
async def test_narrative_call_works_with_no_explicit_model_selected():
    """Control case: auto/no selection must still resolve to None cleanly,
    not crash or block the call."""
    captured = {}

    async def fake_generate_completion(self, **kwargs):
        captured.update(kwargs)
        return {"success": True, "content": '{"narrative": "ok"}'}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=fake_generate_completion,
    ):
        await _generate_section_narrative(
            section_type="kpi",
            section_title="Average Score",
            rows=[{"grade_letter": "A", "score": 91.2}],
            columns=["grade_letter", "score"],
            data_source_name="Education",
            report_title="Student Performance Report",
        )

    assert captured.get("model_id") is None
    assert captured.get("timeout") is None


@pytest.mark.asyncio
async def test_sql_correction_call_delegates_timeout_and_passes_user_model():
    captured = {}

    async def fake_generate_completion(self, **kwargs):
        captured.update(kwargs)
        return {"success": True, "content": "SELECT score FROM grades"}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=fake_generate_completion,
    ):
        corrected = await _llm_correct_sql(
            original_sql="SELECT scoer FROM grades",
            error_message="column 'scoer' not found",
            section_title="Average Score",
            section_type="kpi",
            model_id="byok_ollama_qwen",
        )

    assert captured.get("timeout") is None
    assert captured.get("model_id") == "byok_ollama_qwen"
    assert corrected == "SELECT score FROM grades"
    # See test_pii_gate_protected_terms.py: schema_line embeds real
    # schema-qualified identifiers, which a PII detector's URL/domain
    # pattern can corrupt mid-token (".gr"/".st" are real ccTLDs) the same
    # way it did in nl2sql_node.py before that fix — this call needs the
    # same protection since it also builds SQL a parser will reject outright
    # if an identifier gets corrupted.
    assert captured.get("auto_protect_identifiers") is True


@pytest.mark.asyncio
async def test_report_plan_refinement_delegates_timeout_and_passes_user_model():
    captured = {}

    async def fake_generate_completion(self, **kwargs):
        captured.update(kwargs)
        return {
            "success": True,
            "content": '{"report_title": "Student Performance Report", "section_updates": [], "flex_sections": []}',
        }

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=fake_generate_completion,
    ):
        refined = await _llm_refine_plan(
            sections=[{"id": "kpi_1", "type": "kpi", "title": "Average Score", "sql": "SELECT 1"}],
            tier_config={"flex_slots": 1},
            classified={"numeric": ["score"], "temporal": [], "categorical": ["grade_letter"]},
            table="grades",
            dialect="duckdb",
            query="generate an executive report on student performance",
            schema_summary="grades.score DOUBLE\ngrades.grade_letter VARCHAR",
            data_source_name="Education",
            model_id="byok_ollama_qwen",
        )

    assert captured.get("timeout") is None
    assert captured.get("model_id") == "byok_ollama_qwen"
    assert refined["title"] == "Student Performance Report"
