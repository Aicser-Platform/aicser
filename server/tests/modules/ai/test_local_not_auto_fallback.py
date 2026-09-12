"""Best available must not auto-route or fail over to a configured local model.

Ollama/vLLM env (or an org BYOK placeholder at http://ollama:11434) registers
a picker option. It is not a recovery backend for OpenRouter/Azure timeouts.
A DNS miss on `ollama` used to replace the primary error, then fail-fast the
whole turn as "LLM service down".
"""

import asyncio

import pytest

from ee.modules.ai.services import litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import LiteLLMService, _is_opt_in_local_model
from ee.modules.ai.utils.fail_fast import is_llm_error_unrecoverable


_PRIMARY = {
    "name": "Primary — GLM 5.3 Flash",
    "model": "openrouter/z-ai/glm-5.3-flash",
    "provider": "zai",
    "api_key": "sk-or-fake",
    "api_base": "",
    "tier": "fast",
    "max_tokens": 8192,
}
_OLLAMA = {
    "name": "Ollama · qwen3:8b",
    "model": "ollama/qwen3:8b",
    "provider": "ollama",
    "api_key": "local",
    "api_base": "http://ollama:11434",
    "tier": "fast",
    "is_local": True,
    "max_tokens": 8192,
}
_GLM_PRO = {
    "name": "GLM-5.3",
    "model": "openrouter/z-ai/glm-5.3",
    "provider": "zai",
    "api_key": "sk-or-fake",
    "api_base": "",
    "tier": "reasoning",
    "max_tokens": 16384,
}


def _service() -> LiteLLMService:
    service = LiteLLMService()
    service.available_models = {
        "primary_override": dict(_PRIMARY),
        "openrouter_glm_pro": dict(_GLM_PRO),
        "ollama_qwen3_8b": dict(_OLLAMA),
    }
    service.default_model = "primary_override"
    service.active_model = "primary_override"
    service._model_availability_cache = {}
    service._model_cache_timestamps = {}
    return service


def test_ollama_is_opt_in_local():
    assert _is_opt_in_local_model(_OLLAMA) is True
    assert _is_opt_in_local_model(_PRIMARY) is False


def test_best_available_stays_on_primary_not_pro_or_ollama():
    service = _service()
    assert service.get_model_for_tier("fast") == "primary_override"
    assert service.get_model_for_tier("reasoning") == "primary_override"
    assert service.get_fallback_model_id("primary_override") is None


def test_fallback_from_cloud_skips_ollama():
    service = _service()
    # Simulate no primary_override restriction by failing over from Pro.
    assert service.get_fallback_model_id("openrouter_glm_pro") != "ollama_qwen3_8b"
    assert service.get_fallback_model_id("openrouter_glm_pro") == "primary_override"


def test_friendly_connection_error_is_not_whole_service_down():
    """Translator rewrites Ollama DNS misses to this copy; matching
    `connection error` used to skip NL2SQL Layer 2 and escalate."""
    assert is_llm_error_unrecoverable(
        "Connection error. Check your network and try again."
    ) is False
    assert is_llm_error_unrecoverable(
        "AzureException APIError -  | status_code=500"
    ) is True


@pytest.mark.asyncio
async def test_timeout_does_not_call_ollama(monkeypatch):
    calls = []

    async def fake_acompletion(**params):
        model = params.get("model", "")
        calls.append(model)
        if model.startswith("ollama/"):
            raise ConnectionError("Cannot connect to host ollama:11434 [Name or service not known]")
        await asyncio.sleep(10)
        return None

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)
    service = _service()
    result = await service.generate_completion(
        prompt="hello", model_id="primary_override", timeout=0.2, num_retries=0
    )

    assert result.get("success") is False
    assert "ollama/" not in "".join(calls)
    assert "timed out" in str(result.get("error") or "").lower()
