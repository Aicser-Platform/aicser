"""Regression tests for the LiteLLM fallback chain (F1).

Reproduces the production loop seen in docker logs:
    Azure gpt41_mini → HTTP 500 → fallback to OpenAI → invalid key (auth error)
    → fallback loops back to the SAME Azure model that just 500'd.

After the fix:
  * a model already attempted in the chain is never tried again (no loop), and
  * a transient Azure 500 (no DeploymentNotFound) is retried once on the same model.
"""

import sys
import types
from pathlib import Path

import pytest

# Make `litellm_service.acompletion` patchable and the service importable.
from ee.modules.ai.services import litellm_service as svc_mod
from ee.modules.ai.services.litellm_service import LiteLLMService


class _AzureServerError(Exception):
    """Empty-body Azure 500 (transient gateway/capacity blip)."""

    def __init__(self):
        super().__init__("AzureException APIError -  | status_code=500")
        self.status_code = 500


class AuthenticationError(Exception):
    """Mimics litellm OpenAI auth error (invalid key). Name matters: code checks __name__."""

    def __init__(self):
        super().__init__("OpenAIException - Incorrect API key provided: sk-svcac...JtAA")
        self.status_code = 401


_FAKE_MODELS = {
    "fake_azure": {
        "name": "Azure Mini",
        "model": "azure/gpt-4.1-mini",
        "provider": "azure",
        "api_key": "azure-key",
        "api_base": "https://example.openai.azure.com/",
        "max_tokens": 16384,
    },
    "fake_openai": {
        "name": "OpenAI Mini",
        "model": "gpt-4o-mini",
        "provider": "openai",
        "api_key": "sk-svcac-bad-key",
        "max_tokens": 16384,
    },
}


@pytest.fixture(autouse=True)
def _clean_model_availability_cache():
    """_is_model_known_unavailable() falls through to the shared Redis-backed
    cache (src.core.cache.cache) when a model's local availability cache
    misses, keyed by a hash of id+provider+model+api_base+api_key. These
    tests deliberately make fake_openai "fail", which persists a real
    "unavailable" marker under that key with a TTL - so re-running this file
    (or anything else touching the same fake ids/keys) within the TTL window
    silently excludes fake_openai from fallback selection independently of
    whatever the test itself does. Clear both fake models' keys before and
    after every test so each run starts from a real clean slate.
    """
    from src.core.cache import cache

    probe = LiteLLMService()
    for model_id, config in _FAKE_MODELS.items():
        key = probe._model_availability_cache_key(model_id, config)
        if key:
            cache.delete(key)
    yield
    for model_id, config in _FAKE_MODELS.items():
        key = probe._model_availability_cache_key(model_id, config)
        if key:
            cache.delete(key)


def _make_service() -> LiteLLMService:
    service = LiteLLMService()
    # Two providers: a 500'ing Azure deployment and an OpenAI key that fails auth.
    service.available_models = dict(_FAKE_MODELS)
    service.default_model = "fake_azure"
    service.active_model = "fake_azure"
    # Start with a clean availability cache so resolution doesn't pre-swap models.
    service._model_availability_cache = {}
    service._model_cache_timestamps = {}
    return service


@pytest.mark.asyncio
async def test_fallback_does_not_loop_back_to_failed_model(monkeypatch):
    calls = {"azure": 0, "openai": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "azure" in model:
            calls["azure"] += 1
            raise _AzureServerError()
        calls["openai"] += 1
        raise AuthenticationError()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion(
        prompt="hello", model_id="fake_azure", timeout=2.0, num_retries=0
    )

    # Both providers are down → overall failure (not a crash, not a hang).
    assert result.get("success") is False

    # OpenAI (invalid key) is tried exactly once, then marked unavailable — never re-tried.
    assert calls["openai"] == 1, f"OpenAI should be tried once, got {calls['openai']}"

    # Azure: initial attempt + at most one same-model transient retry for the 500.
    # The bug retried Azure a THIRD time via the loop; the fix caps it at 2.
    assert calls["azure"] <= 2, f"Azure should be tried at most twice, got {calls['azure']}"
    assert calls["azure"] >= 1


def _ok_response():
    msg = types.SimpleNamespace(content="SELECT 1", text="SELECT 1")
    choice = types.SimpleNamespace(message=msg)
    return types.SimpleNamespace(choices=[choice], usage=None)


@pytest.mark.asyncio
async def test_gpt41_mini_honors_caller_temperature(monkeypatch):
    """gpt-4.1-mini is a standard chat model — it must NOT be forced to temperature=1.0."""
    captured = {}

    async def fake_acompletion(**params):
        captured.update(params)
        return _ok_response()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion(
        prompt="generate sql", model_id="fake_azure", temperature=0.1, timeout=2.0
    )

    assert result.get("success") is True
    # The caller asked for 0.1 (SQL determinism). Before the fix this was clobbered to 1.0.
    assert captured.get("temperature") == 0.1, f"expected 0.1, got {captured.get('temperature')}"


@pytest.mark.asyncio
async def test_o_series_model_still_forced_to_reasoning_temperature(monkeypatch):
    """True reasoning models (o3) must still get temperature=1.0 + max_completion_tokens."""
    captured = {}

    async def fake_acompletion(**params):
        captured.update(params)
        return _ok_response()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    service.available_models["fake_azure"]["model"] = "azure/o3-mini"
    result = await service.generate_completion(
        prompt="reason", model_id="fake_azure", temperature=0.1, timeout=2.0
    )

    assert result.get("success") is True
    assert captured.get("temperature") == 1.0
    assert "max_completion_tokens" in captured


@pytest.mark.asyncio
async def test_transient_azure_500_retries_same_model_when_no_fallback(monkeypatch):
    """When the only other provider is unavailable, a transient 500 still retries the same model."""
    calls = {"azure": 0}

    async def fake_acompletion(**params):
        model = params.get("model", "")
        if "azure" in model:
            calls["azure"] += 1
            raise _AzureServerError()
        raise AssertionError("openai should not be called in this test")

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    # Remove the OpenAI option entirely → no cross-provider fallback exists.
    service.available_models.pop("fake_openai")

    result = await service.generate_completion(
        prompt="hello", model_id="fake_azure", timeout=2.0, num_retries=0
    )

    assert result.get("success") is False
    # Initial call + one transient same-model retry = 2.
    assert calls["azure"] == 2, f"Transient 500 should retry the same model once, got {calls['azure']}"


def _empty_response():
    msg = types.SimpleNamespace(
        content=None,
        text=None,
        message=None,
        reasoning_content=None,
        thinking_blocks=None,
        refusal=None,
    )
    choice = types.SimpleNamespace(message=msg, finish_reason="stop")
    return types.SimpleNamespace(choices=[choice], usage=None)


@pytest.mark.asyncio
async def test_json_object_empty_content_does_not_return_connect_data_fallback(monkeypatch):
    """Report section narratives request json_object. Empty LLM output used to
    come back as success=True with the canned 'Connect Data' help template,
    which then leaked into the executive report document.
    """

    async def fake_acompletion(**params):
        return _empty_response()

    monkeypatch.setattr(svc_mod, "acompletion", fake_acompletion)

    service = _make_service()
    result = await service.generate_completion(
        prompt="analyze disbursement trends",
        model_id="fake_azure",
        timeout=2.0,
        num_retries=1,
        response_format={"type": "json_object"},
    )

    assert result.get("success") is False
    assert result.get("content") in (None, "")
    blob = str(result.get("content") or "") + str(result.get("error") or "")
    assert "Connect Data" not in blob
    assert "technical difficulties" not in blob.lower()
