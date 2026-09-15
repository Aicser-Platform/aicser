"""Regression test: a report with a mix of complete and failed/empty
sections must disclose the omission in the text the user actually reads,
not just a boolean flag on an internal SSE event.

Root cause, live-verified: `is_partial` required failures to be the
MAJORITY of sections (`len(failed) >= len(completed)`) before disclosing
anything. A live-reproduced 6-of-7-sections report (one section hit a
distinct SQL-generation failure, unrelated to this fix) computed
is_partial=False, so the one missing analysis the report promised was
never surfaced anywhere the user could see it — the executive summary read
identically to a fully-complete report.

Fixed by (1) setting is_partial whenever ANY section is non-complete, not
just when failures are the majority, and (2) appending a concrete,
named disclosure to executive_summary itself (the text that becomes
state["message"], what the user actually reads) — matching the same
principle already applied to dashboards' degraded_suffix honesty note.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.executive_report_synthesis_node import executive_report_synthesis_node


def _section(title: str, status: str, narrative: str = "") -> dict:
    return {
        "title": title,
        "status": status,
        "narrative": narrative,
        "key_metric": "Average Score" if status == "complete" else None,
        "key_metric_value": "86.65" if status == "complete" else None,
    }


def _base_state(sections: list) -> dict:
    return {
        "report_plan": {"title": "Student Performance Report", "tier": "standard"},
        "report_sections": sections,
        "query": "generate an executive report on student performance",
        "data_source_name": "Education",
        "user_id": "user-1",
        "organization_id": "org-1",
    }


@pytest.mark.asyncio
async def test_partial_report_discloses_the_missing_section_by_name():
    sections = [
        _section("Yearly Performance Baselines", "complete", "Scores trended up."),
        _section("Grade Distribution", "complete", "Most students cluster in B/C."),
        _section("Top 15 Students by Average Score", "failed"),
    ]
    fake_llm_response = {
        "success": True,
        "content": (
            '{"executive_summary": "Overall performance improved this term, '
            'driven by strong gains across most cohorts.", '
            '"recommendations": [{"title": "Monitor at-risk students", "action": "Review weekly"}], '
            '"follow_up_questions": ["What drove the improvement?"]}'
        ),
    }
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_stream_callback",
        new=AsyncMock(return_value=fake_llm_response),
    ):
        out = await executive_report_synthesis_node(_base_state(sections))

    assert out["report_plan"]["metadata"]["is_partial"] is True
    assert "Top 15 Students by Average Score" in out["executive_summary"]
    assert "Top 15 Students by Average Score" in out["message"]
    assert "1 of 3 section(s)" in out["executive_summary"]


@pytest.mark.asyncio
async def test_fully_complete_report_has_no_disclosure_note():
    sections = [
        _section("Yearly Performance Baselines", "complete", "Scores trended up."),
        _section("Grade Distribution", "complete", "Most students cluster in B/C."),
    ]
    fake_llm_response = {
        "success": True,
        "content": '{"executive_summary": "Performance improved across all cohorts.", "recommendations": [], "follow_up_questions": []}',
    }
    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion_with_stream_callback",
        new=AsyncMock(return_value=fake_llm_response),
    ):
        out = await executive_report_synthesis_node(_base_state(sections))

    assert out["report_plan"]["metadata"]["is_partial"] is False
    assert "_Note:" not in out["executive_summary"]
