"""Tests for LiteLLMService.generate_completion_with_tools (real LLM function-calling).

Covers the same safety rails generate_completion() already has, which this method
must match: org budget enforcement, outbound PII scrubbing, and output moderation.
generate_completion_with_stream_callback() got the identical fix at the same time
(it previously had none of these rails either, despite backing insight_synthesizer_node
-- the most-used narrative path in the product) and is covered alongside it here.
"""

from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.services import litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import LiteLLMService

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_sql",
            "description": "Run SQL against the active data source.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    }
]


def _make_service() -> LiteLLMService:
    service = LiteLLMService()
    service.available_models = {
        "fake_fast": {
            "name": "Fast",
            "model": "anthropic/claude-haiku-4-5",
            "provider": "anthropic",
            "api_key": "fake-key",
            "api_base": "",
            "api_version": "",
            "max_tokens": 8192,
            "tier": "fast",
        }
    }
    return service


class _FakeFunc:
    def __init__(self, name, args):
        self.name = name
        self.arguments = args


class _FakeToolCall:
    def __init__(self, name, args):
        self.function = _FakeFunc(name, args)


class _FakeMessage:
    def __init__(self, tool_calls=None, content=None):
        self.tool_calls = tool_calls or []
        self.content = content


class _FakeChoice:
    def __init__(self, message):
        self.message = message


class _FakeResponse:
    def __init__(self, message):
        self.choices = [_FakeChoice(message)]


@pytest.mark.asyncio
async def test_selects_a_tool(monkeypatch):
    async def fake_acompletion(**params):
        assert params.get("tool_choice") == "auto"
        assert params.get("tools") == _TOOLS
        return _FakeResponse(_FakeMessage(tool_calls=[_FakeToolCall("run_sql", "{}")]))

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        "src.modules.ai.services.org_budget_service.check_org_budget_allowed",
        AsyncMock(return_value=(True, None)),
    )

    service = _make_service()
    result = await service.generate_completion_with_tools(
        prompt="show me revenue", system_context="pick a tool", tools=_TOOLS, model_id="fake_fast",
    )

    assert result["success"] is True
    assert result["tool_calls"] == [{"name": "run_sql", "arguments": {}}]


@pytest.mark.asyncio
async def test_empty_selection_is_success_not_failure(monkeypatch):
    """The model judging that nothing fits is a legitimate outcome, not an error."""

    async def fake_acompletion(**params):
        return _FakeResponse(_FakeMessage(tool_calls=[]))

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        "src.modules.ai.services.org_budget_service.check_org_budget_allowed",
        AsyncMock(return_value=(True, None)),
    )

    service = _make_service()
    result = await service.generate_completion_with_tools(
        prompt="hello there", system_context="pick a tool", tools=_TOOLS, model_id="fake_fast",
    )

    assert result["success"] is True
    assert result["tool_calls"] == []


@pytest.mark.asyncio
async def test_blocked_when_org_over_budget(monkeypatch):
    called = {"acompletion": False}

    async def fake_acompletion(**params):
        called["acompletion"] = True
        return _FakeResponse(_FakeMessage())

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        "src.modules.ai.services.org_budget_service.check_org_budget_allowed",
        AsyncMock(return_value=(False, "Organization AI budget exceeded")),
    )

    service = _make_service()
    result = await service.generate_completion_with_tools(
        prompt="show me revenue", system_context="pick a tool", tools=_TOOLS, model_id="fake_fast",
    )

    assert result["success"] is False
    assert result["error_code"] == "BUDGET_EXCEEDED"
    assert called["acompletion"] is False, "must not call the LLM at all once budget-blocked"


@pytest.mark.asyncio
async def test_outbound_prompt_is_pii_scrubbed(monkeypatch):
    captured = {}

    async def fake_acompletion(**params):
        captured.update(params)
        return _FakeResponse(_FakeMessage(tool_calls=[_FakeToolCall("run_sql", "{}")]))

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        "src.modules.ai.services.org_budget_service.check_org_budget_allowed",
        AsyncMock(return_value=(True, None)),
    )

    service = _make_service()
    await service.generate_completion_with_tools(
        prompt="show revenue for jane@company.com",
        system_context="pick a tool",
        tools=_TOOLS,
        model_id="fake_fast",
    )

    sent_messages = captured.get("messages", [])
    assert "jane@company.com" not in str(sent_messages)


@pytest.mark.asyncio
async def test_returned_content_is_moderated(monkeypatch):
    async def fake_acompletion(**params):
        return _FakeResponse(_FakeMessage(content="contact jane@company.com for details"))

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        "src.modules.ai.services.org_budget_service.check_org_budget_allowed",
        AsyncMock(return_value=(True, None)),
    )

    service = _make_service()
    result = await service.generate_completion_with_tools(
        prompt="show me revenue", system_context="pick a tool", tools=_TOOLS, model_id="fake_fast",
    )

    assert "jane@company.com" not in result["content"]


@pytest.mark.asyncio
async def test_stream_callback_also_budget_gated(monkeypatch):
    """generate_completion_with_stream_callback (insight_synthesizer_node's path)
    got the identical budget-check fix - it previously had none at all."""
    called = {"acompletion": False}

    async def fake_acompletion(**params):
        called["acompletion"] = True
        raise AssertionError("should not reach the LLM once budget-blocked")

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        "src.modules.ai.services.org_budget_service.check_org_budget_allowed",
        AsyncMock(return_value=(False, "Organization AI budget exceeded")),
    )

    service = _make_service()

    async def _cb(_delta):
        pass

    result = await service.generate_completion_with_stream_callback(
        prompt="hello", system_context="sys", stream_callback=_cb, model_id="fake_fast",
    )

    assert result["success"] is False
    assert result["error_code"] == "BUDGET_EXCEEDED"
    assert called["acompletion"] is False
