"""Regression tests for post-execution dashboard insight regeneration.

Root cause: key_insight/dashboard_subtitle were written at PLANNING time
(either by plan_dashboard_with_llm's LLM call or the heuristic seed), before
dashboard_query_execution_node had run a single widget query -- so even a
perfectly-working LLM call could only produce a plausible-sounding guess
("Focus on how score varies by grade letter."), never a real finding. This
mirrors a pattern already correct elsewhere in this codebase: nl2sql's
insight_engine and executive_report_execution_node's
_generate_section_narrative both write their narrative AFTER the real query
results exist. regenerate_insight_from_real_data closes that gap for
dashboards, called from dashboard_materializer_node after
dashboard_query_execution_node has already populated
state["dashboard_executed_sections"] with real data.
"""

from unittest.mock import AsyncMock, patch

import json
import pytest

from ee.modules.ai.services.dashboard_llm_planner import (
    _format_executed_sections_for_prompt,
    regenerate_insight_from_real_data,
)
from ee.modules.ai.services.dashboard_generation_service import is_scaffolding_executive_copy


def _section(title, data, status="complete"):
    return {"title": title, "data": data, "status": status}


class TestFormatExecutedSections:
    def test_formats_real_values_compactly(self):
        sections = [
            _section("Average Score", [{"value": 78.71}]),
            _section("Score by Grade Letter", [
                {"grade_letter": "F", "score": 2009.3},
                {"grade_letter": "A", "score": 1908.1},
            ]),
        ]
        out = _format_executed_sections_for_prompt(sections)
        assert "Average Score" in out
        assert "78.71" in out
        assert "grade_letter=F" in out
        assert "score=2009.3" in out

    def test_skips_failed_and_empty_sections(self):
        sections = [
            _section("Broken Widget", None, status="failed"),
            _section("Empty Widget", [], status="empty"),
            _section("Working Widget", [{"value": 42}]),
        ]
        out = _format_executed_sections_for_prompt(sections)
        assert "Broken Widget" not in out
        assert "Empty Widget" not in out
        assert "Working Widget" in out

    def test_empty_input_produces_empty_summary(self):
        assert _format_executed_sections_for_prompt([]) == ""

    def test_truncates_rows_and_notes_the_remainder(self):
        rows = [{"category": f"cat{i}", "value": i} for i in range(20)]
        out = _format_executed_sections_for_prompt([_section("Big Breakdown", rows)])
        assert "+15 more" in out


class TestScaffoldingDetection:
    def test_board_composition_and_focus_on_are_scaffolding(self):
        assert is_scaffolding_executive_copy("Board composition: 1 narrative, 3 KPIs, 4 analytical views.")
        assert is_scaffolding_executive_copy("Focus on how score varies by grade letter.")
        assert is_scaffolding_executive_copy("This dashboard tracks revenue performance across region.")
        assert is_scaffolding_executive_copy("This board answers: show me sales.")

    def test_real_finding_is_not_scaffolding(self):
        assert not is_scaffolding_executive_copy("F-grade students (24) outnumber every other grade band.")


