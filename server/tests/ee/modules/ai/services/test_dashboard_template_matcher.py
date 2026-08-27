"""LLM-driven dashboard-request -> template matching - the bridge between
the static template gallery and the AI dashboard planner, which previously
had zero awareness the gallery existed."""

import pytest

from ee.modules.ai.services.dashboard_template_matcher import (
    build_template_reference_hint,
    find_matching_dashboard_template,
)


class FakeLiteLLM:
    def __init__(self, content, success=True):
        self.content = content
        self.success = success
        self.calls = []

    async def generate_completion(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": self.success, "content": self.content}


CANDIDATES = [
    {"id": "banking_portfolio_overview", "name": "Customer Loan Analytics", "category": "banking",
     "widgets": [{"name": "Total Loans", "chart_type": "stat"}]},
    {"id": "energy_consumption_operations", "name": "Grid Operations", "category": "energy",
     "widgets": [{"name": "Peak Load", "chart_type": "line"}]},
]


@pytest.mark.asyncio
async def test_returns_none_without_prompt_or_candidates():
    assert await find_matching_dashboard_template("", CANDIDATES) is None
    assert await find_matching_dashboard_template("loan performance", []) is None


@pytest.mark.asyncio
async def test_returns_matched_candidate_when_llm_is_confident():
    llm = FakeLiteLLM('{"match_index": 0, "confident": true}')
    result = await find_matching_dashboard_template("show me loan performance by branch", CANDIDATES, llm)
    assert result is not None
    assert result["id"] == "banking_portfolio_overview"


@pytest.mark.asyncio
async def test_returns_none_when_llm_is_not_confident():
    llm = FakeLiteLLM('{"match_index": 0, "confident": false}')
    result = await find_matching_dashboard_template("random unrelated request", CANDIDATES, llm)
    assert result is None


@pytest.mark.asyncio
async def test_returns_none_on_out_of_range_index():
    llm = FakeLiteLLM('{"match_index": 99, "confident": true}')
    result = await find_matching_dashboard_template("something", CANDIDATES, llm)
    assert result is None


@pytest.mark.asyncio
async def test_fails_open_on_llm_error():
    llm = FakeLiteLLM(None, success=False)
    result = await find_matching_dashboard_template("something", CANDIDATES, llm)
    assert result is None


@pytest.mark.asyncio
async def test_fails_open_on_malformed_json():
    llm = FakeLiteLLM("not json at all")
    result = await find_matching_dashboard_template("something", CANDIDATES, llm)
    assert result is None


def test_build_template_reference_hint_includes_name_and_widgets():
    hint = build_template_reference_hint(CANDIDATES[0])
    assert "Customer Loan Analytics" in hint
    assert "Total Loans" in hint
    assert "ACTUAL connected schema" in hint
