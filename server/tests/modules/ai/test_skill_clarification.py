"""Tests for LLM-judged skill clarification (skill_executor_node.py).

Choke point: right before an export-category skill (generate_docx/pptx/pdf)
actually runs, an LLM decides whether THIS specific request has a genuinely
important, unresolved ambiguity worth pausing to ask about -- not a fixed
rule, not "always confirm" (the previous static L2_CONFIRM policy tier
already did that, with a generic yes/no prompt and no real question). Ask
too often and every export becomes friction; never ask and a business
report can render with a raw SQL block, or a technical one loses the detail
it needed.

Fail-open throughout: any error/missing config, or a low-confidence/
malformed LLM response, must mean "proceed with the confident default"
(export_artifacts_service._detect_report_audience), never "block export".

Timing: the judge runs ONCE against the whole plan before ANY step executes
(a dedicated pre-loop scan), not inline right before the export step
specifically runs. A multi-step plan (analysis step + export step in the
same turn) must ask before the analysis runs, not after -- asking only at
the export step meant the user sat through real work before being asked
something answerable from the request alone.

Every test here grants RBAC permission unconditionally (patching
RBACService.check_permission) since the pre-loop RBAC gate now runs before
the clarification judge and would otherwise fail closed on these tests'
non-UUID "u1" user_id -- RBAC itself has dedicated coverage in
test_skill_rbac_permission_gate.py; these tests isolate the clarification
judge specifically.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.skill_executor_node import skill_executor_node
from ee.modules.ai.skills.registry import _REGISTRY


def _grant_rbac():
    return patch(
        "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    )


def _fake_tools_response(needs_clarification: bool, question: str = "", options=None):
    async def fake(self, prompt, system_context, tools, **kwargs):
        assert any(t["function"]["name"] == "clarification_decision" for t in tools)
        args = {"needs_clarification": needs_clarification}
        if needs_clarification:
            args["question"] = question
            args["options"] = options or []
        return {"success": True, "tool_calls": [{"name": "clarification_decision", "arguments": args}], "content": ""}

    return fake


@pytest.mark.asyncio
async def test_clarification_needed_blocks_export_and_returns_question():
    async def fake_docx(ctx):
        raise AssertionError("generate_docx must not run while clarification is pending")

    original = _REGISTRY["generate_docx"].handler
    _REGISTRY["generate_docx"].handler = fake_docx
    try:
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
            new=_fake_tools_response(
                True,
                "Should this be written for a business or technical audience?",
                ["Business audience", "Technical audience (include SQL/methodology)"],
            ),
        ), patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
            new=AsyncMock(return_value=None),
        ), _grant_rbac():
            state = {
                "query": "[Agent Skill: generate_docx]",
                "user_id": "u1",
                "organization_id": "org-1",
                "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "generate_docx", "status": "pending"}]},
                "sql_query": "SELECT status_id, AVG(average_score) FROM enrollments GROUP BY status_id",
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["generate_docx"].handler = original

    result = out["skill_results"][0]
    assert result["success"] is False
    assert result["requires_approval"] is True
    assert "business or technical" in result["clarification_question"]
    assert result["clarification_options"] == [
        "Business audience",
        "Technical audience (include SQL/methodology)",
    ]


@pytest.mark.asyncio
async def test_clarification_not_needed_runs_export_normally():
    async def fake_docx(ctx):
        return {"success": True, "message": "Word report ready.", "download_url": "/ai/artifacts/abc"}

    original = _REGISTRY["generate_docx"].handler
    _REGISTRY["generate_docx"].handler = fake_docx
    try:
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
            new=_fake_tools_response(False),
        ), patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
            new=AsyncMock(return_value=None),
        ), _grant_rbac():
            state = {
                "query": "[Agent Skill: generate_docx]",
                "user_id": "u1",
                "organization_id": "org-1",
                "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "generate_docx", "status": "pending"}]},
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["generate_docx"].handler = original

    result = out["skill_results"][0]
    assert result["success"] is True
    assert "clarification_question" not in result


@pytest.mark.asyncio
async def test_judge_failure_fails_open_and_runs_export_anyway():
    """The judge call itself erroring must never block the export."""

    async def fake_docx(ctx):
        return {"success": True, "message": "Word report ready."}

    async def fake_raises(self, prompt, system_context, tools, **kwargs):
        raise RuntimeError("provider unavailable")

    original = _REGISTRY["generate_docx"].handler
    _REGISTRY["generate_docx"].handler = fake_docx
    try:
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
            new=fake_raises,
        ), patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
            new=AsyncMock(return_value=None),
        ), _grant_rbac():
            state = {
                "query": "[Agent Skill: generate_docx]",
                "user_id": "u1",
                "organization_id": "org-1",
                "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "generate_docx", "status": "pending"}]},
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["generate_docx"].handler = original

    result = out["skill_results"][0]
    assert result["success"] is True


@pytest.mark.asyncio
async def test_non_export_skill_never_triggers_clarification_judge():
    """run_sql (category='workflow') must not pay for the clarification
    judge call at all -- only export-category skills are eligible."""
    calls = {"clarification_judge": False}

    async def fake_run_sql(ctx):
        return {"success": True, "message": "Ran SQL."}

    async def fake_tools(self, prompt, system_context, tools, **kwargs):
        if any(t["function"]["name"] == "clarification_decision" for t in tools):
            calls["clarification_judge"] = True
        return {"success": True, "tool_calls": [], "content": ""}

    original = _REGISTRY["run_sql"].handler
    _REGISTRY["run_sql"].handler = fake_run_sql
    try:
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
            new=fake_tools,
        ), _grant_rbac():
            state = {
                "query": "[Agent Skill: run_sql]",
                "user_id": "u1",
                "organization_id": "org-1",
                "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "run_sql", "status": "pending"}]},
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["run_sql"].handler = original

    assert out["skill_results"][0]["success"] is True
    assert calls["clarification_judge"] is False


@pytest.mark.asyncio
async def test_clarification_fires_before_earlier_plan_steps_run():
    """Two-step plan: run_sql then generate_docx. When the judge says the
    export needs clarification, run_sql must NEVER execute -- the whole
    point of checking upfront is not making the user wait through real work
    first."""
    sql_step_ran = {"value": False}

    async def fake_run_sql(ctx):
        sql_step_ran["value"] = True
        return {"success": True, "message": "Ran SQL."}

    async def fake_docx(ctx):
        raise AssertionError("generate_docx must not run while clarification is pending")

    original_sql = _REGISTRY["run_sql"].handler
    original_docx = _REGISTRY["generate_docx"].handler
    _REGISTRY["run_sql"].handler = fake_run_sql
    _REGISTRY["generate_docx"].handler = fake_docx
    try:
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_tools",
            new=_fake_tools_response(True, "Business or technical audience?", ["Business", "Technical"]),
        ), patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
            new=AsyncMock(return_value=None),
        ), _grant_rbac():
            state = {
                "query": "analyze this and write a report for the board",
                "user_id": "u1",
                "organization_id": "org-1",
                "agent_plan": {
                    "steps": [
                        {"id": "s1", "type": "skill", "skill": "run_sql", "status": "pending"},
                        {"id": "s2", "type": "skill", "skill": "generate_docx", "status": "pending"},
                    ]
                },
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["run_sql"].handler = original_sql
        _REGISTRY["generate_docx"].handler = original_docx

    assert sql_step_ran["value"] is False
    assert out["current_stage"] == "skill_needs_clarification"
    assert out["skill_results"][0]["clarification_question"] == "Business or technical audience?"
