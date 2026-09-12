"""Executive report must never persist LiteLLM's conversational fallback as narrative."""

import os
from unittest.mock import patch

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")

from ee.modules.ai.nodes.executive_report_execution_node import (
    _deterministic_section_narrative,
    _generate_section_narrative,
)
from ee.modules.ai.nodes.executive_report_synthesis_node import _fallback_executive_summary

_FALLBACK = (
    "I understand you're looking for data analysis. While I'm experiencing some "
    "technical difficulties with my AI service, I can still help you with:\n\n"
    "Data Analysis Guidance:\n"
    '- Connect your data source using the "Connect Data" button\n'
    "Available Tools:\n"
    "- Chart Builder with ECharts integration\n"
    "- SQL query builder"
)


@pytest.mark.asyncio
async def test_section_narrative_replaces_fallback_markdown_with_data_facts():
    async def fake_generate_completion(self, **kwargs):
        assert kwargs.get("reject_fallback_content") is True
        assert kwargs.get("response_format") == {"type": "json_object"}
        return {"success": True, "content": _FALLBACK}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=fake_generate_completion,
    ):
        result = await _generate_section_narrative(
            section_type="kpi",
            section_title="Disbursement volume",
            rows=[{"total_amount": 1_240_000.0, "loan_count": 84}],
            columns=["total_amount", "loan_count"],
            data_source_name="Loans",
            report_title="Lending review",
        )

    narrative = result.get("narrative") or ""
    assert "Connect Data" not in narrative
    assert "technical difficulties" not in narrative.lower()
    assert "SQL query builder" not in narrative
    assert "Disbursement volume" in narrative or "total_amount" in narrative.lower() or result.get("key_metric")


@pytest.mark.asyncio
async def test_section_narrative_uses_deterministic_copy_when_llm_fails():
    async def fake_generate_completion(self, **kwargs):
        return {"success": False, "content": None, "error": "timeout"}

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=fake_generate_completion,
    ):
        result = await _generate_section_narrative(
            section_type="kpi",
            section_title="Headcount",
            rows=[{"employees": 42}],
            columns=["employees"],
            data_source_name="HR",
            report_title="Workforce",
        )

    assert "Connect Data" not in (result.get("narrative") or "")
    assert result.get("key_metric")


def test_deterministic_section_narrative_cites_stats_not_help_copy():
    out = _deterministic_section_narrative(
        "Revenue",
        "kpi",
        [{"revenue": 5000}],
        ["revenue"],
        "- revenue: 5,000 (min=5000, max=5000)",
    )
    assert "Connect Data" not in out["narrative"]
    assert "Revenue" in out["narrative"]
    assert out["key_metric"]


def test_fallback_executive_summary_skips_canned_section_copy():
    summary = _fallback_executive_summary(
        completed=[
            {
                "title": "Overview",
                "narrative": _FALLBACK,
                "key_metric": "Connect Data",
                "key_metric_value": "yes",
            },
            {
                "title": "Trend",
                "narrative": "Disbursements rose 8% month over month against last quarter.",
            },
        ],
        key_metrics=[],
        title="Lending review",
    )
    assert "Connect Data" not in summary
    assert "technical difficulties" not in summary.lower()
    assert "Disbursements rose 8%" in summary
