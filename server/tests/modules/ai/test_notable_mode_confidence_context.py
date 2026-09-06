"""check_notable_mode_confidence sanity-checks a regex-guessed "notable" mode
(diagnostic/predictive/ai_search/etc.) with one LLM call before committing to
it - but the prompt only ever saw bare query text, the same blind spot fixed
in goal_resolver._llm_refine_goal for "which name has the highest current
balance?" being misclassified as kb_answer. Without knowing whether a
structured data source is connected (and what tables it has), the LLM has no
way to weigh "this is really just a routine ranking/lookup over real data"
against surface wording that resembles the guessed mode.

Also covers the migration off response_format={"type": "json_object"} (hand-
parsed text) onto real function-calling — the same structured-output pattern
already used by the kernel's planner.py._llm_decompose_steps."""

import pytest

from ee.modules.ai.utils.routing_utils import check_notable_mode_confidence


class FakeLiteLLM:
    def __init__(self, arguments: dict, success: bool = True, tool_calls: list | None = None):
        self.arguments = arguments
        self.success = success
        self.tool_calls_override = tool_calls
        self.calls: list = []

    async def generate_completion_with_tools(self, **kwargs):
        self.calls.append(kwargs)
        if self.tool_calls_override is not None:
            return {"success": self.success, "tool_calls": self.tool_calls_override}
        return {
            "success": self.success,
            "tool_calls": [{"name": "assess_routing_confidence", "arguments": self.arguments}],
        }


@pytest.mark.asyncio
async def test_uses_real_function_calling_not_json_object_mode():
    llm = FakeLiteLLM({"confident": True, "alternatives": []})
    await check_notable_mode_confidence(
        "which region has the highest churn", "diagnostic", litellm_service=llm,
    )
    assert len(llm.calls) == 1
    assert "response_format" not in llm.calls[0]
    tools = llm.calls[0]["tools"]
    assert tools[0]["function"]["name"] == "assess_routing_confidence"


@pytest.mark.asyncio
async def test_prompt_includes_connected_data_source_and_tables():
    llm = FakeLiteLLM({"confident": True, "alternatives": []})
    await check_notable_mode_confidence(
        "which region has the highest churn",
        "diagnostic",
        litellm_service=llm,
        data_source_id="ds-1",
        data_source_schema={"tables": [{"name": "customers"}, {"name": "churn_events"}]},
    )
    assert len(llm.calls) == 1
    prompt = llm.calls[0]["prompt"]
    assert "SQL/structured data source IS connected" in prompt
    assert "customers" in prompt and "churn_events" in prompt
    assert "highest/most" in prompt


@pytest.mark.asyncio
async def test_prompt_notes_absence_of_data_source():
    llm = FakeLiteLLM({"confident": True, "alternatives": []})
    await check_notable_mode_confidence(
        "what does our refund policy say?",
        "ai_search",
        litellm_service=llm,
    )
    assert len(llm.calls) == 1
    prompt = llm.calls[0]["prompt"]
    assert "No SQL/structured data source is connected" in prompt


@pytest.mark.asyncio
async def test_fails_open_without_litellm_service():
    confident, alternatives, reclassify_to, _needs_chart, _needs_narrative = await check_notable_mode_confidence(
        "which region has the highest churn", "diagnostic", litellm_service=None,
    )
    assert confident is True
    assert alternatives == []
    assert reclassify_to is None


@pytest.mark.asyncio
async def test_fails_open_when_model_calls_no_tool():
    """An empty tool_calls list (model judged nothing fit, or the call otherwise
    didn't produce a verdict) must fail open exactly like the old "no content"
    case did, not be treated as an error or as low confidence."""
    llm = FakeLiteLLM({}, tool_calls=[])
    confident, alternatives, reclassify_to, _needs_chart, _needs_narrative = await check_notable_mode_confidence(
        "which region has the highest churn", "diagnostic", litellm_service=llm,
    )
    assert confident is True
    assert alternatives == []
    assert reclassify_to is None


@pytest.mark.asyncio
async def test_reclassifies_when_llm_is_confident_in_a_specific_alternative():
    llm = FakeLiteLLM(
        {"confident": False, "alternatives": ["predictive"], "alternative_confidence": "high"}
    )
    confident, alternatives, reclassify_to, _needs_chart, _needs_narrative = await check_notable_mode_confidence(
        "what will churn look like next quarter", "diagnostic", litellm_service=llm,
    )
    assert confident is False
    assert alternatives == ["predictive"]
    assert reclassify_to == "predictive"


@pytest.mark.asyncio
async def test_does_not_reclassify_when_alternative_confidence_is_low():
    """Genuinely ambiguous disagreement (LLM can rule out the regex guess but
    isn't sure enough about any single replacement) must still fall through
    to asking the user, not silently guess on their behalf."""
    llm = FakeLiteLLM(
        {"confident": False, "alternatives": ["predictive", "prescriptive"], "alternative_confidence": "low"}
    )
    confident, alternatives, reclassify_to, _needs_chart, _needs_narrative = await check_notable_mode_confidence(
        "what should we expect and do about churn", "diagnostic", litellm_service=llm,
    )
    assert confident is False
    assert alternatives == ["predictive", "prescriptive"]
    assert reclassify_to is None


@pytest.mark.asyncio
async def test_no_reclassify_target_when_confident_in_original_guess():
    llm = FakeLiteLLM({"confident": True, "alternatives": []})
    confident, alternatives, reclassify_to, _needs_chart, _needs_narrative = await check_notable_mode_confidence(
        "which region has the highest churn", "diagnostic", litellm_service=llm,
    )
    assert confident is True
    assert reclassify_to is None
