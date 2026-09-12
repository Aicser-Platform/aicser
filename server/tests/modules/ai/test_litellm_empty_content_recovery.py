"""Empty content + reasoning_content / finish_reason=length recovery in LiteLLMService."""

from types import SimpleNamespace

import pytest

import ee.modules.ai.services.litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import (
    LiteLLMService,
    _extract_message_text_parts,
    _salvage_text_from_reasoning,
    _usage_reasoning_tokens,
)


def test_salvage_json_from_reasoning_trace():
    reasoning = (
        "I should look at the schema...\n\n"
        'Final answer: {"questions": ["Show revenue by region", "Forecast sales"]}'
    )
    out = _salvage_text_from_reasoning(reasoning)
    assert out is not None
    assert '"questions"' in out


def test_extract_message_prefers_content_keeps_reasoning():
    msg = SimpleNamespace(content="hello", reasoning_content="thinking…")
    content, reasoning = _extract_message_text_parts(msg)
    assert content == "hello"
    assert reasoning == "thinking…"


def test_extract_message_empty_content_with_reasoning():
    msg = SimpleNamespace(content=None, reasoning_content='{"ok": true}')
    content, reasoning = _extract_message_text_parts(msg)
    assert content == ""
    assert reasoning == '{"ok": true}'


def test_usage_reasoning_tokens():
    usage = SimpleNamespace(
        completion_tokens=250,
        completion_tokens_details=SimpleNamespace(reasoning_tokens=238),
    )
    assert _usage_reasoning_tokens(usage) == 238


@pytest.mark.asyncio
async def test_generate_completion_recovers_from_reasoning_content(monkeypatch):
    class _Msg:
        content = None
        reasoning_content = (
            "Planning the JSON…\n\n"
            'Final answer: {"questions": ["Top products by revenue"]}'
        )

    class _Choice:
        message = _Msg()
        finish_reason = "length"

    class _Usage:
        prompt_tokens = 100
        completion_tokens = 250
        total_tokens = 350
        completion_tokens_details = SimpleNamespace(reasoning_tokens=238)

    class _Resp:
        choices = [_Choice()]
        usage = _Usage()

    async def fake_acompletion(**params):
        return _Resp()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["flash"] = {
        "name": "GLM Flash",
        "model": "openrouter/z-ai/glm-5.3-flash",
        "provider": "openrouter",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "fast",
    }

    result = await service.generate_completion(
        prompt="suggest questions",
        model_id="flash",
        max_tokens=250,
        num_retries=0,
        response_format={"type": "json_object"},
        reject_fallback_content=True,
    )
    assert result["success"] is True
    assert result["content"]
    assert "Top products" in result["content"]


@pytest.mark.asyncio
async def test_generate_completion_headroom_retry_on_length(monkeypatch):
    calls = {"n": 0}

    class _EmptyMsg:
        content = None
        reasoning_content = "still thinking without a final answer"

    class _EmptyChoice:
        message = _EmptyMsg()
        finish_reason = "length"

    class _EmptyUsage:
        prompt_tokens = 100
        completion_tokens = 250
        total_tokens = 350
        completion_tokens_details = SimpleNamespace(reasoning_tokens=238)

    class _OkMsg:
        content = '{"questions": ["Revenue trend over time"]}'
        reasoning_content = None

    class _OkChoice:
        message = _OkMsg()
        finish_reason = "stop"

    class _OkUsage:
        prompt_tokens = 100
        completion_tokens = 80
        total_tokens = 180

    async def fake_acompletion(**params):
        calls["n"] += 1
        if calls["n"] == 1:
            calls["first_max"] = params.get("max_tokens") or params.get("max_completion_tokens")
            return SimpleNamespace(choices=[_EmptyChoice()], usage=_EmptyUsage())
        calls["retry_max"] = params.get("max_tokens") or params.get("max_completion_tokens")
        calls["retry_timeout"] = params.get("timeout")
        return SimpleNamespace(choices=[_OkChoice()], usage=_OkUsage())

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["flash"] = {
        "name": "GLM Flash",
        "model": "openrouter/z-ai/glm-5.3-flash",
        "provider": "openrouter",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "fast",
    }

    result = await service.generate_completion(
        prompt="suggest questions",
        model_id="flash",
        max_tokens=250,
        timeout=60.0,
        num_retries=0,  # headroom retry must still fire
        response_format={"type": "json_object"},
        reject_fallback_content=True,
    )
    assert calls["n"] == 2
    assert calls["retry_max"] >= 2048
    # Empty/length retry must use shortened wall budget (not another full 60s).
    assert calls["retry_timeout"] == 20.0
    assert result["success"] is True
    assert "Revenue trend" in (result.get("content") or "")


