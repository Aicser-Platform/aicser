"""Tests for the reasoning-tier escalation path (kernel/replanner.py ->
kernel/executor.py -> model_tiering.py) and the extended-thinking / reasoning-effort
parameter passthrough in generate_completion().

Before this: a verification failure retried the exact same model/config that
already failed. Now the retry step is flagged escalate_model=True, which forces
reasoning-tier model resolution for that one step via a contextvar, then resets.
"""

import pytest

from ee.modules.ai.kernel.replanner import replan
from ee.modules.ai.kernel.schemas import AgentGoal, AgentPlan, AgentPlanStep, VerificationResult
from ee.modules.ai.services import litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import LiteLLMService
from ee.modules.ai.services.model_tiering import resolve_model_for_node
from ee.modules.ai.utils.escalation_context import is_reasoning_escalated, set_reasoning_escalated


def test_replan_marks_retry_step_for_escalation():
    goal = AgentGoal(deliverable_type="chart_analysis", raw_query="test", objective="test objective")
    step = AgentPlanStep(id="s1", capability="run_sql", label="Run SQL", status="failed", params={"query": "SELECT 1"})
    plan = AgentPlan(goal=goal, steps=[step])
    verification = VerificationResult(passed=False, heal_action="replanner", issues=["bad output"])

    new_plan = replan(plan, {}, verification)
    retry_step = new_plan.steps[-1]

    assert retry_step.params.get("escalate_model") is True
    assert retry_step.params.get("retry") is True


def test_escalation_forces_reasoning_tier_and_resets(monkeypatch):
    # This suite runs against a live deploy env with real provider credentials
    # configured (TokenHarbor primary override + real Azure) - left unset, one
    # of those registers for real and resolve_model_for_node then (correctly)
    # resolves a fast-tier model for it instead of "no escalation needed".
    for var in (
        "PRIMARY_MODEL_PROVIDER", "PRIMARY_MODEL_DEPLOYMENT_NAME", "PRIMARY_MODEL_API_KEY", "PRIMARY_MODEL_ENDPOINT",
        "REASONING_MODEL_PROVIDER", "REASONING_MODEL_DEPLOYMENT_NAME", "REASONING_MODEL_API_KEY", "REASONING_MODEL_ENDPOINT",
        "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_GPT41_API_KEY", "AZURE_OPENAI_GPT41_ENDPOINT",
        "OPENAI_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    service = LiteLLMService()
    service.available_models["azure_reasoning"] = {
        "name": "Reasoning",
        "model": "azure/gpt-5",
        "provider": "azure",
        "api_key": "x",
        "api_base": "x",
        "api_version": "x",
        "max_tokens": 16384,
        "tier": "reasoning",
    }

    assert not is_reasoning_escalated()
    # skill_executor is tagged "fast" in _NODE_TIERS - normally never escalates.
    assert resolve_model_for_node("skill_executor", service, None) is None

    set_reasoning_escalated(True)
    try:
        assert resolve_model_for_node("skill_executor", service, None) == "azure_reasoning"
    finally:
        set_reasoning_escalated(False)

    assert not is_reasoning_escalated()
    assert resolve_model_for_node("skill_executor", service, None) is None


@pytest.mark.asyncio
async def test_claude_reasoning_tier_gets_extended_thinking(monkeypatch):
    captured = {}

    class _Msg:
        content = "ok"

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]
        usage = None

    async def fake_acompletion(**params):
        captured.update(params)
        return _Resp()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["claude_reasoning"] = {
        "name": "Claude Opus",
        "model": "anthropic/claude-opus-4-8",
        "provider": "anthropic",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "reasoning",
    }

    result = await service.generate_completion(prompt="test", model_id="claude_reasoning", max_tokens=4000)

    assert result["success"] is True
    assert captured.get("thinking") == {"type": "enabled", "budget_tokens": 2000}
    assert captured.get("temperature") == 1.0
    assert "max_completion_tokens" not in captured


