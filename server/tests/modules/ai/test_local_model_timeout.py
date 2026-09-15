"""Regression tests: a local (Ollama) model must get a realistic timeout
budget, not the same fixed window tuned for datacenter-hosted cloud APIs.

Root cause: generate_completion/generate_completion_with_stream_callback/
generate_completion_with_tools all defaulted `timeout` to a fixed literal
(25.0 / 25.0 / 15.0 seconds respectively) with no awareness of whether the
model behind the call was a cloud API or something running on the
operator's own hardware. A 20-30B local model (Qwen3.8 27B, Muse Glimmer
30B - both real, Apache-2.0, self-host-friendly models confirmed available
in Ollama's library) generating a long structured-JSON dashboard/report
response routinely needs more than 25s on non-datacenter hardware, so every
such call was silently killed by asyncio.wait_for and fell back to the
heuristic path - defeating the entire point of configuring a capable local
model for a fully self-hosted, cloud-free deployment.

Fixed by making the default timeout None (a real, distinguishable "caller
didn't override it" sentinel, unlike reusing 25.0 which can't be told apart
from an explicit choice) and resolving it from the model's own `is_local`
flag once the config is loaded, rather than a single fixed constant for
every provider.

Later consolidated further: the is_local-only resolution here was itself
superseded by ee.modules.ai.utils.llm_call_budget.timeout_for, which also
scales with max_tokens (see test_llm_call_budget.py) — a flat is_local-only
split still applied the same budget to a one-line classification call and a
7-section report plan. These tests now assert against generate_completion's
own default max_tokens (2000), which timeout_for maps to 60s/120s.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.services.litellm_service import LiteLLMService


def _local_model_config():
    return {
        "name": "Qwen3.8 27B (Ollama)",
        "model": "ollama/qwen3.8:27b",
        "provider": "ollama",
        "api_key": "local",
        "api_base": "http://ollama:11434",
        "is_local": True,
        "tier": "fast",
    }


def _cloud_model_config():
    return {
        "name": "GPT-4.1 Mini",
        "model": "azure/gpt-4.1-mini",
        "provider": "azure",
        "api_key": "test-key",
        "api_base": "https://example.openai.azure.com",
        "api_version": "2025-01-01-preview",
        "is_local": False,
        "tier": "fast",
    }


@pytest.mark.asyncio
async def test_generate_completion_uses_longer_timeout_for_local_model():
    svc = LiteLLMService()
    captured = {}

    async def fake_get_model_config(model_id=None):
        return _local_model_config()

    async def fake_wait_for(coro, timeout):
        captured["timeout"] = timeout
        coro.close()
        return AsyncMock(choices=[AsyncMock(message=AsyncMock(content="{}"))])

    with patch.object(svc, "_get_model_config", new=fake_get_model_config), patch(
        "asyncio.wait_for", new=fake_wait_for
    ):
        await svc.generate_completion(prompt="hi")

    assert captured["timeout"] == 120.0  # timeout_for(2000, is_local=True)


@pytest.mark.asyncio
async def test_generate_completion_keeps_default_timeout_for_cloud_model():
    svc = LiteLLMService()
    captured = {}

    async def fake_get_model_config(model_id=None):
        return _cloud_model_config()

    async def fake_wait_for(coro, timeout):
        captured["timeout"] = timeout
        coro.close()
        return AsyncMock(choices=[AsyncMock(message=AsyncMock(content="{}"))])

    with patch.object(svc, "_get_model_config", new=fake_get_model_config), patch(
        "asyncio.wait_for", new=fake_wait_for
    ):
        await svc.generate_completion(prompt="hi")

    assert captured["timeout"] == 60.0  # timeout_for(2000, is_local=False)


@pytest.mark.asyncio
async def test_explicit_caller_timeout_is_never_overridden_for_local_model():
    """A caller that deliberately passes a shorter timeout (e.g. a
    latency-sensitive UI affordance) must still be respected — the local-
    model bump only fills in when nothing was specified."""
    svc = LiteLLMService()
    captured = {}

    async def fake_get_model_config(model_id=None):
        return _local_model_config()

    async def fake_wait_for(coro, timeout):
        captured["timeout"] = timeout
        coro.close()
        return AsyncMock(choices=[AsyncMock(message=AsyncMock(content="{}"))])

    with patch.object(svc, "_get_model_config", new=fake_get_model_config), patch(
        "asyncio.wait_for", new=fake_wait_for
    ):
        await svc.generate_completion(prompt="hi", timeout=5.0)

    assert captured["timeout"] == 5.0