@pytest.mark.asyncio
async def test_generate_completion_timeout_fallback_is_single_hop(monkeypatch):
    """Timeout fallback must not cascade 60s → 20s → 10s across providers."""
    import asyncio

    calls = {"models": []}

    async def fake_acompletion(**params):
        calls["models"].append(params.get("model"))
        raise asyncio.TimeoutError()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models = {
        "primary": {
            "name": "Primary",
            "model": "openrouter/primary",
            "provider": "openrouter",
            "api_key": "x",
            "api_base": "",
            "api_version": "",
            "max_tokens": 8192,
            "tier": "strong",
        },
        "fallback": {
            "name": "Fallback",
            "model": "openrouter/fallback",
            "provider": "openrouter",
            "api_key": "x",
            "api_base": "",
            "api_version": "",
            "max_tokens": 8192,
            "tier": "fast",
        },
        "fallback2": {
            "name": "Fallback2",
            "model": "openrouter/fallback2",
            "provider": "openrouter",
            "api_key": "x",
            "api_base": "",
            "api_version": "",
            "max_tokens": 8192,
            "tier": "fast",
        },
    }
    service.active_model = "primary"
    service.default_model = "primary"

    def fake_fallback(failed, requires_vision=False):
        order = ["primary", "fallback", "fallback2"]
        try:
            i = order.index(failed)
        except ValueError:
            return "fallback"
        return order[i + 1] if i + 1 < len(order) else None

    monkeypatch.setattr(service, "get_fallback_model_id", fake_fallback)
    monkeypatch.setattr(service, "_is_model_known_unavailable", lambda _mid: False)

    async def async_get(mid=None):
        return service.available_models.get(mid or "primary")

    monkeypatch.setattr(service, "_get_model_config", async_get)

    result = await service.generate_completion(
        prompt="hello",
        model_id="primary",
        max_tokens=200,
        timeout=30.0,
        num_retries=0,
    )
    assert result["success"] is False
    # Primary + exactly one timeout hop — never a third model.
    assert len(calls["models"]) == 2
    assert "timed out" in (result.get("error") or "").lower()


@pytest.mark.asyncio
async def test_generate_completion_skips_headroom_when_disabled(monkeypatch):
    calls = {"n": 0}

    class _EmptyMsg:
        content = None
        reasoning_content = "still thinking without a final answer"

    class _EmptyChoice:
        message = _EmptyMsg()
        finish_reason = "length"

    class _EmptyUsage:
        prompt_tokens = 100
        completion_tokens = 250
        total_tokens = 350
        completion_tokens_details = SimpleNamespace(reasoning_tokens=238)

    async def fake_acompletion(**params):
        calls["n"] += 1
        return SimpleNamespace(choices=[_EmptyChoice()], usage=_EmptyUsage())

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = LiteLLMService()
    service.available_models["flash"] = {
        "name": "GLM Flash",
        "model": "openrouter/z-ai/glm-5.3-flash",
        "provider": "openrouter",
        "api_key": "x",
        "api_base": "",
        "api_version": "",
        "max_tokens": 8192,
        "tier": "fast",
    }

    result = await service.generate_completion(
        prompt="suggest questions",
        model_id="flash",
        max_tokens=250,
        timeout=20.0,
        num_retries=0,
        response_format={"type": "json_object"},
        reject_fallback_content=True,
        _disable_headroom_retry=True,
    )
    assert calls["n"] == 1
    assert result["success"] is False