class TestRegenerateInsightFromRealData:
    @pytest.mark.asyncio
    async def test_writes_grounded_insight_from_real_data(self):
        fake_result = {
            "success": True,
            "content": json.dumps(
                {
                    "key_insight": "F-grade students (24) outnumber every other grade band.",
                    "story_arc": "F grades dominate at 24 students — review the grade breakdown next.",
                }
            ),
        }
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
            new=AsyncMock(return_value=fake_result),
        ):
            insight, ok = await regenerate_insight_from_real_data(
                [_section("Score by Grade Letter", [{"grade_letter": "F", "count": 24}])],
                data_source_name="Education",
            )
        assert ok is True
        assert "F-grade" in insight

    @pytest.mark.asyncio
    async def test_provider_error_uses_deterministic_fallback(self):
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
            new=AsyncMock(side_effect=RuntimeError("provider unreachable")),
        ):
            insight, ok = await regenerate_insight_from_real_data(
                [_section("Score by Grade Letter", [{"grade_letter": "F", "count": 24}])],
            )
        assert ok is True
        assert insight is not None
        assert "Score by Grade Letter" in insight
        assert "24" in insight

    @pytest.mark.asyncio
    async def test_no_real_data_skips_the_llm_call_entirely(self):
        """No executed sections with real data (all failed/empty) means there's
        nothing grounded to write about - must not spend an LLM call on it."""
        mock_completion = AsyncMock()
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
            new=mock_completion,
        ):
            insight, ok = await regenerate_insight_from_real_data(
                [_section("Broken", None, status="failed")],
            )
        assert ok is False
        assert insight is None
        mock_completion.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_hydrates_byok_before_the_call(self):
        with patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
            new=AsyncMock(),
        ) as mock_hydrate, patch(
            "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
            new=AsyncMock(
                return_value={
                    "success": True,
                    "content": json.dumps(
                        {"key_insight": "A real finding.", "story_arc": "A real finding with context."}
                    ),
                }
            ),
        ):
            await regenerate_insight_from_real_data(
                [_section("Widget", [{"value": 1}])],
                user_id="user-123",
            )
        mock_hydrate.assert_awaited_once_with("user-123")


@pytest.mark.asyncio
async def test_materializer_uses_regenerated_insight_and_clears_the_honesty_note():
    """End-to-end: even when the planning-time LLM failed (used_llm=False,
    triggering the honesty note - see test_dashboard_llm_honesty.py), a
    successful post-execution regeneration must win: replace the generic
    key_insight AND clear the "AI-refined insights weren't available" note,
    since real, grounded insight generation did in fact succeed."""
    from ee.modules.ai.nodes.dashboard_pesd_nodes import dashboard_materializer_node

    state = {
        "data_source_id": "ds-1",
        "project_id": "proj-1",
        "user_id": "user-1",
        "query": "build a dashboard about education",
        "data_source_schema": {},
        "dashboard_widget_specs": [{"id": "w1"}],
        "dashboard_plan_meta": {},
        "dashboard_llm_plan_meta": {
            "key_insight": "Focus on how score varies by grade letter.",
            "generated_by": "heuristic_fallback",
            "used_llm": False,
        },
        "dashboard_executed_sections": [
            _section("Score by Grade Letter", [{"grade_letter": "F", "score": 2009.3}]),
        ],
        "agent_context": {},
    }
    fake_dashboard_result = {
        "dashboard_id": "dash-1",
        "widget_count": 1,
        "failed_widgets": 0,
        "status": "complete",
        "dashboard_name": "Education",
        "widgets": [],
    }

    async def _fake_create_dashboard_from_plan(*args, **kwargs):
        # The materializer must have already injected the regenerated
        # insight into plan_meta before calling this.
        assert kwargs["prebuilt_plan_meta"]["key_insight"] == "F grades are the largest group at 2009.3 total."
        return {**fake_dashboard_result, "key_insight": kwargs["prebuilt_plan_meta"]["key_insight"]}

    with patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.create_dashboard_from_plan",
        new=_fake_create_dashboard_from_plan,
    ), patch(
        "ee.modules.ai.nodes.dashboard_pesd_nodes.emit_dashboard_widget_ready",
        new=AsyncMock(),
    ), patch("src.db.session.async_session"), patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(
            return_value={
                "success": True,
                "content": json.dumps(
                    {
                        "key_insight": "F grades are the largest group at 2009.3 total.",
                        "story_arc": "F grades lead at 2009.3 — review the grade breakdown next.",
                    }
                ),
            }
        ),
    ):
        out = await dashboard_materializer_node(state)

    assert "F grades are the largest group at 2009.3 total." in out["message"]
    assert "AI-refined insights weren't available" not in out["message"]