@pytest.mark.asyncio
async def test_reasoning_content_is_captured_when_provider_returns_it(monkeypatch):
    """Extended thinking was requested via `thinking`/`reasoning_effort` but the
    response-parsing path never read it back — the provider's real reasoning content
    was silently discarded. generate_completion() must surface it as
    result['reasoning_content'] so callers (e.g. a future "Show reasoning" UI wire-up)
    can use the model's actual thinking instead of a separately-synthesized narrative."""

    class _Msg:
        content = "final answer"
        reasoning_content = "step 1: consider X. step 2: therefore Y."

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]
        usage = None

    async def fake_acompletion(**params):
        return _Resp()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["claude_reasoning"] = {
        "name": "Claude Opus",
        "model": "anthropic/claude-opus-4-8",
        "provider": "anthropic",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "reasoning",
    }

    result = await service.generate_completion(prompt="test", model_id="claude_reasoning", max_tokens=4000)

    assert result["success"] is True
    assert result["reasoning_content"] == "step 1: consider X. step 2: therefore Y."


@pytest.mark.asyncio
async def test_reasoning_content_falls_back_to_thinking_blocks(monkeypatch):
    """Some Anthropic responses carry structured thinking_blocks instead of a plain
    reasoning_content string — must be flattened into readable text, not dropped."""

    class _Msg:
        content = "final answer"
        reasoning_content = None
        thinking_blocks = [{"thinking": "first consideration"}, {"thinking": "second consideration"}]

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]
        usage = None

    async def fake_acompletion(**params):
        return _Resp()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["claude_reasoning"] = {
        "name": "Claude Opus",
        "model": "anthropic/claude-opus-4-8",
        "provider": "anthropic",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "reasoning",
    }

    result = await service.generate_completion(prompt="test", model_id="claude_reasoning", max_tokens=4000)

    assert result["reasoning_content"] == "first consideration\n\nsecond consideration"


@pytest.mark.asyncio
async def test_reasoning_content_is_none_when_provider_does_not_return_it(monkeypatch):
    """The overwhelming majority of calls (non-reasoning tier, or a provider that
    doesn't expose thinking) must not fabricate reasoning content — None, not ''."""

    class _Msg:
        content = "final answer"

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]
        usage = None

    async def fake_acompletion(**params):
        return _Resp()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["claude_fast"] = {
        "name": "Claude Fast",
        "model": "anthropic/claude-haiku-4-5",
        "provider": "anthropic",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "fast",
    }

    result = await service.generate_completion(prompt="test", model_id="claude_fast", max_tokens=4000)

    assert result["reasoning_content"] is None


@pytest.mark.asyncio
async def test_fast_tier_model_gets_no_thinking_param(monkeypatch):
    captured = {}

    class _Msg:
        content = "ok"

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]
        usage = None

    async def fake_acompletion(**params):
        captured.update(params)
        return _Resp()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["claude_fast"] = {
        "name": "Claude Haiku",
        "model": "anthropic/claude-haiku-4-5",
        "provider": "anthropic",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "fast",
    }

    result = await service.generate_completion(prompt="test", model_id="claude_fast", max_tokens=4000)

    assert result["success"] is True
    assert "thinking" not in captured


@pytest.mark.asyncio
async def test_o_series_reasoning_tier_gets_reasoning_effort(monkeypatch):
    captured = {}

    class _Msg:
        content = "ok"

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]
        usage = None

    async def fake_acompletion(**params):
        captured.update(params)
        return _Resp()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["o3_reasoning"] = {
        "name": "o3",
        "model": "o3-mini",
        "provider": "openai",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "reasoning",
    }

    result = await service.generate_completion(prompt="test", model_id="o3_reasoning", max_tokens=4000)

    assert result["success"] is True
    assert captured.get("reasoning_effort") == "medium"
